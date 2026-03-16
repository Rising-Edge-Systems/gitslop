/**
 * Git IPC handlers — bridges GitService to the renderer process via ipcMain.
 */

import { ipcMain } from 'electron'
import { gitService, GitErrorCode } from './git-service'
import type { GitError } from './git-service'

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
      await gitService.init(dirPath)
      return { success: true }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Commit Log ──────────────────────────────────────────────────────────

  ipcMain.handle(
    'git:log',
    async (_event, repoPath: string, opts?: { maxCount?: number; all?: boolean }) => {
      const opId = createOperationId()
      const controller = new AbortController()
      activeControllers.set(opId, controller)

      try {
        const commits = await gitService.log(repoPath, {
          maxCount: opts?.maxCount,
          all: opts?.all,
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

  // ─── Tags ────────────────────────────────────────────────────────────────

  ipcMain.handle('git:getTags', async (_event, repoPath: string) => {
    try {
      const tags = await gitService.getTags(repoPath)
      return { success: true, data: tags }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

  // ─── Stashes ─────────────────────────────────────────────────────────────

  ipcMain.handle('git:getStashes', async (_event, repoPath: string) => {
    try {
      const stashes = await gitService.getStashes(repoPath)
      return { success: true, data: stashes }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

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

  // ─── Show Commit ─────────────────────────────────────────────────────────

  ipcMain.handle('git:showCommit', async (_event, repoPath: string, hash: string) => {
    try {
      const data = await gitService.showCommit(repoPath, hash)
      return { success: true, data }
    } catch (err) {
      return { success: false, ...formatError(err) }
    }
  })

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
