import { contextBridge, ipcRenderer } from 'electron'

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface GitServiceResult {
  success: boolean
  data?: any
  error?: string
  code?: string
  operationId?: string
}

const electronAPI = {
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    maximize: (): Promise<void> => ipcRenderer.invoke('window:maximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
    onMaximizeChange: (callback: (isMaximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, value: boolean): void => {
        callback(value)
      }
      ipcRenderer.on('window:maximized-changed', handler)
      return () => {
        ipcRenderer.removeListener('window:maximized-changed', handler)
      }
    }
  },
  dialog: {
    openDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory')
  },
  git: {
    isRepo: (dirPath: string): Promise<boolean> => ipcRenderer.invoke('git:isRepo', dirPath),
    init: (dirPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:init', dirPath),
    getVersion: (): Promise<GitServiceResult> => ipcRenderer.invoke('git:getVersion'),
    log: (
      repoPath: string,
      opts?: { maxCount?: number; all?: boolean }
    ): Promise<GitServiceResult> => ipcRenderer.invoke('git:log', repoPath, opts),
    getBranches: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getBranches', repoPath),
    getRemotes: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getRemotes', repoPath),
    getTags: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getTags', repoPath),
    createTag: (
      repoPath: string,
      name: string,
      target?: string,
      opts?: { message?: string }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:createTag', repoPath, name, target, opts),
    deleteTag: (repoPath: string, name: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:deleteTag', repoPath, name),
    pushTag: (repoPath: string, tagName: string, remoteName?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:pushTag', repoPath, tagName, remoteName),
    getStashes: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getStashes', repoPath),
    stashSave: (
      repoPath: string,
      opts?: { message?: string; includeUntracked?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stashSave', repoPath, opts),
    stashApply: (repoPath: string, index: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stashApply', repoPath, index),
    stashPop: (repoPath: string, index: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stashPop', repoPath, index),
    stashDrop: (repoPath: string, index: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stashDrop', repoPath, index),
    stashShow: (repoPath: string, index: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stashShow', repoPath, index),
    getStatus: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getStatus', repoPath),
    diff: (
      repoPath: string,
      filePath?: string,
      opts?: { staged?: boolean }
    ): Promise<GitServiceResult> => ipcRenderer.invoke('git:diff', repoPath, filePath, opts),
    showCommit: (repoPath: string, hash: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showCommit', repoPath, hash),
    showCommitFileDiff: (
      repoPath: string,
      hash: string,
      filePath: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showCommitFileDiff', repoPath, hash, filePath),
    cancelOperation: (operationId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('git:cancelOperation', operationId),
    exec: (args: string[], repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:exec', args, repoPath),
    checkout: (repoPath: string, branchName: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:checkout', repoPath, branchName),
    createBranch: (
      repoPath: string,
      branchName: string,
      baseBranch?: string,
      opts?: { checkout?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:createBranch', repoPath, branchName, baseBranch, opts),
    deleteBranch: (
      repoPath: string,
      branchName: string,
      opts?: { force?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:deleteBranch', repoPath, branchName, opts),
    renameBranch: (
      repoPath: string,
      oldName: string,
      newName: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:renameBranch', repoPath, oldName, newName),
    getRemoteBranches: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getRemoteBranches', repoPath),
    addRemote: (repoPath: string, name: string, url: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:addRemote', repoPath, name, url),
    editRemoteUrl: (repoPath: string, name: string, newUrl: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:editRemoteUrl', repoPath, name, newUrl),
    removeRemote: (repoPath: string, name: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:removeRemote', repoPath, name),
    fetch: (repoPath: string, remoteName?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:fetch', repoPath, remoteName),
    deleteRemoteBranch: (repoPath: string, remoteName: string, branchName: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:deleteRemoteBranch', repoPath, remoteName, branchName),
    checkoutRemoteBranch: (repoPath: string, remoteName: string, branchName: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:checkoutRemoteBranch', repoPath, remoteName, branchName),
    stageFiles: (repoPath: string, filePaths: string[]): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stageFiles', repoPath, filePaths),
    unstageFiles: (repoPath: string, filePaths: string[]): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:unstageFiles', repoPath, filePaths),
    stageAll: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stageAll', repoPath),
    unstageAll: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:unstageAll', repoPath),
    stageHunk: (repoPath: string, patch: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:stageHunk', repoPath, patch),
    unstageHunk: (repoPath: string, patch: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:unstageHunk', repoPath, patch),
    commit: (
      repoPath: string,
      message: string,
      opts?: { amend?: boolean; signoff?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:commit', repoPath, message, opts),
    getLastCommitMessage: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getLastCommitMessage', repoPath),
    push: (
      repoPath: string,
      opts?: { force?: boolean; setUpstream?: { remote: string; branch: string } }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:push', repoPath, opts),
    pull: (repoPath: string, opts?: { rebase?: boolean }): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:pull', repoPath, opts),
    fetchWithProgress: (repoPath: string, remoteName?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:fetchWithProgress', repoPath, remoteName),
    hasUpstream: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:hasUpstream', repoPath),
    getCurrentBranch: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getCurrentBranch', repoPath),
    onOperationProgress: (
      callback: (progress: { operationId: string; operation: string; phase: string; percent: number | null; current: number | null; total: number | null }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { operationId: string; operation: string; phase: string; percent: number | null; current: number | null; total: number | null }
      ): void => {
        callback(progress)
      }
      ipcRenderer.on('git:operation-progress', handler)
      return () => {
        ipcRenderer.removeListener('git:operation-progress', handler)
      }
    },
    mergePreview: (repoPath: string, branchName: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:mergePreview', repoPath, branchName),
    merge: (
      repoPath: string,
      branchName: string,
      opts?: { noFastForward?: boolean; fastForwardOnly?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:merge', repoPath, branchName, opts),
    mergeAbort: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:mergeAbort', repoPath),
    isMerging: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:isMerging', repoPath),
    getConflictedFiles: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getConflictedFiles', repoPath),
    cherryPick: (repoPath: string, hashes: string[]): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:cherryPick', repoPath, hashes),
    cherryPickAbort: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:cherryPickAbort', repoPath),
    cherryPickContinue: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:cherryPickContinue', repoPath),
    isCherryPicking: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:isCherryPicking', repoPath),
    rebasePreview: (repoPath: string, ontoBranch: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebasePreview', repoPath, ontoBranch),
    rebase: (repoPath: string, ontoBranch: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebase', repoPath, ontoBranch),
    rebaseInteractive: (
      repoPath: string,
      ontoBranch: string,
      actions: { hash: string; action: 'pick' | 'squash' | 'edit' | 'drop' | 'reword' | 'fixup' }[]
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebaseInteractive', repoPath, ontoBranch, actions),
    rebaseContinue: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebaseContinue', repoPath),
    rebaseAbort: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebaseAbort', repoPath),
    rebaseSkip: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebaseSkip', repoPath),
    isRebasing: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:isRebasing', repoPath),
    rebaseProgress: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:rebaseProgress', repoPath),
    reset: (
      repoPath: string,
      targetHash: string,
      mode: 'soft' | 'mixed' | 'hard'
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:reset', repoPath, targetHash, mode),
    revert: (
      repoPath: string,
      hash: string,
      opts?: { parentNumber?: number }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:revert', repoPath, hash, opts),
    revertAbort: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:revertAbort', repoPath),
    revertContinue: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:revertContinue', repoPath),
    isReverting: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:isReverting', repoPath),
    getConflictContent: (repoPath: string, filePath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getConflictContent', repoPath, filePath),
    resolveConflictFile: (repoPath: string, filePath: string, content: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:resolveConflictFile', repoPath, filePath, content),
    resolveConflictFileWith: (repoPath: string, filePath: string, choice: 'ours' | 'theirs'): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:resolveConflictFileWith', repoPath, filePath, choice),
    getActiveOperation: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getActiveOperation', repoPath),
    clone: (url: string, destPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:clone', url, destPath),
    onCloneProgress: (
      callback: (progress: { operationId: string; phase: string; percent: number | null; current: number | null; total: number | null }) => void
    ): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        progress: { operationId: string; phase: string; percent: number | null; current: number | null; total: number | null }
      ): void => {
        callback(progress)
      }
      ipcRenderer.on('git:clone-progress', handler)
      return () => {
        ipcRenderer.removeListener('git:clone-progress', handler)
      }
    }
  },
  watcher: {
    start: (repoPath: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('watcher:start', repoPath),
    stop: (): Promise<{ success: boolean }> => ipcRenderer.invoke('watcher:stop')
  },
  onRepoChanged: (callback: () => void): (() => void) => {
    const handler = (): void => {
      callback()
    }
    ipcRenderer.on('repo:changed', handler)
    return () => {
      ipcRenderer.removeListener('repo:changed', handler)
    }
  },
  repos: {
    getRecent: (): Promise<RecentRepo[]> => ipcRenderer.invoke('repos:getRecent'),
    addRecent: (repoPath: string, repoName: string): Promise<RecentRepo[]> =>
      ipcRenderer.invoke('repos:addRecent', repoPath, repoName),
    removeRecent: (repoPath: string): Promise<RecentRepo[]> =>
      ipcRenderer.invoke('repos:removeRecent', repoPath)
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
