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

export interface CloneProgress {
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

// ─── Queue Implementation ────────────────────────────────────────────────────

interface QueueItem {
  fn: () => Promise<GitExecResult>
  resolve: (value: GitExecResult) => void
  reject: (reason: unknown) => void
}

class CommandQueue {
  private queues: Map<string, QueueItem[]> = new Map()
  private running: Map<string, boolean> = new Map()

  async enqueue(repoPath: string, fn: () => Promise<GitExecResult>): Promise<GitExecResult> {
    return new Promise<GitExecResult>((resolve, reject) => {
      if (!this.queues.has(repoPath)) {
        this.queues.set(repoPath, [])
      }
      this.queues.get(repoPath)!.push({ fn, resolve, reject })
      this.processNext(repoPath)
    })
  }

  private async processNext(repoPath: string): Promise<void> {
    if (this.running.get(repoPath)) return

    const queue = this.queues.get(repoPath)
    if (!queue || queue.length === 0) return

    this.running.set(repoPath, true)
    const item = queue.shift()!

    try {
      const result = await item.fn()
      item.resolve(result)
    } catch (err) {
      item.reject(err)
    } finally {
      this.running.set(repoPath, false)
      this.processNext(repoPath)
    }
  }
}

// ─── GitService ──────────────────────────────────────────────────────────────

export class GitService {
  private queue = new CommandQueue()
  private cachedVersion: GitVersion | null = null

  /**
   * Execute a raw git command with queuing and cancellation support.
   */
  async exec(
    args: string[],
    repoPath: string,
    options?: { signal?: AbortSignal; noQueue?: boolean }
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
          timeout: 120_000 // 2 minute timeout
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

    return this.queue.enqueue(repoPath, execFn)
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
      '%D'     // refs
    ].join(SEPARATOR)

    const args = ['log', `--format=${format}${RECORD_END}`]
    if (options?.all) args.push('--all')
    if (options?.maxCount) args.push(`-n`, `${options.maxCount}`)
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
      '%(creatordate:iso-strict)'
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
          return {
            name: parts[0],
            hash: parts[1],
            isAnnotated: parts[2] === 'tag',
            message: parts[3] || '',
            taggerDate: parts[4] || ''
          }
        })
    } catch {
      return []
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
   * Get commit details including changed files.
   */
  async showCommit(
    repoPath: string,
    hash: string,
    options?: { signal?: AbortSignal }
  ): Promise<{ commit: GitCommit; files: string[] }> {
    const SEPARATOR = '<<<SEP>>>'
    const format = [
      '%H', '%h', '%P', '%an', '%ae', '%aI',
      '%cn', '%ce', '%cI', '%s', '%b', '%D'
    ].join(SEPARATOR)

    const result = await this.exec(
      ['show', '--format=' + format, '--stat', '--stat-width=200', hash],
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

    return { commit, files }
  }

  /**
   * Get the diff of a specific file in a commit.
   */
  async showCommitFileDiff(
    repoPath: string,
    hash: string,
    filePath: string,
    options?: { signal?: AbortSignal }
  ): Promise<string> {
    const args = ['show', '--format=', '--patch', hash, '--', filePath]
    const result = await this.exec(args, repoPath, { signal: options?.signal })
    return result.stdout
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
    }
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn('git', ['clone', '--progress', url, destPath], {
        stdio: ['pipe', 'pipe', 'pipe']
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
    const args = ['tag']
    if (options?.message) {
      args.push('-a', name, '-m', options.message)
    } else {
      args.push(name)
    }
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
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const remote = remoteName || 'origin'
    await this.exec(['push', remote, `refs/tags/${tagName}`], repoPath, { signal: options?.signal })
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
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    const args = ['fetch']
    if (remoteName) {
      args.push(remoteName)
    } else {
      args.push('--all')
    }
    await this.exec(args, repoPath, { signal: options?.signal })
  }

  /**
   * Delete a remote branch.
   */
  async deleteRemoteBranch(
    repoPath: string,
    remoteName: string,
    branchName: string,
    options?: { signal?: AbortSignal }
  ): Promise<void> {
    await this.exec(['push', remoteName, '--delete', branchName], repoPath, { signal: options?.signal })
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
    options?: { amend?: boolean; signoff?: boolean; signal?: AbortSignal }
  ): Promise<{ hash: string; subject: string }> {
    const args = ['commit', '-m', message]
    if (options?.amend) args.push('--amend')
    if (options?.signoff) args.push('--signoff')
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
   */
  async push(
    repoPath: string,
    options?: {
      signal?: AbortSignal
      force?: boolean
      setUpstream?: { remote: string; branch: string }
      onProgress?: (progress: GitOperationProgress) => void
    }
  ): Promise<void> {
    const args = ['push', '--progress']
    if (options?.force) args.push('--force')
    if (options?.setUpstream) {
      args.push('-u', options.setUpstream.remote, options.setUpstream.branch)
    }

    return this.execWithProgress(repoPath, args, options)
  }

  /**
   * Pull from remote with configurable strategy (merge or rebase).
   */
  async pull(
    repoPath: string,
    options?: {
      signal?: AbortSignal
      rebase?: boolean
      onProgress?: (progress: GitOperationProgress) => void
    }
  ): Promise<void> {
    const args = ['pull', '--progress']
    if (options?.rebase) args.push('--rebase')

    return this.execWithProgress(repoPath, args, options)
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
    }
  ): Promise<{ success: boolean; message: string; conflicts?: string[] }> {
    const args = ['merge', branchName]

    if (options?.noFastForward) {
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
    }
  ): Promise<void> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw this.createError('Operation cancelled', GitErrorCode.Cancelled)
    }

    return new Promise<void>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: repoPath,
        stdio: ['pipe', 'pipe', 'pipe']
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
        refs: parts[11] || ''
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
    // Match lines like "Receiving objects:  50% (21/42), 1.5 MiB | 500.00 KiB/s"
    const progressMatch = text.match(/([\w\s]+):\s+(\d+)%\s+\((\d+)\/(\d+)\)/)
    if (progressMatch) {
      return {
        phase: progressMatch[1].trim(),
        percent: parseInt(progressMatch[2], 10),
        current: parseInt(progressMatch[3], 10),
        total: parseInt(progressMatch[4], 10)
      }
    }

    // Match phase-only lines like "Cloning into 'repo'..."
    const phaseMatch = text.match(/(Cloning into|Counting objects|Compressing objects|remote:.*?)[\s.,:]/i)
    if (phaseMatch) {
      return {
        phase: phaseMatch[1].trim(),
        percent: null,
        current: null,
        total: null
      }
    }

    return { phase: 'Cloning...', percent: null, current: null, total: null }
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

  private createError(message: string, code: GitErrorCode, stderr?: string): GitError {
    return { message, code, stderr }
  }

  private emptyCommit(): GitCommit {
    return {
      hash: '', shortHash: '', parentHashes: [],
      authorName: '', authorEmail: '', authorDate: '',
      committerName: '', committerEmail: '', commitDate: '',
      subject: '', body: '', refs: ''
    }
  }
}

// Export a singleton instance
export const gitService = new GitService()
