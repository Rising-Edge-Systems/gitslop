/**
 * Git IPC handlers — bridges GitService to the renderer process via ipcMain.
 */

import { ipcMain, BrowserWindow } from 'electron'
import { gitService, GitErrorCode } from './git-service'
import type { GitError } from './git-service'
import { gitOperationStarted, gitOperationFinished, sendRepoChangedForced, store } from './index'
import { buildCredentialEnv } from './git-credential'

/**
 * Wrap a git operation that modifies .git/ directory (commits, checkouts, merges, etc.)
 * to suppress file watcher events during the operation and for 1s after.
 */
async function withWatcherSuppression<T>(fn: () => Promise<T>): Promise<T> {
  gitOperationStarted()
  try {
    const result = await fn()
    // After successful git operation, force a repo:changed event
    // so the UI refreshes immediately (watcher events are suppressed)
    sendRepoChangedForced()
    return result
  } finally {
    gitOperationFinished()
  }
}

// Track active AbortControllers so we can cancel operations
const activeControllers = new Map<string, AbortController>()

function createOperationId(): string {
  return `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function formatError(err: unknown): { error: string; code: string } {
  if (err && typeof err === 'object' && 'code' in err) {
    const gitErr = err as GitError
    return { error: gitErr.message, code: gitErr.code }
  }
  return {
    error: err instanceof Error ? err.message : 'Unknown error',
    code: GitErrorCode.UnknownError
  }
}

/**
 * Resolve credential environment variables for a repo's push remote.
 * Returns env vars to inject into git commands, or undefined if no
 * stored account matches the remote.
 */
async function getCredentialEnv(repoPath: string): Promise<Record<string, string> | undefined> {
  try {
    const remotes = await gitService.getRemotes(repoPath)
    const origin = remotes.find(r => r.name === 'origin') || remotes[0]
    if (!origin) return undefined

    const remoteUrl = origin.pushUrl || origin.fetchUrl
    if (!remoteUrl) return undefined

    interface StoredAccount { username: string; token: string; instanceUrl?: string }
    const env = buildCredentialEnv(
      remoteUrl,
      () => store.get('githubAccounts', []) as StoredAccount[],
      () => store.get('gitlabAccounts', []) as StoredAccount[]
    )
    return env ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Resolve credential environment for a clone URL (no repo exists yet).
 */
function getCredentialEnvForUrl(url: string): Record<string, string> | undefined {
  interface StoredAccount { username: string; token: string; instanceUrl?: string }
  const env = buildCredentialEnv(
    url,
    () => store.get('githubAccounts', []) as StoredAccount[],
    () => store.get('gitlabAccounts', []) as StoredAccount[]
  )
  return env ?? undefined
}

export function registerGitIpcHandlers(): void {
  // ─── Version ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:getVersion', async () => {
    try {
      return { success: true, data: await gitService.getVersion() }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Repo checks (overrides existing handlers from US-003) ───────────────

  // Remove old handlers if they exist, then register new ones
  ipcMain.removeHandler('git:isRepo')
  ipcMain.handle('git:isRepo', async (_event, dirPath: string) => {
    return gitService.isRepo(dirPath)
  })

  ipcMain.removeHandler('git:init')
  ipcMain.handle('git:init', async (_event, dirPath: string) => {
    try {
      await withWatcherSuppression(() => gitService.init(dirPath))
      return { success: true }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Commit Log ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:log',
    async (_event, repoPath: string, opts?: { maxCount?: number; skip?: number; all?: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string; includeHashes?: string[] }) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)

      try {
        const commits = await gitService.log(repoPath, {
          maxCount: opts?.maxCount,
          skip: opts?.skip,
          all: opts?.all,
          author: opts?.author,
          since: opts?.since,
          until: opts?.until,
          grep: opts?.grep,
          path: opts?.path,
          includeHashes: opts?.includeHashes,
          signal: controller.signal
        })
        return { success: true, data: commits, operationId: opId }
      } catch (err) {
        return { success: false, ...formatError(err), operationId: opId }
      } finally {
        activeControllers.delete(opId)
      }
    }
  )

  // ─── Commit Count ────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:commitCount',
    async (_event, repoPath: string, opts?: { all?: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string }) => {
      try {
        const count = await gitService.commitCount(repoPath, {
          all: opts?.all,
          author: opts?.author,
          since: opts?.since,
          until: opts?.until,
          grep: opts?.grep,
          path: opts?.path
        })
        return { success: true, data: count }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Branches ────────────────────────────────────────────────────────────

  ipcMain.handle('git:getBranches', async (_event, repoPath: string) => {
    try {
      const branches = await gitService.getBranches(repoPath)
      return { success: true, data: branches }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Remotes ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:getRemotes', async (_event, repoPath: string) => {
    try {
      const remotes = await gitService.getRemotes(repoPath)
      return { success: true, data: remotes }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Branches Containing ──────────────────────────────────────────────────

  ipcMain.handle(
    'git:getBranchesContaining',
    async (_event, repoPath: string, hash: string) => {
      try {
        const data = await gitService.getBranchesContaining(repoPath, hash)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Tags ────────────────────────────────────────────────────────────────

  ipcMain.handle('git:getTags', async (_event, repoPath: string) => {
    try {
      const tags = await gitService.getTags(repoPath)
      return { success: true, data: tags }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Create Tag ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:createTag',
    async (
      _event,
      repoPath: string,
      name: string,
      target?: string,
      opts?: { message?: string }
    ) => {
      try {
        await withWatcherSuppression(() => gitService.createTag(repoPath, name, target, { message: opts?.message }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Delete Tag ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:deleteTag',
    async (_event, repoPath: string, name: string) => {
      try {
        await withWatcherSuppression(() => gitService.deleteTag(repoPath, name))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Push Tag ────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:pushTag',
    async (_event, repoPath: string, tagName: string, remoteName?: string) => {
      const credEnv = await getCredentialEnv(repoPath)
      try {
        await withWatcherSuppression(() => gitService.pushTag(repoPath, tagName, remoteName, { env: credEnv }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stashes ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:getStashes', async (_event, repoPath: string) => {
    try {
      const stashes = await gitService.getStashes(repoPath)
      return { success: true, data: stashes }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Stash Save ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stashSave',
    async (
      _event,
      repoPath: string,
      opts?: { message?: string; includeUntracked?: boolean }
    ) => {
      try {
        await withWatcherSuppression(() => gitService.stashSave(repoPath, {
          message: opts?.message,
          includeUntracked: opts?.includeUntracked
        }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stash Apply ────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stashApply',
    async (_event, repoPath: string, index: number) => {
      try {
        await withWatcherSuppression(() => gitService.stashApply(repoPath, index))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stash Pop ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stashPop',
    async (_event, repoPath: string, index: number) => {
      try {
        await withWatcherSuppression(() => gitService.stashPop(repoPath, index))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stash Drop ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stashDrop',
    async (_event, repoPath: string, index: number) => {
      try {
        await withWatcherSuppression(() => gitService.stashDrop(repoPath, index))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stash Show ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stashShow',
    async (_event, repoPath: string, index: number) => {
      try {
        const diff = await gitService.stashShow(repoPath, index)
        return { success: true, data: diff }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Status ──────────────────────────────────────────────────────────────

  ipcMain.handle('git:getStatus', async (_event, repoPath: string) => {
    try {
      const status = await gitService.getStatus(repoPath)
      return { success: true, data: status }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Diff ────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:diff',
    async (_event, repoPath: string, filePath?: string, opts?: { staged?: boolean }) => {
      try {
        const diff = await gitService.diff(repoPath, filePath, { staged: opts?.staged })
        return { success: true, data: diff }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:diffNumstat',
    async (_event, repoPath: string, opts?: { staged?: boolean }) => {
      try {
        const stats = await gitService.diffNumstat(repoPath, { staged: opts?.staged })
        return { success: true, data: stats }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Show Commit ─────────────────────────────────────────────────────────

  ipcMain.handle('git:showCommit', async (_event, repoPath: string, hash: string) => {
    try {
      const data = await gitService.showCommit(repoPath, hash)
      return { success: true, data }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Show Commit File Diff ──────────────────────────────────────────────

  ipcMain.handle(
    'git:showCommitFileDiff',
    async (_event, repoPath: string, hash: string, filePath: string, opts?: { isMerge?: boolean }) => {
      try {
        const data = await gitService.showCommitFileDiff(repoPath, hash, filePath, { isMerge: opts?.isMerge })
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Show File At Commit ────────────────────────────────────────────────

  ipcMain.handle(
    'git:showFileAtCommit',
    async (_event, repoPath: string, hash: string, filePath: string) => {
      try {
        const data = await gitService.showFileAtCommit(repoPath, hash, filePath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Show File At Parent Commit ────────────────────────────────────────

  ipcMain.handle(
    'git:showFileAtParent',
    async (_event, repoPath: string, hash: string, filePath: string) => {
      try {
        const data = await gitService.showFileAtParent(repoPath, hash, filePath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Diff Two Commits ──────────────────────────────────────────────────

  ipcMain.handle(
    'git:diffTwoCommits',
    async (_event, repoPath: string, hashFrom: string, hashTo: string) => {
      try {
        const data = await gitService.diffTwoCommits(repoPath, hashFrom, hashTo)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Diff Two Commits File ────────────────────────────────────────────

  ipcMain.handle(
    'git:diffTwoCommitsFile',
    async (_event, repoPath: string, hashFrom: string, hashTo: string, filePath: string) => {
      try {
        const data = await gitService.diffTwoCommitsFile(repoPath, hashFrom, hashTo, filePath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── List All Files At Commit ──────────────────────────────────────────

  ipcMain.handle(
    'git:listFilesAtCommit',
    async (_event, repoPath: string, hash: string) => {
      try {
        const data = await gitService.listFilesAtCommit(repoPath, hash)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Clone ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:clone',
    async (_event, url: string, destPath: string) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)
      const credEnv = getCredentialEnvForUrl(url)

      try {
        await withWatcherSuppression(() => gitService.clone(url, destPath, {
          signal: controller.signal,
          env: credEnv,
          onProgress: (progress) => {
            // Send progress to renderer via the window that initiated the clone
            const win = BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('git:clone-progress', { operationId: opId, ...progress })
            }
          }
        }))
        return { success: true, operationId: opId }
      } catch (err) {
        return { success: false, ...formatError(err), operationId: opId }
      } finally {
        activeControllers.delete(opId)
      }
    }
  )

  // ─── Checkout ──────────────────────────────────────────────────────────

  ipcMain.handle('git:checkout', async (_event, repoPath: string, branchName: string) => {
    try {
      await withWatcherSuppression(() => gitService.checkout(repoPath, branchName))
      return { success: true }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Create Branch ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:createBranch',
    async (
      _event,
      repoPath: string,
      branchName: string,
      baseBranch?: string,
      opts?: { checkout?: boolean }
    ) => {
      try {
        await withWatcherSuppression(() => gitService.createBranch(repoPath, branchName, baseBranch, {
          checkout: opts?.checkout
        }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Delete Branch ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:deleteBranch',
    async (_event, repoPath: string, branchName: string, opts?: { force?: boolean }) => {
      try {
        await withWatcherSuppression(() => gitService.deleteBranch(repoPath, branchName, { force: opts?.force }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rename Branch ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:renameBranch',
    async (_event, repoPath: string, oldName: string, newName: string) => {
      try {
        await withWatcherSuppression(() => gitService.renameBranch(repoPath, oldName, newName))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Remote Branches ─────────────────────────────────────────────────────

  ipcMain.handle('git:getRemoteBranches', async (_event, repoPath: string) => {
    try {
      const branches = await gitService.getRemoteBranches(repoPath)
      return { success: true, data: branches }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Add Remote ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:addRemote',
    async (_event, repoPath: string, name: string, url: string) => {
      try {
        await withWatcherSuppression(() => gitService.addRemote(repoPath, name, url))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Edit Remote URL ───────────────────────────────────────────────────

  ipcMain.handle(
    'git:editRemoteUrl',
    async (_event, repoPath: string, name: string, newUrl: string) => {
      try {
        await withWatcherSuppression(() => gitService.editRemoteUrl(repoPath, name, newUrl))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Remove Remote ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:removeRemote',
    async (_event, repoPath: string, name: string) => {
      try {
        await withWatcherSuppression(() => gitService.removeRemote(repoPath, name))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Fetch ────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:fetch',
    async (_event, repoPath: string, remoteName?: string) => {
      const credEnv = await getCredentialEnv(repoPath)
      try {
        await withWatcherSuppression(() => gitService.fetch(repoPath, remoteName, { env: credEnv }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Delete Remote Branch ─────────────────────────────────────────────

  ipcMain.handle(
    'git:deleteRemoteBranch',
    async (_event, repoPath: string, remoteName: string, branchName: string) => {
      const credEnv = await getCredentialEnv(repoPath)
      try {
        await withWatcherSuppression(() => gitService.deleteRemoteBranch(repoPath, remoteName, branchName, { env: credEnv }))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Checkout Remote Branch ───────────────────────────────────────────

  ipcMain.handle(
    'git:checkoutRemoteBranch',
    async (_event, repoPath: string, remoteName: string, branchName: string) => {
      try {
        await withWatcherSuppression(() => gitService.checkoutRemoteBranch(repoPath, remoteName, branchName))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stage Files ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:stageFiles',
    async (_event, repoPath: string, filePaths: string[]) => {
      try {
        await withWatcherSuppression(() => gitService.stageFiles(repoPath, filePaths))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Unstage Files ────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:unstageFiles',
    async (_event, repoPath: string, filePaths: string[]) => {
      try {
        await withWatcherSuppression(() => gitService.unstageFiles(repoPath, filePaths))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Stage All ────────────────────────────────────────────────────────────

  ipcMain.handle('git:stageAll', async (_event, repoPath: string) => {
    try {
      await withWatcherSuppression(() => gitService.stageAll(repoPath))
      return { success: true }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Unstage All ──────────────────────────────────────────────────────────

  ipcMain.handle('git:unstageAll', async (_event, repoPath: string) => {
    try {
      await withWatcherSuppression(() => gitService.unstageAll(repoPath))
      return { success: true }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Stage Hunk (partial staging) ──────────────────────────────────────────

  ipcMain.handle(
    'git:stageHunk',
    async (_event, repoPath: string, patch: string) => {
      try {
        await withWatcherSuppression(() => gitService.stageHunk(repoPath, patch))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Unstage Hunk (partial unstaging) ────────────────────────────────────

  ipcMain.handle(
    'git:unstageHunk',
    async (_event, repoPath: string, patch: string) => {
      try {
        await withWatcherSuppression(() => gitService.unstageHunk(repoPath, patch))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Commit ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:commit',
    async (
      _event,
      repoPath: string,
      message: string,
      opts?: { amend?: boolean; signoff?: boolean; gpgSign?: boolean; gpgKeyId?: string }
    ) => {
      try {
        const result = await withWatcherSuppression(() => gitService.commit(repoPath, message, {
          amend: opts?.amend,
          signoff: opts?.signoff,
          gpgSign: opts?.gpgSign,
          gpgKeyId: opts?.gpgKeyId
        }))
        return { success: true, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Get Last Commit Message ──────────────────────────────────────────────

  ipcMain.handle(
    'git:getLastCommitMessage',
    async (_event, repoPath: string) => {
      try {
        const message = await gitService.getLastCommitMessage(repoPath)
        return { success: true, data: message }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Push ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:push',
    async (
      _event,
      repoPath: string,
      opts?: { force?: boolean; setUpstream?: { remote: string; branch: string } }
    ) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)
      const credEnv = await getCredentialEnv(repoPath)

      try {
        await withWatcherSuppression(() => gitService.push(repoPath, {
          signal: controller.signal,
          force: opts?.force,
          setUpstream: opts?.setUpstream,
          env: credEnv,
          onProgress: (progress) => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('git:operation-progress', { operationId: opId, operation: 'push', ...progress })
            }
          }
        }))
        return { success: true, operationId: opId }
      } catch (err) {
        return { success: false, ...formatError(err), operationId: opId }
      } finally {
        activeControllers.delete(opId)
      }
    }
  )

  // ─── Pull ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:pull',
    async (_event, repoPath: string, opts?: { rebase?: boolean; autoStash?: boolean }) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)
      const credEnv = await getCredentialEnv(repoPath)

      try {
        const result = await withWatcherSuppression(() => gitService.pull(repoPath, {
          signal: controller.signal,
          rebase: opts?.rebase,
          env: credEnv,
          autoStash: opts?.autoStash,
          onProgress: (progress) => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('git:operation-progress', { operationId: opId, operation: 'pull', ...progress })
            }
          }
        }))
        return { success: true, operationId: opId, data: result }
      } catch (err) {
        return { success: false, ...formatError(err), operationId: opId }
      } finally {
        activeControllers.delete(opId)
      }
    }
  )

  // ─── Fetch with Progress ──────────────────────────────────────────────────

  ipcMain.handle(
    'git:fetchWithProgress',
    async (_event, repoPath: string, remoteName?: string) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)
      const credEnv = await getCredentialEnv(repoPath)

      try {
        await withWatcherSuppression(() => gitService.fetchWithProgress(repoPath, remoteName, {
          signal: controller.signal,
          env: credEnv,
          onProgress: (progress) => {
            const win = BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('git:operation-progress', { operationId: opId, operation: 'fetch', ...progress })
            }
          }
        }))
        return { success: true, operationId: opId }
      } catch (err) {
        return { success: false, ...formatError(err), operationId: opId }
      } finally {
        activeControllers.delete(opId)
      }
    }
  )

  // ─── Has Upstream ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:hasUpstream',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.hasUpstream(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Get Current Branch ──────────────────────────────────────────────────

  ipcMain.handle(
    'git:getCurrentBranch',
    async (_event, repoPath: string) => {
      try {
        const branch = await gitService.getCurrentBranch(repoPath)
        return { success: true, data: branch }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Merge Preview ───────────────────────────────────────────────────────

  ipcMain.handle(
    'git:mergePreview',
    async (_event, repoPath: string, branchName: string) => {
      try {
        const data = await gitService.getMergePreview(repoPath, branchName)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Merge ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:merge',
    async (
      _event,
      repoPath: string,
      branchName: string,
      opts?: { noFastForward?: boolean; fastForwardOnly?: boolean; squash?: boolean }
    ) => {
      try {
        const result = await withWatcherSuppression(() => gitService.merge(repoPath, branchName, {
          noFastForward: opts?.noFastForward,
          fastForwardOnly: opts?.fastForwardOnly,
          squash: opts?.squash
        }))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Merge Abort ────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:mergeAbort',
    async (_event, repoPath: string) => {
      try {
        await withWatcherSuppression(() => gitService.mergeAbort(repoPath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Is Merging ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:isMerging',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.isMerging(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Get Conflicted Files ──────────────────────────────────────────────────

  ipcMain.handle(
    'git:getConflictedFiles',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.getConflictedFiles(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Cherry-Pick ─────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:cherryPick',
    async (_event, repoPath: string, hashes: string[]) => {
      try {
        const result = await withWatcherSuppression(() => gitService.cherryPick(repoPath, hashes))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:cherryPickAbort',
    async (_event, repoPath: string) => {
      try {
        await withWatcherSuppression(() => gitService.cherryPickAbort(repoPath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:cherryPickContinue',
    async (_event, repoPath: string) => {
      try {
        const result = await withWatcherSuppression(() => gitService.cherryPickContinue(repoPath))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:isCherryPicking',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.isCherryPicking(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Preview ────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebasePreview',
    async (_event, repoPath: string, ontoBranch: string) => {
      try {
        const data = await gitService.getRebasePreview(repoPath, ontoBranch)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase ─────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebase',
    async (_event, repoPath: string, ontoBranch: string) => {
      try {
        const result = await withWatcherSuppression(() => gitService.rebase(repoPath, ontoBranch))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Interactive ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebaseInteractive',
    async (
      _event,
      repoPath: string,
      ontoBranch: string,
      actions: { hash: string; action: 'pick' | 'squash' | 'edit' | 'drop' | 'reword' | 'fixup' }[]
    ) => {
      try {
        const result = await withWatcherSuppression(() => gitService.rebaseInteractive(repoPath, ontoBranch, actions))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Continue ───────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebaseContinue',
    async (_event, repoPath: string) => {
      try {
        const result = await withWatcherSuppression(() => gitService.rebaseContinue(repoPath))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Abort ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebaseAbort',
    async (_event, repoPath: string) => {
      try {
        await withWatcherSuppression(() => gitService.rebaseAbort(repoPath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Skip ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebaseSkip',
    async (_event, repoPath: string) => {
      try {
        const result = await withWatcherSuppression(() => gitService.rebaseSkip(repoPath))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Is Rebasing ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:isRebasing',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.isRebasing(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Rebase Progress ──────────────────────────────────────────────────────

  ipcMain.handle(
    'git:rebaseProgress',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.getRebaseProgress(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Reset ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:reset',
    async (
      _event,
      repoPath: string,
      targetHash: string,
      mode: 'soft' | 'mixed' | 'hard'
    ) => {
      try {
        const result = await withWatcherSuppression(() => gitService.reset(repoPath, targetHash, mode))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Revert ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:revert',
    async (
      _event,
      repoPath: string,
      hash: string,
      opts?: { parentNumber?: number }
    ) => {
      try {
        const result = await withWatcherSuppression(() => gitService.revert(repoPath, hash, {
          parentNumber: opts?.parentNumber
        }))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:revertAbort',
    async (_event, repoPath: string) => {
      try {
        await withWatcherSuppression(() => gitService.revertAbort(repoPath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:revertContinue',
    async (_event, repoPath: string) => {
      try {
        const result = await withWatcherSuppression(() => gitService.revertContinue(repoPath))
        return { success: result.success, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:isReverting',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.isReverting(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Conflict Resolution ────────────────────────────────────────────────────

  ipcMain.handle(
    'git:getConflictContent',
    async (_event, repoPath: string, filePath: string) => {
      try {
        const data = await gitService.getConflictContent(repoPath, filePath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:resolveConflictFile',
    async (_event, repoPath: string, filePath: string, content: string) => {
      try {
        await withWatcherSuppression(() => gitService.resolveConflictFile(repoPath, filePath, content))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:resolveConflictFileWith',
    async (_event, repoPath: string, filePath: string, choice: 'ours' | 'theirs') => {
      try {
        await withWatcherSuppression(() => gitService.resolveConflictFileWith(repoPath, filePath, choice))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:getActiveOperation',
    async (_event, repoPath: string) => {
      try {
        const data = await gitService.getActiveOperation(repoPath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Blame ──────────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:blame',
    async (_event, repoPath: string, filePath: string) => {
      try {
        const data = await gitService.blame(repoPath, filePath)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Cancel Operation ────────────────────────────────────────────────────

  ipcMain.handle('git:cancelOperation', async (_event, operationId: string) => {
    const controller = activeControllers.get(operationId)
    if (controller) {
      controller.abort()
      activeControllers.delete(operationId)
      return { success: true }
    }
    return { success: false, error: 'Operation not found' }
  })

  // ─── Discard Files ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:discardFiles',
    async (
      _event,
      repoPath: string,
      filePaths: string[],
      opts?: { untracked?: boolean }
    ) => {
      try {
        await withWatcherSuppression(() => gitService.discardFiles(repoPath, filePaths, opts))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Discard Hunk ─────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:discardHunk',
    async (_event, repoPath: string, patch: string) => {
      try {
        await withWatcherSuppression(() => gitService.discardHunk(repoPath, patch))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── File Log ──────────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:fileLog',
    async (_event, repoPath: string, filePath: string, maxCount?: number) => {
      try {
        const data = await gitService.fileLog(repoPath, filePath, maxCount)
        return { success: true, data }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Submodules ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:getSubmodules', async (_event, repoPath: string) => {
    try {
      const data = await gitService.getSubmodules(repoPath)
      return { success: true, data }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  ipcMain.handle(
    'git:submoduleInit',
    async (_event, repoPath: string, submodulePath: string) => {
      try {
        await withWatcherSuppression(() => gitService.submoduleInit(repoPath, submodulePath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  ipcMain.handle(
    'git:submoduleUpdate',
    async (_event, repoPath: string, submodulePath: string) => {
      try {
        await withWatcherSuppression(() => gitService.submoduleUpdate(repoPath, submodulePath))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── GPG Keys ──────────────────────────────────────────────────────────────

  ipcMain.handle('git:getAvailableGpgKeys', async () => {
    try {
      const data = await gitService.getAvailableGpgKeys()
      return { success: true, data }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  ipcMain.handle('git:getGitSigningKey', async (_event, repoPath: string) => {
    try {
      const data = await gitService.getGitSigningKey(repoPath)
      return { success: true, data }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  ipcMain.handle(
    'git:setGitSigningKey',
    async (_event, repoPath: string, keyId: string) => {
      try {
        await withWatcherSuppression(() => gitService.setGitSigningKey(repoPath, keyId))
        return { success: true }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )

  // ─── Generic exec (for operations not yet wrapped) ───────────────────────

  ipcMain.handle(
    'git:exec',
    async (_event, args: string[], repoPath: string) => {
      try {
        const result = await gitService.exec(args, repoPath)
        return { success: true, data: result }
      } catch (err) {
        return { success: false, ...formatError(err) }
      }
    }
  )
}
