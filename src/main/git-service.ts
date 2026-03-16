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
    options?: { maxCount?: number; all?: boolean; signal?: AbortSignal }
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
