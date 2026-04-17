/**
 * GitService — executes git commands via the user's installed git CLI
 * and parses output into structured data.
 *
 * Features:
 * - Command queue to prevent concurrent git operations on the same repo
 * - AbortController support for cancellation
 * - Structured data output (parsed objects, not raw strings)
 * - Graceful error handling
 * - Git version detection
 */

import { execFile, ExecFileOptions, spawn } from 'child_process'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitExecResult {
  stdout: string
  stderr: string
}

export interface GitError {
  message: string
  code: GitErrorCode
  stderr?: string
}

export enum GitErrorCode {
  GitNotInstalled = 'GIT_NOT_INSTALLED',
  NotARepository = 'NOT_A_REPOSITORY',
  AuthFailure = 'AUTH_FAILURE',
  NetworkError = 'NETWORK_ERROR',
  MergeConflict = 'MERGE_CONFLICT',
  CommandFailed = 'COMMAND_FAILED',
  Cancelled = 'CANCELLED',
  UnknownError = 'UNKNOWN_ERROR'
}

export interface GitVersion {
  major: number
  minor: number
  patch: number
  raw: string
  supported: boolean
}

export type SignatureStatus = 'good' | 'bad' | 'untrusted' | 'expired' | 'expired-key' | 'revoked' | 'error' | 'none'

export interface GitCommit {
  hash: string
  shortHash: string
  parentHashes: string[]
  authorName: string
  authorEmail: string
  authorDate: string
  committerName: string
  committerEmail: string
  commitDate: string
  subject: string
  body: string
  refs: string
  signatureStatus: SignatureStatus
  signer: string
  signingKey: string
}

export interface GpgKey {
  keyId: string
  uid: string
  fingerprint: string
}

export interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  hash: string
}

export interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

export interface GitTag {
  name: string
  hash: string
  isAnnotated: boolean
  message: string
  taggerDate: string
}

export interface GitStash {
  index: number
  message: string
  hash: string
  date: string
}

export interface GitFileStatus {
  path: string
  oldPath?: string // for renames
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored'
  staged: boolean
  indexStatus: string
  workTreeStatus: string
}

export interface GitRepoStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: GitFileStatus[]
  unstaged: GitFileStatus[]
  untracked: GitFileStatus[]
}

export interface CloneProgressExtras {
  bytes?: string
  rate?: string
}

export interface CloneProgress extends CloneProgressExtras {
  phase: string
  percent: number | null
  current: number | null
  total: number | null
}

export interface GitOperationProgress {
  phase: string
  percent: number | null
  current: number | null
  total: number | null
}

// ─── Minimum required git version ────────────────────────────────────────────

const MIN_GIT_VERSION = { major: 2, minor: 20, patch: 0 }

// ─── Request Deduplication ───────────────────────────────────────────────────
//
// When multiple components request the same git command simultaneously (e.g.
// five components all calling getBranches on repo open), only one subprocess
// is spawned. All callers share the same in-flight promise.
//
// Keys are "repoPath\0arg1\0arg2..." — identical commands on the same repo
// coalesce automatically.

class DedupedExecutor {
  private inflight: Map<string, Promise<GitExecResult>> = new Map()

