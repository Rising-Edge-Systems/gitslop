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