  async exec(
    key: string,
    fn: () => Promise<GitExecResult>
  ): Promise<GitExecResult> {
    const existing = this.inflight.get(key)
    if (existing) return existing

    const promise = fn().finally(() => {
      this.inflight.delete(key)
    })
    this.inflight.set(key, promise)
    return promise
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseSignatureStatus(code: string): SignatureStatus {
  switch (code.trim()) {
    case 'G': return 'good'
    case 'B': return 'bad'
    case 'U': return 'untrusted'
    case 'X': return 'expired'
    case 'Y': return 'expired-key'
    case 'R': return 'revoked'
    case 'E': return 'error'
    case 'N':
    default: return 'none'
  }
}

// ─── GitService ──────────────────────────────────────────────────────────────

export class GitService {
  private dedup = new DedupedExecutor()
  private cachedVersion: GitVersion | null = null

  /**
   * Execute a raw git command with queuing and cancellation support.
   */
  async exec(
    args: string[],
    repoPath: string,
    options?: { signal?: AbortSignal; noQueue?: boolean; env?: Record<string, string> }
  ): Promise<GitExecResult> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    const execFn = (): Promise<GitExecResult> => {
      return new Promise<GitExecResult>((resolve, reject) => {
        const execOpts: ExecFileOptions = {
          cwd: repoPath,
          maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large repos
          timeout: 120_000, // 2 minute timeout
          ...(options?.env ? { env: { ...process.env, ...options.env } } : {})
        }

        const child = execFile('git', args, execOpts, (error, stdout, stderr) => {
          if (signal?.aborted) {
            reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
            return
          }

          if (error) {
            reject(this.classifyError(error, stderr?.toString() ?? ''))
            return
          }

          resolve({ stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' })
        })

        // Wire up abort signal to kill the child process
        if (signal) {
          const onAbort = (): void => {
            child.kill('SIGTERM')
            reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
    }

    if (options?.noQueue) {
      return execFn()
    }

    // Dedup key: identical commands on the same repo share one subprocess.
    // Write commands (commit, checkout, merge, etc.) should NOT dedup —
    // they use noQueue or are inherently unique. Read commands that
    // multiple components fire simultaneously (getBranches, getStatus, etc.)
    // coalesce here automatically.
    const dedupKey = repoPath + '\0' + args.join('\0')
    return this.dedup.exec(dedupKey, execFn)
  }

  /**
   * Detect the user's git version.
   */
  async getVersion(): Promise<GitVersion> {
    if (this.cachedVersion) return this.cachedVersion

    try {
      // Run without a repo path — git --version works anywhere
      const result = await new Promise<GitExecResult>((resolve, reject) => {
        execFile('git', ['--version'], {}, (error, stdout, stderr) => {
          if (error) {
            reject(this.createError('Git is not installed or not found in PATH', GitErrorCode.GitNotInstalled))
            return
          }
          resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
        })
      })

      const match = result.stdout.match(/git version (\d+)\.(\d+)\.(\d+)/)
      if (!match) {
        throw this.createError('Could not parse git version', GitErrorCode.UnknownError)
      }

      const major = parseInt(match[1], 10)
      const minor = parseInt(match[2], 10)
      const patch = parseInt(match[3], 10)

      const supported =
        major > MIN_GIT_VERSION.major ||
        (major === MIN_GIT_VERSION.major && minor > MIN_GIT_VERSION.minor) ||
        (major === MIN_GIT_VERSION.major &&
          minor === MIN_GIT_VERSION.minor &&
          patch >= MIN_GIT_VERSION.patch)

      this.cachedVersion = { major, minor, patch, raw: result.stdout.trim(), supported }
      return this.cachedVersion
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err) {
        throw err // Re-throw our GitErrors
      }
      throw this.createError('Git is not installed or not found in PATH', GitErrorCode.GitNotInstalled)
    }
  }

  /**
   * Check if a directory is a git repository.
   */
  async isRepo(dirPath: string): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--git-dir'], dirPath, { noQueue: true })
      return true
    } catch {
      return false
    }
  }

  /**
   * Initialize a new git repository.
   */
  async init(dirPath: string): Promise<void> {
    await this.exec(['init'], dirPath)
  }

  /**
   * Get structured commit log.
   */
  async log(
    repoPath: string,
    options?: {
      maxCount?: number
      skip?: number
      all?: boolean
      signal?: AbortSignal
      author?: string
      since?: string
      until?: string
      grep?: string
      path?: string
    }
  ): Promise<GitCommit[]> {
    const SEPARATOR = '<<<SEP>>>'
    const RECORD_END = '<<<END>>>'
    const format = [
      '%H',    // hash
      '%h',    // short hash
      '%P',    // parent hashes
      '%an',   // author name
      '%ae',   // author email
      '%aI',   // author date ISO
      '%cn',   // committer name
      '%ce',   // committer email
      '%cI',   // committer date ISO
      '%s',    // subject
      '%b',    // body
      '%D',    // refs
      '%G?',   // signature status
      '%GS',   // signer
      '%GK'    // signing key
    ].join(SEPARATOR)

    const args = ['log', `--format=${format}${RECORD_END}`]
    if (options?.all) args.push('--all')
    if (options?.maxCount) args.push(`-n`, `${options.maxCount}`)
    if (options?.skip) args.push(`--skip=${options.skip}`)
    if (options?.author) args.push(`--author=${options.author}`)
    if (options?.since) args.push(`--since=${options.since}`)
    if (options?.until) args.push(`--until=${options.until}`)
    if (options?.grep) args.push(`--grep=${options.grep}`, '--regexp-ignore-case')
    // -- <path> must come last
    if (options?.path) args.push('--', options.path)

    try {
      const result = await this.exec(args, repoPath, { signal: options?.signal })
      return this.parseLogOutput(result.stdout, SEPARATOR, RECORD_END)
    } catch (err) {
      // Empty repo has no commits — return empty
      if (err && typeof err === 'object' && 'stderr' in err) {
        const stderr = (err as { stderr: string }).stderr
        if (stderr?.includes('does not have any commits yet')) {
          return []
        }
      }
      throw err
    }
  }

  /**
   * Count total commits in the repository (across all branches).
   * Used for pagination UI to show "Showing N of Total commits".
   */
  async commitCount(
    repoPath: string,
    options?: {
      all?: boolean
      author?: string
      since?: string
      until?: string
      grep?: string
      path?: string
      signal?: AbortSignal
    }
  ): Promise<number> {
    const args = ['rev-list', '--count']
    if (options?.all) args.push('--all')
    else args.push('HEAD')
    if (options?.author) args.push(`--author=${options.author}`)
    if (options?.since) args.push(`--since=${options.since}`)
    if (options?.until) args.push(`--until=${options.until}`)
    if (options?.grep) args.push(`--grep=${options.grep}`, '--regexp-ignore-case')
    if (options?.path) args.push('--', options.path)

    try {
      const result = await this.exec(args, repoPath, { signal: options?.signal })
      return parseInt(result.stdout.trim(), 10) || 0
    } catch {
      return 0
    }
  }

  /**
   * Get all local branches with tracking info.
   */
  async getBranches(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitBranch[]> {
    const format = '%(HEAD)|||%(refname:short)|||%(upstream:short)|||%(upstream:track,nobracket)|||%(objectname:short)'

    try {
      const result = await this.exec(
        ['branch', '--format', format],
        repoPath,
        { signal: options?.signal }
      )

      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split('|||')
          const trackingInfo = parts[3] || ''
          const aheadMatch = trackingInfo.match(/ahead (\d+)/)
          const behindMatch = trackingInfo.match(/behind (\d+)/)

          return {
            name: parts[1],
            current: parts[0] === '*',
            upstream: parts[2] || null,
            ahead: aheadMatch ? parseInt(aheadMatch[1], 10) : 0,
            behind: behindMatch ? parseInt(behindMatch[1], 10) : 0,
            hash: parts[4]
          }
        })
    } catch {
      return [] // No branches in fresh repo
    }
  }

  /**
   * Get all remotes.
   */
  async getRemotes(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitRemote[]> {
    try {
      const result = await this.exec(['remote', '-v'], repoPath, { signal: options?.signal })
      const remoteMap = new Map<string, GitRemote>()

      result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .forEach((line) => {
          const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/)
          if (!match) return

          const [, name, url, type] = match
          if (!remoteMap.has(name)) {
            remoteMap.set(name, { name, fetchUrl: '', pushUrl: '' })
          }
          const remote = remoteMap.get(name)!
          if (type === 'fetch') remote.fetchUrl = url
          else remote.pushUrl = url
        })

      return Array.from(remoteMap.values())
    } catch {
      return []
    }
  }

  /**
   * Get all tags.
   */
  async getTags(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitTag[]> {
    const SEPARATOR = '<<<SEP>>>'
    const format = [
      '%(refname:short)',
      '%(objectname:short)',
      '%(objecttype)',
      '%(subject)',
      '%(creatordate:iso-strict)',
      '%(*objectname:short)'  // dereferenced commit hash (non-empty for annotated tags)
    ].join(SEPARATOR)

    try {
      const result = await this.exec(
        ['tag', '--sort=-creatordate', '--format', format],
        repoPath,
        { signal: options?.signal }
      )

      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split(SEPARATOR)
          const isAnnotated = parts[2] === 'tag'
          return {
            name: parts[0],
            // For annotated tags, use the dereferenced commit hash
            hash: (isAnnotated && parts[5]) ? parts[5] : parts[1],
            isAnnotated,
            message: parts[3] || '',
            taggerDate: parts[4] || ''
          }
        })
    } catch {
      return []
    }
  }

  /**
   * Get branches containing a specific commit.
   * Returns { local: string[], remote: string[] }
   */
  async getBranchesContaining(
    repoPath: string,
    hash: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ local: string[]; remote: string[] }> {
    const parseOutput = (stdout: string): string[] =>
      stdout
        .split('\n')
        .map((line) => line.replace(/^\*?\s+/, '').trim())
        .filter((line) => line.length > 0)

    const [localResult, remoteResult] = await Promise.all([
      this.exec(['branch', '--contains', hash], repoPath, { signal: options?.signal }).catch(
        () => ({ stdout: '', stderr: '' })
      ),
      this.exec(['branch', '-r', '--contains', hash], repoPath, { signal: options?.signal }).catch(
        () => ({ stdout: '', stderr: '' })
      )
    ])

    return {
      local: parseOutput(localResult.stdout),
      remote: parseOutput(remoteResult.stdout)
    }
  }

  /**
   * Get all stashes.
   */
  async getStashes(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitStash[]> {
    const SEPARATOR = '<<<SEP>>>'
    const format = `%gd${SEPARATOR}%s${SEPARATOR}%H${SEPARATOR}%aI`

    try {
      const result = await this.exec(
        ['stash', 'list', `--format=${format}`],
        repoPath,
        { signal: options?.signal }
      )

      return result.stdout
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.split(SEPARATOR)
          const refMatch = parts[0].match(/stash@\{(\d+)\}/)
          return {
            index: refMatch ? parseInt(refMatch[1], 10) : 0,
            message: parts[1] || '',
            hash: parts[2],
            date: parts[3]
          }
        })
    } catch {
      return []
    }
  }

  /**
   * Get working directory status (porcelain v2).
   */
  async getStatus(repoPath: string, options?: { signal?: AbortSignal }): Promise<GitRepoStatus> {
    const result = await this.exec(
      ['status', '--porcelain=v2', '--branch', '-u'],
      repoPath,
      { signal: options?.signal }
    )

    return this.parseStatusOutput(result.stdout)
  }

  /**
   * Get diff for a file.
   */
  async diff(
    repoPath: string,
    filePath?: string,
    options?: { staged?: boolean; signal?: AbortSignal }
  ): Promise<string> {
    const args = ['diff']
    if (options?.staged) args.push('--cached')
    if (filePath) args.push('--', filePath)

    const result = await this.exec(args, repoPath, { signal: options?.signal })
    return result.stdout
  }

  /**
   * Get numstat (insertions/deletions per file) for working tree changes.
   * Returns a map from file path to { insertions, deletions }.
   */
  async diffNumstat(
    repoPath: string,
    options?: { staged?: boolean; signal?: AbortSignal }
  ): Promise<Record<string, { insertions: number; deletions: number }>> {
    const args = ['diff', '--numstat']
    if (options?.staged) args.push('--cached')

    const result = await this.exec(args, repoPath, { signal: options?.signal })
    const stats: Record<string, { insertions: number; deletions: number }> = {}

    for (const line of result.stdout.split('\n')) {
      if (!line.trim()) continue
      const match = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
      if (match) {
        const ins = match[1] === '-' ? 0 : parseInt(match[1], 10)
        const del = match[2] === '-' ? 0 : parseInt(match[2], 10)
        // Handle renames: "old => new" or "{old => new}/path"
        let filePath = match[3]
        const renameMatch = filePath.match(/^(.*)\\{(.+) => (.+)\\}(.*)$/)
        if (renameMatch) {
          filePath = renameMatch[1] + renameMatch[3] + renameMatch[4]
        }
        stats[filePath] = { insertions: ins, deletions: del }
      }
    }

    return stats
  }

  /**
   * Get commit details including changed files with status and stats.
   */
  async showCommit(
    repoPath: string,
    hash: string,
    options?: { signal?: AbortSignal }
  ): Promise<{
    commit: GitCommit
    files: string[]
    fileDetails: Array<{ path: string; status: string; insertions: number; deletions: number; oldPath?: string }>
    totalInsertions: number
    totalDeletions: number
  }> {
    const SEPARATOR = '<<<SEP>>>'
    const format = [
      '%H', '%h', '%P', '%an', '%ae', '%aI',
      '%cn', '%ce', '%cI', '%s', '%b', '%D',
      '%G?', '%GS', '%GK'
    ].join(SEPARATOR)

    // Check if this is a merge commit (has a second parent)
    const isMerge = await this.exec(
      ['rev-parse', '--verify', `${hash}^2`], repoPath, { signal: options?.signal }
    ).then(() => true).catch(() => false)

    // For merge commits, `git show --stat` produces a combined diff that omits
    // files only changed in one parent. Use `--first-parent` to diff against
    // the first parent, matching GitKraken's behavior.
    const firstParentFlag = isMerge ? ['--first-parent'] : []

    // Run show with --stat for basic file list
    const result = await this.exec(
      ['show', '--format=' + format, '--stat', '--stat-width=200', ...firstParentFlag, hash],
      repoPath,
      { signal: options?.signal }
    )

    // The output has the formatted commit info first, then a blank line, then stat output
    const lines = result.stdout.split('\n')
    const commitLine = lines[0]
    const commit = this.parseLogOutput(commitLine, SEPARATOR, '')[0] || this.emptyCommit()

    // Parse stat lines for file list
    const files: string[] = []
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line || line.startsWith('---')) continue
      // stat lines look like: "filename | 5 ++-"
      const statMatch = line.match(/^\s*(.+?)\s+\|\s+\d+/)
      if (statMatch) {
        files.push(statMatch[1].trim())
      }
    }

    // Get name-status and numstat for file details
    let fileDetails: Array<{ path: string; status: string; insertions: number; deletions: number; oldPath?: string }> = []
    let totalInsertions = 0
    let totalDeletions = 0

    try {
      // Run --name-status and --numstat in one call using --format=
      const statusResult = await this.exec(
        ['show', '--format=', '--name-status', ...firstParentFlag, hash],
        repoPath,
        { signal: options?.signal }
      )
      const numstatResult = await this.exec(
        ['show', '--format=', '--numstat', ...firstParentFlag, hash],
        repoPath,
        { signal: options?.signal }
      )

      // Parse name-status: "M\tfile.txt" or "R100\told.txt\tnew.txt"
      const statusMap = new Map<string, { status: string; oldPath?: string }>()
      for (const line of statusResult.stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split('\t')
        if (parts.length >= 2) {
          const statusCode = parts[0].charAt(0) // M, A, D, R, C
          if (statusCode === 'R' || statusCode === 'C') {
            // Renamed/Copied: R100\told\tnew
            statusMap.set(parts[2], { status: statusCode, oldPath: parts[1] })
          } else {
            statusMap.set(parts[1], { status: statusCode })
          }
        }
      }

      // Parse numstat: "5\t3\tfile.txt" or "-\t-\tbinary.bin"
      const numstatMap = new Map<string, { insertions: number; deletions: number }>()
      for (const line of numstatResult.stdout.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parts = trimmed.split('\t')
        if (parts.length >= 3) {
          const ins = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
          const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
          // Handle renames: "old => new" or "{old => new}/path"
          const filePath = parts.slice(2).join('\t')
          numstatMap.set(filePath, { insertions: ins, deletions: del })
          totalInsertions += ins
          totalDeletions += del
        }
      }

      // Merge status and numstat data
      const allPaths = new Set([...statusMap.keys(), ...numstatMap.keys(), ...files])
      fileDetails = Array.from(allPaths).map((filePath) => {
        const statusInfo = statusMap.get(filePath)
        const numstat = numstatMap.get(filePath)
        return {
          path: filePath,
          status: statusInfo?.status || 'M',
          insertions: numstat?.insertions || 0,
          deletions: numstat?.deletions || 0,
          oldPath: statusInfo?.oldPath
        }
      })
    } catch {
      // Fallback: just use file names with no status info
      fileDetails = files.map((f) => ({ path: f, status: 'M', insertions: 0, deletions: 0 }))
    }

    return { commit, files, fileDetails, totalInsertions, totalDeletions }
  }

  /**
   * Get the diff of a specific file in a commit.
   */
  async showCommitFileDiff(
    repoPath: string,
    hash: string,
    filePath: string,
    options?: { signal?: AbortSignal; isMerge?: boolean }
  ): Promise<string> {
    // For merge commits, `git show --patch` produces a combined diff that's
    // empty for files only changed in one parent. Use `git diff parent..hash`
    // against the first parent instead, which matches what GitKraken shows.
    if (options?.isMerge) {
      const result = await this.exec(
        ['diff', `${hash}^1`, hash, '--', filePath],
        repoPath,
        { signal: options?.signal }
      )
      return result.stdout
    }

    const args = ['show', '--format=', '--patch', hash, '--', filePath]
    const result = await this.exec(args, repoPath, { signal: options?.signal })
    return result.stdout
  }

  /**
   * Diff two arbitrary commits (multi-select comparison).
   * Returns changed file list with status and insertion/deletion counts.
   */
  async diffTwoCommits(
    repoPath: string,
    hashFrom: string,
    hashTo: string,
    options?: { signal?: AbortSignal }
  ): Promise<{
    fileDetails: Array<{ path: string; status: string; insertions: number; deletions: number; oldPath?: string }>
    totalInsertions: number
    totalDeletions: number
  }> {
    // Run --name-status and --numstat in parallel
    const [statusResult, numstatResult] = await Promise.all([
      this.exec(
        ['diff', '--name-status', `${hashFrom}..${hashTo}`],
        repoPath,
        { signal: options?.signal }
      ),
      this.exec(
        ['diff', '--numstat', `${hashFrom}..${hashTo}`],
        repoPath,
        { signal: options?.signal }
      )
    ])

    // Parse name-status: "M\tfile.txt" or "R100\told.txt\tnew.txt"
    const statusMap = new Map<string, { status: string; oldPath?: string }>()
    for (const line of statusResult.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split('\t')
      if (parts.length >= 2) {
        const statusCode = parts[0].charAt(0) // M, A, D, R, C
        if (statusCode === 'R' || statusCode === 'C') {
          statusMap.set(parts[2], { status: statusCode, oldPath: parts[1] })
        } else {
          statusMap.set(parts[1], { status: statusCode })
        }
      }
    }

    // Parse numstat: "5\t3\tfile.txt" or "-\t-\tbinary.bin"
    const numstatMap = new Map<string, { insertions: number; deletions: number }>()
    let totalInsertions = 0
    let totalDeletions = 0
    for (const line of numstatResult.stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const parts = trimmed.split('\t')
      if (parts.length >= 3) {
        const ins = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0
        const del = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0
        const filePath = parts.slice(2).join('\t')
        numstatMap.set(filePath, { insertions: ins, deletions: del })
        totalInsertions += ins
        totalDeletions += del
      }
    }

    // Merge status and numstat data
    const allPaths = new Set([...statusMap.keys(), ...numstatMap.keys()])
    const fileDetails = Array.from(allPaths).map((filePath) => {
      const statusInfo = statusMap.get(filePath)
      const numstat = numstatMap.get(filePath)
      return {
        path: filePath,
        status: statusInfo?.status || 'M',
        insertions: numstat?.insertions || 0,
        deletions: numstat?.deletions || 0,
        oldPath: statusInfo?.oldPath
      }
    })

    return { fileDetails, totalInsertions, totalDeletions }
  }

  /**
   * Get the diff of a specific file between two arbitrary commits.
   */
  async diffTwoCommitsFile(
    repoPath: string,
    hashFrom: string,
    hashTo: string,
    filePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const result = await this.exec(
      ['diff', `${hashFrom}..${hashTo}`, '--', filePath],
      repoPath,
      { signal: options?.signal }
    )
    return result.stdout
  }

  /**
   * Get the full content of a file at the parent of a specific commit.
   * Used for full-diff view to show old file content alongside new.
   * Returns { binary: true } if the file contains null bytes.
   * Returns empty string if the file is new (added in this commit).
   */
  async showFileAtParent(
    repoPath: string,
    hash: string,
    filePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string | { binary: true }> {
    try {
      // Use hash^1:path directly — git resolves the parent without a separate rev-parse
      const args = ['show', `${hash}^1:${filePath}`]
      const result = await this.exec(args, repoPath, { signal: options?.signal })

      // Binary file detection: check for null bytes
      if (result.stdout.includes('\0')) {
        return { binary: true }
      }

      return result.stdout
    } catch {
      // If rev-parse fails (no parent, e.g. initial commit) or
      // if git show fails (file is new / didn't exist in parent),
      // return empty string
      return ''
    }
  }

  /**
   * Get the full content of a file at a specific commit.
   */
  async showFileAtCommit(
    repoPath: string,
    hash: string,
    filePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const args = ['show', `${hash}:${filePath}`]
    const result = await this.exec(args, repoPath, { signal: options?.signal })
    return result.stdout
  }

  /**
   * List every file that exists at a given commit (recursive tree listing).
   * Used by the commit detail panel's "show all files" mode so users can
   * browse the full project tree at the commit, not just the changed files.
   */
  async listFilesAtCommit(
    repoPath: string,
    hash: string,
    options?: { signal?: AbortSignal }
  ): Promise<string[]> {
    const args = ['ls-tree', '-r', '--name-only', hash]
    const result = await this.exec(args, repoPath, { signal: options?.signal })
    return result.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
  }

  /**
   * Clone a remote repository with progress reporting.
   * Uses spawn instead of execFile to get real-time stderr progress output.
   */
  async clone(
    url: string,
    destPath: string,
    options?: {
      signal?: AbortSignal
      onProgress?: (progress: CloneProgress) => void
      env?: Record<string, string>
    }
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['clone', '--progress', url, destPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {})
      })

      let stderrOutput = ''

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrOutput += text

        // Parse progress from stderr
        // Git progress lines look like:
        // "Cloning into 'repo'..."
        // "remote: Counting objects: 100% (42/42), done."
        // "Receiving objects:  50% (21/42)"
        // "Resolving deltas: 100% (10/10), done."
        if (options?.onProgress) {
          const progress = this.parseCloneProgress(text, stderrOutput)
          options.onProgress(progress)
        }
      })

      child.on('close', (code) => {
        if (signal?.aborted) {
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          return
        }

        if (code === 0) {
          resolve()
        } else {
          reject(this.classifyError(
            Object.assign(new Error('git clone failed'), { code: code ?? 1 }),
            stderrOutput
          ))
        }
      })

      child.on('error', (err) => {
        reject(this.classifyError(
          err as Error & { code?: string | number | null },
          stderrOutput
        ))
      })

      // Wire up abort signal
      if (signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /**
   * Create a tag.
   */
  async createTag(
    repoPath: string,
    name: string,
    target?: string,
    options?: { message?: string; signal?: AbortSignal }
  ): Promise<void> {
    // Always create annotated tags so they are pushed by --follow-tags.
    // Lightweight tags are silently skipped by `git push --follow-tags`,
    // which leads to confusing "tag not pushed" behavior.
    const args = ['tag', '-a', name, '-m', options?.message || name]
    if (target) args.push(target)
    await this.exec(args, repoPath, { signal: options?.signal })
  }

  /**
   * Delete a tag (local).
   */
  async deleteTag(
    repoPath: string,
    name: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['tag', '-d', name], repoPath, { signal: options?.signal })
  }

  /**
   * Push a tag to a remote.
   */
  async pushTag(
    repoPath: string,
    tagName: string,
    remoteName?: string,
    options?: { signal?: AbortSignal; env?: Record<string, string> }
  ): Promise<void> {
    const remote = remoteName || 'origin'
    await this.exec(['push', remote, `refs/tags/${tagName}`], repoPath, { signal: options?.signal, noQueue: true, env: options?.env })
  }

  /**
   * Create a stash.
   */
  async stashSave(
    repoPath: string,
    options?: { message?: string; includeUntracked?: boolean; signal?: AbortSignal }
  ): Promise<void> {
    const args = ['stash', 'push']
    if (options?.includeUntracked) args.push('--include-untracked')
    if (options?.message) args.push('-m', options.message)
    await this.exec(args, repoPath, { signal: options?.signal })
  }

  /**
   * Apply a stash.
   */
  async stashApply(
    repoPath: string,
    index: number,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['stash', 'apply', `stash@{${index}}`], repoPath, { signal: options?.signal })
  }

  /**
   * Pop a stash (apply and drop).
   */
  async stashPop(
    repoPath: string,
    index: number,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['stash', 'pop', `stash@{${index}}`], repoPath, { signal: options?.signal })
  }

  /**
   * Drop a stash.
   */
  async stashDrop(
    repoPath: string,
    index: number,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['stash', 'drop', `stash@{${index}}`], repoPath, { signal: options?.signal })
  }

  /**
   * Show diff for a stash.
   */
  async stashShow(
    repoPath: string,
    index: number,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const result = await this.exec(
      ['stash', 'show', '-p', `stash@{${index}}`],
      repoPath,
      { signal: options?.signal }
    )
    return result.stdout
  }

  /**
   * Checkout a branch.
   */
  async checkout(repoPath: string, branchName: string, options?: { signal?: AbortSignal }): Promise<void> {
    await this.exec(['checkout', branchName], repoPath, { signal: options?.signal })
  }

  /**
   * Create a new branch.
   */
  async createBranch(
    repoPath: string,
    branchName: string,
    baseBranch?: string,
    options?: { signal?: AbortSignal; checkout?: boolean }
  ): Promise<void> {
    if (options?.checkout) {
      const args = ['checkout', '-b', branchName]
      if (baseBranch) args.push(baseBranch)
      await this.exec(args, repoPath, { signal: options?.signal })
    } else {
      const args = ['branch', branchName]
      if (baseBranch) args.push(baseBranch)
      await this.exec(args, repoPath, { signal: options?.signal })
    }
  }

  /**
   * Delete a branch.
   */
  async deleteBranch(
    repoPath: string,
    branchName: string,
    options?: { signal?: AbortSignal; force?: boolean }
  ): Promise<void> {
    const flag = options?.force ? '-D' : '-d'
    await this.exec(['branch', flag, branchName], repoPath, { signal: options?.signal })
  }

  /**
   * Rename a branch.
   */
  async renameBranch(
    repoPath: string,
    oldName: string,
    newName: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['branch', '-m', oldName, newName], repoPath, { signal: options?.signal })
  }

  /**
   * Get remote branches.
   */
  async getRemoteBranches(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ remote: string; branch: string; hash: string }[]> {
    try {
      const format = '%(refname:short)|||%(objectname:short)'
      const result = await this.exec(
        ['branch', '-r', '--format', format],
        repoPath,
        { signal: options?.signal }
      )

      return result.stdout
        .split('\n')
        .filter((line) => line.trim() && !line.includes('/HEAD'))
        .map((line) => {
          const parts = line.split('|||')
          const fullName = parts[0]
          const slashIndex = fullName.indexOf('/')
          return {
            remote: fullName.substring(0, slashIndex),
            branch: fullName.substring(slashIndex + 1),
            hash: parts[1] || ''
          }
        })
    } catch {
      return []
    }
  }

  /**
   * Add a remote.
   */
  async addRemote(
    repoPath: string,
    name: string,
    url: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['remote', 'add', name, url], repoPath, { signal: options?.signal })
  }

  /**
   * Edit a remote URL.
   */
  async editRemoteUrl(
    repoPath: string,
    name: string,
    newUrl: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['remote', 'set-url', name, newUrl], repoPath, { signal: options?.signal })
  }

  /**
   * Remove a remote.
   */
  async removeRemote(
    repoPath: string,
    name: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['remote', 'remove', name], repoPath, { signal: options?.signal })
  }

  /**
   * Fetch from a specific remote or all remotes.
   */
  async fetch(
    repoPath: string,
    remoteName?: string,
    options?: { signal?: AbortSignal; env?: Record<string, string> }
  ): Promise<void> {
    const args = ['fetch']
    if (remoteName) {
      args.push(remoteName)
    } else {
      args.push('--all')
    }
    // Network operations bypass the queue so they can't block local reads
    // (status, log, branch) that the UI depends on for initial load.
    await this.exec(args, repoPath, { signal: options?.signal, noQueue: true, env: options?.env })
  }

  /**
   * Delete a remote branch.
   */
  async deleteRemoteBranch(
    repoPath: string,
    remoteName: string,
    branchName: string,
    options?: { signal?: AbortSignal; env?: Record<string, string> }
  ): Promise<void> {
    await this.exec(['push', remoteName, '--delete', branchName], repoPath, { signal: options?.signal, env: options?.env })
  }

  /**
   * Checkout a remote branch as a local tracking branch.
   */
  async checkoutRemoteBranch(
    repoPath: string,
    remoteName: string,
    branchName: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    // git checkout -b <branch> <remote>/<branch>  (creates local tracking branch)
    await this.exec(
      ['checkout', '-b', branchName, `${remoteName}/${branchName}`],
      repoPath,
      { signal: options?.signal }
    )
  }

  /**
   * Stage specific files (git add).
   */
  async stageFiles(
    repoPath: string,
    filePaths: string[],
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['add', '--', ...filePaths], repoPath, { signal: options?.signal })
  }

  /**
   * Unstage specific files (git restore --staged).
   */
  async unstageFiles(
    repoPath: string,
    filePaths: string[],
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['restore', '--staged', '--', ...filePaths], repoPath, { signal: options?.signal })
  }

  /**
   * Stage all changes (git add -A).
   */
  async stageAll(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['add', '-A'], repoPath, { signal: options?.signal })
  }

  /**
   * Unstage all staged changes (git reset HEAD).
   */
  async unstageAll(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['reset', 'HEAD'], repoPath, { signal: options?.signal })
  }

  /**
   * Stage a hunk by applying a patch to the index.
   * The patch must be a valid unified diff patch string.
   */
  async stageHunk(
    repoPath: string,
    patch: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.applyPatch(repoPath, patch, { cached: true, signal: options?.signal })
  }

  /**
   * Unstage a hunk by reverse-applying a patch from the index.
   */
  async unstageHunk(
    repoPath: string,
    patch: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.applyPatch(repoPath, patch, { cached: true, reverse: true, signal: options?.signal })
  }

  /**
   * Commit staged changes.
   */
  async commit(
    repoPath: string,
    message: string,
    options?: { amend?: boolean; signoff?: boolean; gpgSign?: boolean; gpgKeyId?: string; signal?: AbortSignal }
  ): Promise<{ hash: string; subject: string }> {
    const args = ['commit', '-m', message]
    if (options?.amend) args.push('--amend')
    if (options?.signoff) args.push('--signoff')
    if (options?.gpgSign) {
      if (options.gpgKeyId) {
        args.push(`--gpg-sign=${options.gpgKeyId}`)
      } else {
        args.push('-S')
      }
    }
    const result = await this.exec(args, repoPath, { signal: options?.signal })
    // Parse the output to get the new commit hash
    // Output typically looks like: "[branch abc1234] commit message"
    const match = result.stdout.match(/\[[\w/.-]+ ([a-f0-9]+)\]/)
    const hash = match ? match[1] : ''
    return { hash, subject: message.split('\n')[0] }
  }

  /**
   * Get the last commit message (for amend pre-fill).
   */
  async getLastCommitMessage(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    try {
      const result = await this.exec(
        ['log', '-1', '--format=%B'],
        repoPath,
        { signal: options?.signal }
      )
      return result.stdout.trim()
    } catch {
      return ''
    }
  }

  /**
   * Push current branch to its tracking remote.
   * Supports force push, set-upstream, and progress reporting.
   *
   * By default also pushes annotated tags that are reachable from the commits
   * being pushed (`--follow-tags`). This matches the behavior of most GUI
   * clients (GitKraken, Sourcetree, Fork) and means a user tagging locally and
   * hitting "Push" will publish the tag without a second manual step, while
   * still not spamming every loose tag in the repo (unlike `--tags`).
   */
  async push(
    repoPath: string,
    options?: {
      signal?: AbortSignal
      force?: boolean
      setUpstream?: { remote: string; branch: string }
      followTags?: boolean
      onProgress?: (progress: GitOperationProgress) => void
      env?: Record<string, string>
    }
  ): Promise<void> {
    const args = ['push', '--progress']
    // Default to true — explicit `false` opt-out is supported for scripting.
    if (options?.followTags !== false) args.push('--follow-tags')
    if (options?.force) args.push('--force')
    if (options?.setUpstream) {
      args.push('-u', options.setUpstream.remote, options.setUpstream.branch)
    }

    return this.execWithProgress(repoPath, args, options)
  }

  /**
   * Pull from remote with configurable strategy (merge or rebase).
   *
   * When `autoStash` is enabled, stashes local changes (including untracked
   * files) before pulling and pops the stash afterwards so a dirty working
   * tree doesn't block the pull. If the pop produces conflicts, the stash is
   * left in place for the user to resolve manually.
   */
  async pull(
    repoPath: string,
    options?: {
      signal?: AbortSignal
      rebase?: boolean
      autoStash?: boolean
      onProgress?: (progress: GitOperationProgress) => void
      env?: Record<string, string>
    }
  ): Promise<{ autoStashed: boolean; stashPopConflict: boolean }> {
    const signal = options?.signal

    let autoStashed = false
    if (options?.autoStash) {
      const statusResult = await this.exec(['status', '--porcelain'], repoPath, { signal })
      const isDirty = statusResult.stdout.trim().length > 0
      if (isDirty) {
        await this.exec(
          ['stash', 'push', '--include-untracked', '-m', 'gitslop: auto-stash before pull'],
          repoPath,
          { signal }
        )
        autoStashed = true
      }
    }

    const args = ['pull', '--progress']
    if (options?.rebase) args.push('--rebase')

    try {
      await this.execWithProgress(repoPath, args, options)
    } catch (pullErr) {
      if (autoStashed) {
        const baseMsg = pullErr instanceof Error ? pullErr.message : String(pullErr)
        const wrapped = new Error(
          `${baseMsg}\n\nYour local changes were auto-stashed as "gitslop: auto-stash before pull". Resolve the pull issue, then pop the stash from the Stashes panel.`
        )
        throw wrapped
      }
      throw pullErr
    }

    let stashPopConflict = false
    if (autoStashed) {
      try {
        await this.exec(['stash', 'pop'], repoPath, { signal })
      } catch {
        stashPopConflict = true
      }
    }

    return { autoStashed, stashPopConflict }
  }

  /**
   * Fetch from a specific remote or all remotes, with progress reporting.
   */
  async fetchWithProgress(
    repoPath: string,
    remoteName?: string,
    options?: {
      signal?: AbortSignal
      onProgress?: (progress: GitOperationProgress) => void
      env?: Record<string, string>
    }
  ): Promise<void> {
    const args = ['fetch', '--progress']
    if (remoteName) {
      args.push(remoteName)
    } else {
      args.push('--all')
    }

    return this.execWithProgress(repoPath, args, options)
  }

  /**
   * Check if the current branch has an upstream tracking branch.
   */
  async hasUpstream(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ hasUpstream: boolean; remote?: string; branch?: string }> {
    try {
      const result = await this.exec(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        repoPath,
        { signal: options?.signal }
      )
      const upstream = result.stdout.trim()
      if (upstream) {
        const slashIndex = upstream.indexOf('/')
        return {
          hasUpstream: true,
          remote: upstream.substring(0, slashIndex),
          branch: upstream.substring(slashIndex + 1)
        }
      }
      return { hasUpstream: false }
    } catch {
      return { hasUpstream: false }
    }
  }

  /**
   * Get the current branch name.
   */
  // ─── Merge ──────────────────────────────────────────────────────────────────

  /**
   * Preview how many commits will be merged from a branch.
   */
  async getMergePreview(
    repoPath: string,
    branchName: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ commitCount: number; fastForward: boolean }> {
    // Count commits that would be merged
    const result = await this.exec(
      ['rev-list', '--count', `HEAD..${branchName}`],
      repoPath,
      { signal: options?.signal }
    )
    const commitCount = parseInt(result.stdout.trim(), 10) || 0

    // Check if fast-forward is possible
    let fastForward = false
    try {
      const mergeBase = await this.exec(
        ['merge-base', 'HEAD', branchName],
        repoPath,
        { signal: options?.signal }
      )
      const headHash = await this.exec(
        ['rev-parse', 'HEAD'],
        repoPath,
        { signal: options?.signal }
      )
      fastForward = mergeBase.stdout.trim() === headHash.stdout.trim()
    } catch {
      // Ignore — can't determine fast-forward status
    }

    return { commitCount, fastForward }
  }

  /**
   * Merge a branch into the current branch.
   */
  async merge(
    repoPath: string,
    branchName: string,
    options?: {
      signal?: AbortSignal
      noFastForward?: boolean
      fastForwardOnly?: boolean
      squash?: boolean
    }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const args = ['merge', branchName]

    if (options?.squash) {
      args.push('--squash')
    } else if (options?.noFastForward) {
      args.push('--no-ff')
    } else if (options?.fastForwardOnly) {
      args.push('--ff-only')
    }

    try {
      const result = await this.exec(args, repoPath, { signal: options?.signal })
      const output = (result.stdout + '\n' + result.stderr).trim()
      return { success: true, message: output || 'Merge successful' }
    } catch (err) {
      // Check if it's a conflict
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (stderr.includes('CONFLICT') || stderr.includes('Merge conflict') || stderr.includes('Automatic merge failed')) {
        // Get list of conflicted files
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'Merge resulted in conflicts. Resolve conflicts and commit.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Abort an in-progress merge.
   */
  async mergeAbort(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['merge', '--abort'], repoPath, { signal: options?.signal })
  }

  /**
   * Check if a merge is currently in progress.
   */
  async isMerging(repoPath: string): Promise<boolean> {
    try {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const gitDir = (await this.exec(['rev-parse', '--git-dir'], repoPath)).stdout.trim()
      const mergeHeadPath = join(repoPath, gitDir, 'MERGE_HEAD')
      return existsSync(mergeHeadPath)
    } catch {
      return false
    }
  }

  /**
   * Get list of conflicted files.
   */
  async getConflictedFiles(repoPath: string): Promise<string[]> {
    try {
      const result = await this.exec(
        ['diff', '--name-only', '--diff-filter=U'],
        repoPath
      )
      return result.stdout.trim().split('\n').filter((f) => f.length > 0)
    } catch {
      return []
    }
  }

  // ─── Cherry-Pick ──────────────────────────────────────────────────────────────

  /**
   * Cherry-pick one or more commits onto the current branch.
   */
  async cherryPick(
    repoPath: string,
    hashes: string[],
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; newHash?: string; conflicts?: string[] }> {
    const args = ['cherry-pick', ...hashes]

    try {
      const result = await this.exec(args, repoPath, { signal: options?.signal })
      const output = (result.stdout + '\n' + result.stderr).trim()

      // Try to get the new commit hash after cherry-pick
      let newHash: string | undefined
      try {
        const headResult = await this.exec(['rev-parse', 'HEAD'], repoPath)
        newHash = headResult.stdout.trim()
      } catch {
        // Non-critical
      }

      return { success: true, message: output || 'Cherry-pick successful', newHash }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (
        stderr.includes('CONFLICT') ||
        stderr.includes('conflict') ||
        stderr.includes('cherry-pick is now empty') ||
        stderr.includes('could not apply')
      ) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'Cherry-pick resulted in conflicts. Resolve conflicts and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Abort an in-progress cherry-pick.
   */
  async cherryPickAbort(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['cherry-pick', '--abort'], repoPath, { signal: options?.signal })
  }

  /**
   * Continue cherry-pick after resolving conflicts.
   */
  async cherryPickContinue(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    try {
      const result = await this.exec(
        ['cherry-pick', '--continue'],
        repoPath,
        { signal: options?.signal }
      )
      const output = (result.stdout + '\n' + result.stderr).trim()
      return { success: true, message: output || 'Cherry-pick continued successfully' }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (stderr.includes('CONFLICT') || stderr.includes('conflict') || stderr.includes('could not apply')) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'More conflicts encountered. Resolve and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Check if a cherry-pick is currently in progress.
   */
  async isCherryPicking(repoPath: string): Promise<boolean> {
    try {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const gitDir = (await this.exec(['rev-parse', '--git-dir'], repoPath)).stdout.trim()
      const cherryPickHeadPath = join(repoPath, gitDir, 'CHERRY_PICK_HEAD')
      return existsSync(cherryPickHeadPath)
    } catch {
      return false
    }
  }

  // ─── Rebase ─────────────────────────────────────────────────────────────────

  /**
   * Get a preview of how many commits will be rebased onto a target branch.
   */
  async getRebasePreview(
    repoPath: string,
    ontoBranch: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ commitCount: number; commits: { hash: string; subject: string }[]; isPublished: boolean }> {
    // Count commits on current branch that are not in onto branch
    const result = await this.exec(
      ['rev-list', '--oneline', `${ontoBranch}..HEAD`],
      repoPath,
      { signal: options?.signal }
    )
    const lines = result.stdout.trim().split('\n').filter((l) => l.trim())
    const commits = lines.map((line) => {
      const spaceIndex = line.indexOf(' ')
      return {
        hash: spaceIndex >= 0 ? line.substring(0, spaceIndex) : line,
        subject: spaceIndex >= 0 ? line.substring(spaceIndex + 1) : ''
      }
    })

    // Check if any of these commits have been pushed (are reachable from any remote)
    let isPublished = false
    try {
      const remotesResult = await this.exec(
        ['branch', '-r', '--contains', 'HEAD'],
        repoPath,
        { signal: options?.signal }
      )
      isPublished = remotesResult.stdout.trim().length > 0
    } catch {
      // Ignore — can't determine published status
    }

    return { commitCount: commits.length, commits, isPublished }
  }

  /**
   * Perform a rebase of the current branch onto a target branch.
   */
  async rebase(
    repoPath: string,
    ontoBranch: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    try {
      const result = await this.exec(
        ['rebase', ontoBranch],
        repoPath,
        { signal: options?.signal }
      )
      const output = (result.stdout + '\n' + result.stderr).trim()
      return { success: true, message: output || 'Rebase successful' }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (stderr.includes('CONFLICT') || stderr.includes('conflict') || stderr.includes('Could not apply')) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'Rebase resulted in conflicts. Resolve conflicts and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Perform an interactive rebase using GIT_SEQUENCE_EDITOR to pre-set actions.
   * `actions` is an array mapping commit hashes to actions (pick/squash/edit/drop/reword/fixup).
   */
  async rebaseInteractive(
    repoPath: string,
    ontoBranch: string,
    actions: { hash: string; action: 'pick' | 'squash' | 'edit' | 'drop' | 'reword' | 'fixup' }[],
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    // Build a sed script that replaces "pick <hash>" with "<action> <hash>" for each commit
    // We use GIT_SEQUENCE_EDITOR to modify the rebase-todo file
    const sedCommands = actions
      .filter((a) => a.action !== 'pick')
      .map((a) => `s/^pick ${a.hash.substring(0, 7)}/${a.action} ${a.hash.substring(0, 7)}/`)
      .join(';')

    const sequenceEditor = sedCommands ? `sed -i '${sedCommands}'` : 'true'

    return new Promise<{ success: boolean; message: string; conflicts?: string[] }>((resolve, reject) => {
      const child = spawn('git', ['rebase', '-i', ontoBranch], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_SEQUENCE_EDITOR: sequenceEditor
        }
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', async (code) => {
        if (signal?.aborted) {
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          return
        }

        if (code === 0) {
          resolve({ success: true, message: (stdout + '\n' + stderr).trim() || 'Rebase successful' })
        } else {
          const output = stderr + stdout
          if (output.includes('CONFLICT') || output.includes('conflict') || output.includes('Could not apply')) {
            try {
              const conflicts = await this.getConflictedFiles(repoPath)
              resolve({
                success: false,
                message: 'Rebase resulted in conflicts. Resolve conflicts and continue.',
                conflicts
              })
            } catch {
              resolve({
                success: false,
                message: 'Rebase resulted in conflicts.',
                conflicts: []
              })
            }
          } else {
            reject(this.createError(
              output || 'Rebase failed',
              GitErrorCode.CommandFailed,
              stderr
            ))
          }
        }
      })

      child.on('error', (err) => {
        reject(this.classifyError(
          err as Error & { code?: string | number | null },
          stderr
        ))
      })

      if (signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /**
   * Continue a rebase after resolving conflicts.
   */
  async rebaseContinue(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    return new Promise<{ success: boolean; message: string; conflicts?: string[] }>((resolve, reject) => {
      const child = spawn('git', ['rebase', '--continue'], {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          GIT_EDITOR: 'true' // auto-accept commit messages
        }
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', async (code) => {
        if (options?.signal?.aborted) {
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          return
        }

        if (code === 0) {
          resolve({ success: true, message: (stdout + '\n' + stderr).trim() || 'Rebase continue successful' })
        } else {
          const output = stderr + stdout
          if (output.includes('CONFLICT') || output.includes('conflict') || output.includes('Could not apply')) {
            try {
              const conflicts = await this.getConflictedFiles(repoPath)
              resolve({
                success: false,
                message: 'More conflicts encountered. Resolve and continue.',
                conflicts
              })
            } catch {
              resolve({ success: false, message: 'More conflicts encountered.', conflicts: [] })
            }
          } else if (output.includes('No changes')) {
            // No changes to commit — skip this commit
            resolve({ success: false, message: 'No changes — use skip to continue.' })
          } else {
            reject(this.createError(
              output || 'Rebase continue failed',
              GitErrorCode.CommandFailed,
              stderr
            ))
          }
        }
      })

      child.on('error', (err) => {
        reject(this.classifyError(
          err as Error & { code?: string | number | null },
          stderr
        ))
      })

      if (options?.signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
        }
        options.signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /**
   * Abort an in-progress rebase.
   */
  async rebaseAbort(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['rebase', '--abort'], repoPath, { signal: options?.signal })
  }

  /**
   * Skip the current commit during a rebase.
   */
  async rebaseSkip(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    try {
      const result = await this.exec(
        ['rebase', '--skip'],
        repoPath,
        { signal: options?.signal }
      )
      return { success: true, message: result.stdout.trim() || 'Skipped' }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (stderr.includes('CONFLICT') || stderr.includes('conflict') || stderr.includes('Could not apply')) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'More conflicts after skip. Resolve and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Check if a rebase is currently in progress.
   */
  async isRebasing(repoPath: string): Promise<boolean> {
    try {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const gitDir = (await this.exec(['rev-parse', '--git-dir'], repoPath)).stdout.trim()
      const rebaseMergePath = join(repoPath, gitDir, 'rebase-merge')
      const rebaseApplyPath = join(repoPath, gitDir, 'rebase-apply')
      return existsSync(rebaseMergePath) || existsSync(rebaseApplyPath)
    } catch {
      return false
    }
  }

  /**
   * Get rebase progress information (current step / total steps).
   */
  async getRebaseProgress(repoPath: string): Promise<{ current: number; total: number } | null> {
    try {
      const { readFileSync, existsSync } = await import('fs')
      const { join } = await import('path')
      const gitDir = (await this.exec(['rev-parse', '--git-dir'], repoPath)).stdout.trim()

      // Check rebase-merge (for interactive rebase)
      const rebaseMergePath = join(repoPath, gitDir, 'rebase-merge')
      if (existsSync(rebaseMergePath)) {
        const msgnum = readFileSync(join(rebaseMergePath, 'msgnum'), 'utf-8').trim()
        const end = readFileSync(join(rebaseMergePath, 'end'), 'utf-8').trim()
        return { current: parseInt(msgnum, 10), total: parseInt(end, 10) }
      }

      // Check rebase-apply (for non-interactive rebase)
      const rebaseApplyPath = join(repoPath, gitDir, 'rebase-apply')
      if (existsSync(rebaseApplyPath)) {
        const next = readFileSync(join(rebaseApplyPath, 'next'), 'utf-8').trim()
        const last = readFileSync(join(rebaseApplyPath, 'last'), 'utf-8').trim()
        return { current: parseInt(next, 10), total: parseInt(last, 10) }
      }

      return null
    } catch {
      return null
    }
  }

  async getCurrentBranch(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    try {
      const result = await this.exec(
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        repoPath,
        { signal: options?.signal }
      )
      return result.stdout.trim()
    } catch {
      return ''
    }
  }

  /**
   * Execute a git command with progress reporting via spawn.
   */
  private async execWithProgress(
    repoPath: string,
    args: string[],
    options?: {
      signal?: AbortSignal
      onProgress?: (progress: GitOperationProgress) => void
      env?: Record<string, string>
    }
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(options?.env ? { env: { ...process.env, ...options.env } } : {})
      })

      let stderrOutput = ''

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString()
        stderrOutput += text

        if (options?.onProgress) {
          const progress = this.parseGitProgress(text)
          if (progress) {
            options.onProgress(progress)
          }
        }
      })

      child.stdout?.on('data', (data: Buffer) => {
        // Some git operations output progress on stdout too
        const text = data.toString()
        if (options?.onProgress) {
          const progress = this.parseGitProgress(text)
          if (progress) {
            options.onProgress(progress)
          }
        }
      })

      child.on('close', (code) => {
        if (signal?.aborted) {
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          return
        }

        if (code === 0) {
          resolve()
        } else {
          reject(this.classifyError(
            Object.assign(new Error('git command failed'), { code: code ?? 1 }),
            stderrOutput
          ))
        }
      })

      child.on('error', (err) => {
        reject(this.classifyError(
          err as Error & { code?: string | number | null },
          stderrOutput
        ))
      })

      if (signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  /**
   * Parse progress from git command output.
   */
  private parseGitProgress(text: string): GitOperationProgress | null {
    // Match: "Receiving objects:  50% (21/42), 1.5 MiB | 500.00 KiB/s"
    // Match: "Counting objects: 100% (42/42), done."
    // Match: "Compressing objects: 100% (42/42)"
    // Match: "Writing objects: 100% (3/3), 285 bytes | 285.00 KiB/s, done."
    const progressMatch = text.match(/([\w\s]+):\s+(\d+)%\s+\((\d+)\/(\d+)\)/)
    if (progressMatch) {
      return {
        phase: progressMatch[1].trim(),
        percent: parseInt(progressMatch[2], 10),
        current: parseInt(progressMatch[3], 10),
        total: parseInt(progressMatch[4], 10)
      }
    }

    // Match phase-only lines
    const phaseMatch = text.match(/(Enumerating|Counting|Compressing|Writing|Receiving|Resolving|Unpacking|remote:.*?)[\s.,:]/i)
    if (phaseMatch) {
      return {
        phase: phaseMatch[1].trim(),
        percent: null,
        current: null,
        total: null
      }
    }

    return null
  }

  /**
   * Apply a patch string via git apply.
   */
  private async applyPatch(
    repoPath: string,
    patch: string,
    options?: { cached?: boolean; reverse?: boolean; signal?: AbortSignal }
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    return new Promise<void>((resolve, reject) => {
      const args = ['apply']
      if (options?.cached) args.push('--cached')
      if (options?.reverse) args.push('--reverse')
      args.push('--unidiff-zero', '--whitespace=nowarn', '-')

      const child = spawn('git', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      let stderr = ''
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code) => {
        if (signal?.aborted) {
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
          return
        }
        if (code === 0) {
          resolve()
        } else {
          reject(this.createError(
            stderr || 'Failed to apply patch',
            GitErrorCode.CommandFailed,
            stderr
          ))
        }
      })

      child.on('error', (err) => {
        reject(this.classifyError(
          err as Error & { code?: string | number | null },
          stderr
        ))
      })

      if (signal) {
        const onAbort = (): void => {
          child.kill('SIGTERM')
          reject(this.createError('Operation cancelled', GitErrorCode.Cancelled))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      // Write patch to stdin and close
      child.stdin?.write(patch)
      child.stdin?.end()
    })
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private parseLogOutput(output: string, separator: string, recordEnd: string): GitCommit[] {
    const records = recordEnd
      ? output.split(recordEnd).filter((r) => r.trim())
      : [output]

    return records.map((record) => {
      const parts = record.trim().split(separator)
      return {
        hash: parts[0] || '',
        shortHash: parts[1] || '',
        parentHashes: (parts[2] || '').split(' ').filter(Boolean),
        authorName: parts[3] || '',
        authorEmail: parts[4] || '',
        authorDate: parts[5] || '',
        committerName: parts[6] || '',
        committerEmail: parts[7] || '',
        commitDate: parts[8] || '',
        subject: parts[9] || '',
        body: parts[10] || '',
        refs: parts[11] || '',
        signatureStatus: parseSignatureStatus(parts[12] || ''),
        signer: parts[13] || '',
        signingKey: parts[14] || ''
      }
    })
  }

  private parseStatusOutput(output: string): GitRepoStatus {
    const status: GitRepoStatus = {
      branch: '',
      upstream: null,
      ahead: 0,
      behind: 0,
      staged: [],
      unstaged: [],
      untracked: []
    }

    const lines = output.split('\n').filter((l) => l.trim())

    for (const line of lines) {
      if (line.startsWith('# branch.head ')) {
        status.branch = line.substring('# branch.head '.length)
      } else if (line.startsWith('# branch.upstream ')) {
        status.upstream = line.substring('# branch.upstream '.length)
      } else if (line.startsWith('# branch.ab ')) {
        const match = line.match(/# branch\.ab \+(\d+) -(\d+)/)
        if (match) {
          status.ahead = parseInt(match[1], 10)
          status.behind = parseInt(match[2], 10)
        }
      } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
        // Changed entries (1 = ordinary, 2 = rename/copy)
        this.parseChangedEntry(line, status)
      } else if (line.startsWith('? ')) {
        // Untracked
        const path = line.substring(2)
        status.untracked.push({
          path,
          status: 'untracked',
          staged: false,
          indexStatus: '?',
          workTreeStatus: '?'
        })
      }
    }

    return status
  }

  private parseChangedEntry(line: string, status: GitRepoStatus): void {
    const parts = line.split(' ')
    const isRename = parts[0] === '2'
    const xy = parts[1] // XY status codes
    const indexStatus = xy[0]
    const workTreeStatus = xy[1]

    // For renames, path is at end after a tab
    let path: string
    let oldPath: string | undefined

    if (isRename) {
      const tabIndex = line.indexOf('\t')
      if (tabIndex >= 0) {
        const paths = line.substring(tabIndex + 1).split('\t')
        path = paths[1] || paths[0]
        oldPath = paths[0]
      } else {
        path = parts[parts.length - 1]
      }
    } else {
      path = parts[parts.length - 1]
    }

    const statusMap: Record<string, GitFileStatus['status']> = {
      'A': 'added',
      'M': 'modified',
      'D': 'deleted',
      'R': 'renamed',
      'C': 'copied'
    }

    // Staged changes (index has something other than '.')
    if (indexStatus !== '.') {
      status.staged.push({
        path,
        oldPath,
        status: statusMap[indexStatus] || 'modified',
        staged: true,
        indexStatus,
        workTreeStatus
      })
    }

    // Unstaged changes (worktree has something other than '.')
    if (workTreeStatus !== '.') {
      status.unstaged.push({
        path,
        oldPath,
        status: statusMap[workTreeStatus] || 'modified',
        staged: false,
        indexStatus,
        workTreeStatus
      })
    }
  }

  private parseCloneProgress(text: string, _fullOutput: string): CloneProgress {
    // Git uses \r to overwrite a single progress line, so a chunk may contain
    // many lines — only the last meaningful one represents current state.
    const lines = text.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean)
    // Walk from the end and pick the first line we can parse meaningfully.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].replace(/^remote:\s*/i, '')

      // Full progress line:
      //   "Receiving objects:  50% (21/42), 1.52 MiB | 500.00 KiB/s"
      //   "Compressing objects: 100% (7123/7123), done."
      const fullMatch = line.match(
        /^([A-Za-z][\w\s]*?):\s+(\d+)%\s+\((\d+)\/(\d+)\)(?:,\s*([\d.]+\s*[KMG]?i?B))?(?:\s*\|\s*([\d.]+\s*[KMG]?i?B\/s))?/
      )
      if (fullMatch) {
        return {
          phase: fullMatch[1].trim(),
          percent: parseInt(fullMatch[2], 10),
          current: parseInt(fullMatch[3], 10),
          total: parseInt(fullMatch[4], 10),
          bytes: fullMatch[5]?.trim(),
          rate: fullMatch[6]?.trim()
        }
      }

      // Countup without percent, e.g. "Enumerating objects: 15238, done."
      const countMatch = line.match(/^([A-Za-z][\w\s]*?):\s+(\d+)(?:,|$)/)
      if (countMatch) {
        return {
          phase: countMatch[1].trim(),
          percent: null,
          current: parseInt(countMatch[2], 10),
          total: null
        }
      }

      // Phase-only status lines
      if (/^Cloning into/i.test(line)) {
        return { phase: 'Cloning...', percent: null, current: null, total: null }
      }
      if (/^Updating files:/i.test(line)) {
        // "Updating files:  42% (100/238)"
        const m = line.match(/Updating files:\s+(\d+)%(?:\s+\((\d+)\/(\d+)\))?/)
        if (m) {
          return {
            phase: 'Updating files',
            percent: parseInt(m[1], 10),
            current: m[2] ? parseInt(m[2], 10) : null,
            total: m[3] ? parseInt(m[3], 10) : null
          }
        }
      }
    }

    return { phase: 'Working...', percent: null, current: null, total: null }
  }

  private classifyError(error: Error & { code?: string | number | null; killed?: boolean }, stderr: string): GitError {
    const msg = stderr || error.message

    if (error.code === 'ENOENT') {
      return this.createError('Git is not installed or not found in PATH', GitErrorCode.GitNotInstalled, stderr)
    }

    if (msg.includes('not a git repository')) {
      return this.createError('Not a git repository', GitErrorCode.NotARepository, stderr)
    }

    if (
      msg.includes('Authentication failed') ||
      msg.includes('could not read Username') ||
      msg.includes('Permission denied') ||
      msg.includes('fatal: could not read Password')
    ) {
      return this.createError('Authentication failed', GitErrorCode.AuthFailure, stderr)
    }

    if (
      msg.includes('Could not resolve host') ||
      msg.includes('unable to access') ||
      msg.includes('Connection refused') ||
      msg.includes('Network is unreachable')
    ) {
      return this.createError('Network error', GitErrorCode.NetworkError, stderr)
    }

    if (msg.includes('CONFLICT') || msg.includes('Merge conflict')) {
      return this.createError('Merge conflict', GitErrorCode.MergeConflict, stderr)
    }

    if (error.killed) {
      return this.createError('Operation cancelled', GitErrorCode.Cancelled, stderr)
    }

    return this.createError(msg || 'Git command failed', GitErrorCode.CommandFailed, stderr)
  }

  // ─── Reset ──────────────────────────────────────────────────────────────────

  /**
   * Reset current branch to a specific commit.
   * @param mode - 'soft' keeps changes staged, 'mixed' keeps changes unstaged, 'hard' discards all changes
   */
  async reset(
    repoPath: string,
    targetHash: string,
    mode: 'soft' | 'mixed' | 'hard',
    _options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string }> {
    const args = ['reset', `--${mode}`, targetHash]
    const result = await this.exec(args, repoPath, { signal: _options?.signal })
    const output = (result.stdout + '\n' + result.stderr).trim()
    return {
      success: true,
      message: output || `Reset (${mode}) to ${targetHash.substring(0, 7)} successful`
    }
  }

  // ─── Revert ──────────────────────────────────────────────────────────────────

  /**
   * Revert a commit, creating a new revert commit.
   * For merge commits, parentNumber (1 or 2) must be specified.
   */
  async revert(
    repoPath: string,
    hash: string,
    options?: { parentNumber?: number; signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; newHash?: string; conflicts?: string[] }> {
    try {
      const args = ['revert', '--no-edit']
      if (options?.parentNumber) {
        args.push('-m', String(options.parentNumber))
      }
      args.push(hash)

      const result = await this.exec(args, repoPath, { signal: options?.signal })
      const output = (result.stdout + '\n' + result.stderr).trim()

      // Try to get the new commit hash
      let newHash: string | undefined
      try {
        const headResult = await this.exec(['rev-parse', 'HEAD'], repoPath)
        newHash = headResult.stdout.trim()
      } catch {
        // Ignore
      }

      return {
        success: true,
        message: output || `Reverted commit ${hash.substring(0, 7)} successfully`,
        newHash
      }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''

      if (stderr.includes('CONFLICT') || stderr.includes('conflict') || stderr.includes('could not revert')) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: stderr || 'Revert resulted in conflicts. Resolve them and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Abort an in-progress revert.
   */
  async revertAbort(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['revert', '--abort'], repoPath, { signal: options?.signal })
  }

  /**
   * Continue a revert after resolving conflicts.
   */
  async revertContinue(
    repoPath: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ success: boolean; message: string; newHash?: string; conflicts?: string[] }> {
    try {
      const result = await this.exec(
        ['revert', '--continue'],
        repoPath,
        { signal: options?.signal }
      )

      let newHash: string | undefined
      try {
        const headResult = await this.exec(['rev-parse', 'HEAD'], repoPath)
        newHash = headResult.stdout.trim()
      } catch {
        // Ignore
      }

      return {
        success: true,
        message: result.stdout.trim() || 'Revert completed successfully',
        newHash
      }
    } catch (err) {
      const gitErr = err as GitError
      const stderr = gitErr.stderr || gitErr.message || ''
      if (stderr.includes('CONFLICT') || stderr.includes('conflict')) {
        const conflicts = await this.getConflictedFiles(repoPath)
        return {
          success: false,
          message: 'More conflicts. Resolve and continue.',
          conflicts
        }
      }
      throw err
    }
  }

  /**
   * Check if a revert is currently in progress.
   */
  async isReverting(repoPath: string): Promise<boolean> {
    try {
      const { existsSync } = await import('fs')
      const { join } = await import('path')
      const gitDir = (await this.exec(['rev-parse', '--git-dir'], repoPath)).stdout.trim()
      const revertHeadPath = join(repoPath, gitDir, 'REVERT_HEAD')
      return existsSync(revertHeadPath)
    } catch {
      return false
    }
  }

  // ─── Conflict Resolution ────────────────────────────────────────────────────

  /**
   * Get the content of a conflicted file from different stages.
   * Stage 1 = base (common ancestor), Stage 2 = ours, Stage 3 = theirs.
   */
  async getConflictContent(
    repoPath: string,
    filePath: string
  ): Promise<{
    base: string | null
    ours: string | null
    theirs: string | null
    merged: string
  }> {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')

    // Read the current file with conflict markers
    let merged = ''
    try {
      merged = readFileSync(join(repoPath, filePath), 'utf-8')
    } catch {
      merged = ''
    }

    // Get content from git object store for each stage
    const getStage = async (stage: number): Promise<string | null> => {
      try {
        const result = await this.exec(['show', `:${stage}:${filePath}`], repoPath)
        return result.stdout
      } catch {
        return null
      }
    }

    const [base, ours, theirs] = await Promise.all([
      getStage(1),
      getStage(2),
      getStage(3)
    ])

    return { base, ours, theirs, merged }
  }

  /**
   * Write resolved content for a conflicted file and stage it (mark as resolved).
   */
  async resolveConflictFile(repoPath: string, filePath: string, content: string): Promise<void> {
    const { writeFileSync } = await import('fs')
    const { join } = await import('path')

    // Write the resolved content
    writeFileSync(join(repoPath, filePath), content, 'utf-8')

    // Stage the file (marks it as resolved)
    await this.exec(['add', filePath], repoPath)
  }

  /**
   * Resolve a file by choosing ours or theirs version entirely.
   */
  async resolveConflictFileWith(
    repoPath: string,
    filePath: string,
    choice: 'ours' | 'theirs'
  ): Promise<void> {
    await this.exec(['checkout', `--${choice}`, filePath], repoPath)
    await this.exec(['add', filePath], repoPath)
  }

  /**
   * Determine what git operation is currently in progress.
   */
  async getActiveOperation(
    repoPath: string
  ): Promise<'merge' | 'rebase' | 'cherry-pick' | 'revert' | null> {
    const [merging, rebasing, cherryPicking, reverting] = await Promise.all([
      this.isMerging(repoPath),
      this.isRebasing(repoPath),
      this.isCherryPicking(repoPath),
      this.isReverting(repoPath)
    ])
    if (merging) return 'merge'
    if (rebasing) return 'rebase'
    if (cherryPicking) return 'cherry-pick'
    if (reverting) return 'revert'
    return null
  }

  /**
   * Get blame annotations for a file.
   * Uses git blame --porcelain for structured output.
   */
  async blame(
    repoPath: string,
    filePath: string
  ): Promise<{
    lines: {
      hash: string
      shortHash: string
      author: string
      authorEmail: string
      authorDate: string
      summary: string
      lineNumber: number
      content: string
    }[]
  }> {
    const result = await this.exec(
      ['blame', '--porcelain', filePath],
      repoPath
    )
    const stdout = result.stdout
    const lines: {
      hash: string
      shortHash: string
      author: string
      authorEmail: string
      authorDate: string
      summary: string
      lineNumber: number
      content: string
    }[] = []

    const rawLines = stdout.split('\n')
    let i = 0
    while (i < rawLines.length) {
      const headerLine = rawLines[i]
      if (!headerLine) {
        i++
        continue
      }

      // Header: <hash> <orig-line> <final-line> [<num-lines>]
      const headerMatch = headerLine.match(/^([0-9a-f]{40})\s+(\d+)\s+(\d+)/)
      if (!headerMatch) {
        i++
        continue
      }

      const hash = headerMatch[1]
      const finalLine = parseInt(headerMatch[3], 10)

      // Parse key-value pairs until we hit the content line (starts with \t)
      let author = ''
      let authorEmail = ''
      let authorTime = ''
      let summary = ''
      i++

      while (i < rawLines.length && !rawLines[i].startsWith('\t')) {
        const line = rawLines[i]
        if (line.startsWith('author ')) {
          author = line.slice(7)
        } else if (line.startsWith('author-mail ')) {
          authorEmail = line.slice(12).replace(/[<>]/g, '')
        } else if (line.startsWith('author-time ')) {
          authorTime = line.slice(12)
        } else if (line.startsWith('summary ')) {
          summary = line.slice(8)
        }
        i++
      }

      // Content line (starts with \t)
      let content = ''
      if (i < rawLines.length && rawLines[i].startsWith('\t')) {
        content = rawLines[i].slice(1)
        i++
      }

      // Convert author-time (unix timestamp) to ISO date string
      const authorDate = authorTime
        ? new Date(parseInt(authorTime, 10) * 1000).toISOString()
        : ''

      lines.push({
        hash,
        shortHash: hash.slice(0, 7),
        author,
        authorEmail,
        authorDate,
        summary,
        lineNumber: finalLine,
        content
      })
    }

    return { lines }
  }

  /**
   * Discard changes to tracked files (git checkout -- <files>).
   * For untracked files, use git clean -f -- <files>.
   */
  async discardFiles(
    repoPath: string,
    filePaths: string[],
    opts?: { untracked?: boolean }
  ): Promise<void> {
    if (filePaths.length === 0) return

    if (opts?.untracked) {
      // Remove untracked files
      await this.exec(['clean', '-f', '--', ...filePaths], repoPath)
    } else {
      // Discard changes to tracked files
      await this.exec(['checkout', '--', ...filePaths], repoPath)
    }
  }

  /**
   * Discard a hunk by reverse-applying a patch to the working directory.
   */
  async discardHunk(
    repoPath: string,
    patch: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    return this.applyPatch(repoPath, patch, { reverse: true, signal: options?.signal })
  }

  /**
   * Get log for a specific file path.
   */
  async fileLog(
    repoPath: string,
    filePath: string,
    maxCount = 50
  ): Promise<GitCommit[]> {
    const result = await this.exec(
      [
        'log',
        `--max-count=${maxCount}`,
        '--format=%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00%D%x00%G?%x00%GS%x00%GK',
        '--',
        filePath
      ],
      repoPath
    )
    const commits: GitCommit[] = []
    for (const line of result.stdout.split('\n').filter(Boolean)) {
      const parts = line.split('\0')
      if (parts.length >= 10) {
        commits.push({
          hash: parts[0],
          shortHash: parts[1],
          parentHashes: parts[2].split(' ').filter(Boolean),
          authorName: parts[3],
          authorEmail: parts[4],
          authorDate: parts[5],
          committerName: parts[6],
          committerEmail: parts[7],
          commitDate: parts[8],
          subject: parts[9],
          body: parts[10] || '',
          refs: parts[11] || '',
          signatureStatus: parseSignatureStatus(parts[12] || ''),
          signer: parts[13] || '',
          signingKey: parts[14] || ''
        })
      }
    }
    return commits
  }

  private createError(message: string, code: GitErrorCode, stderr?: string): GitError {
    return { message, code, stderr }
  }

  // ─── Submodules ─────────────────────────────────────────────────────────────

  /**
   * List submodules with their status.
   */
  async getSubmodules(repoPath: string): Promise<{
    name: string
    path: string
    url: string
    status: 'initialized' | 'uninitialized' | 'dirty' | 'out-of-date'
    hash: string
    describe: string
  }[]> {
    // First check if .gitmodules exists
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    if (!existsSync(join(repoPath, '.gitmodules'))) {
      return []
    }

    // Get submodule config info
    const submodules: {
      name: string
      path: string
      url: string
      status: 'initialized' | 'uninitialized' | 'dirty' | 'out-of-date'
      hash: string
      describe: string
    }[] = []

    // Parse .gitmodules for name/path/url
    let configOutput: string
    try {
      const result = await this.exec(
        ['config', '--file', '.gitmodules', '--list'],
        repoPath
      )
      configOutput = result.stdout
    } catch {
      return []
    }

    const moduleMap = new Map<string, { path: string; url: string }>()
    for (const line of configOutput.split('\n')) {
      const match = line.match(/^submodule\.(.+?)\.(path|url)=(.+)$/)
      if (match) {
        const [, name, key, value] = match
        if (!moduleMap.has(name)) {
          moduleMap.set(name, { path: '', url: '' })
        }
        const entry = moduleMap.get(name)!
        if (key === 'path') entry.path = value
        if (key === 'url') entry.url = value
      }
    }

    // Get submodule status
    let statusOutput: string
    try {
      const result = await this.exec(['submodule', 'status'], repoPath)
      statusOutput = result.stdout
    } catch {
      statusOutput = ''
    }

    // Parse status output: each line is [+-U ]<hash> <path> (<describe>)
    const statusMap = new Map<string, { status: string; hash: string; describe: string }>()
    for (const line of statusOutput.split('\n')) {
      if (!line.trim()) continue
      // Format: [+-U ]<40-char hash> <path> (<describe>)
      const statusMatch = line.match(/^([+-U ]?)([0-9a-f]+)\s+(\S+)(?:\s+\((.+)\))?$/)
      if (statusMatch) {
        const [, prefix, hash, path, describe] = statusMatch
        statusMap.set(path, {
          status: prefix,
          hash: hash,
          describe: describe || ''
        })
      }
    }

    for (const [name, config] of moduleMap) {
      const statusInfo = statusMap.get(config.path)
      let status: 'initialized' | 'uninitialized' | 'dirty' | 'out-of-date' = 'uninitialized'
      let hash = ''
      let describe = ''

      if (statusInfo) {
        hash = statusInfo.hash
        describe = statusInfo.describe
        switch (statusInfo.status) {
          case '-':
            status = 'uninitialized'
            break
          case '+':
            status = 'out-of-date'
            break
          case 'U':
            status = 'dirty'
            break
          default:
            status = 'initialized'
            break
        }
      }

      // Also check if the submodule working tree is dirty
      if (status === 'initialized') {
        try {
          const dirtyResult = await this.exec(
            ['diff', '--quiet', '--ignore-submodules=none', '--', config.path],
            repoPath
          )
          // If diff exits non-zero, the submodule is dirty
          void dirtyResult
        } catch {
          status = 'dirty'
        }
      }

      submodules.push({
        name,
        path: config.path,
        url: config.url,
        status,
        hash,
        describe
      })
    }

    return submodules
  }

  /**
   * Initialize a submodule.
   */
  async submoduleInit(repoPath: string, submodulePath: string): Promise<void> {
    await this.exec(['submodule', 'init', submodulePath], repoPath)
  }

  /**
   * Update a submodule (fetch and checkout correct commit).
   */
  async submoduleUpdate(repoPath: string, submodulePath: string): Promise<void> {
    await this.exec(['submodule', 'update', '--init', submodulePath], repoPath)
  }

  private emptyCommit(): GitCommit {
    return {
      hash: '', shortHash: '', parentHashes: [],
      authorName: '', authorEmail: '', authorDate: '',
      committerName: '', committerEmail: '', commitDate: '',
      subject: '', body: '', refs: '',
      signatureStatus: 'none', signer: '', signingKey: ''
    }
  }

  /**
   * List available GPG secret keys for commit signing.
   */
  async getAvailableGpgKeys(): Promise<GpgKey[]> {
    try {
      const { execFile: execFileCb } = await import('child_process')
      return new Promise((resolve) => {
        execFileCb(
          'gpg',
          ['--list-secret-keys', '--with-colons'],
          { timeout: 5000 },
          (error, stdout) => {
            if (error || !stdout) {
              resolve([])
              return
            }
            const keys: GpgKey[] = []
            let currentFingerprint = ''
            let currentKeyId = ''
            const lines = stdout.split('\n')
            for (const line of lines) {
              const fields = line.split(':')
              if (fields[0] === 'sec') {
                currentKeyId = fields[4] || ''
              } else if (fields[0] === 'fpr' && !currentFingerprint && currentKeyId) {
                currentFingerprint = fields[9] || ''
              } else if (fields[0] === 'uid' && currentKeyId) {
                keys.push({
                  keyId: currentKeyId,
                  uid: fields[9] || '',
                  fingerprint: currentFingerprint
                })
                currentKeyId = ''
                currentFingerprint = ''
              }
            }
            resolve(keys)
          }
        )
      })
    } catch {
      return []
    }
  }

  /**
   * Get the user's configured GPG signing key from git config.
   */
  async getGitSigningKey(repoPath: string): Promise<string> {
    try {
      const result = await this.exec(['config', '--get', 'user.signingKey'], repoPath)
      return result.stdout.trim()
    } catch {
      // Not set
      return ''
    }
  }

  /**
   * Set the GPG signing key in git config (local to repo).
   */
  async setGitSigningKey(repoPath: string, keyId: string): Promise<void> {
    if (keyId) {
      await this.exec(['config', 'user.signingKey', keyId], repoPath)
    } else {
      try {
        await this.exec(['config', '--unset', 'user.signingKey'], repoPath)
      } catch {
        // Ignore if not set
      }
    }
  }
}

// Export a singleton instance
export const gitService = new GitService()
