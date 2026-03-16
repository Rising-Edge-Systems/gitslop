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
    getStashes: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getStashes', repoPath),
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
      ipcRenderer.invoke('git:exec', args, repoPath)
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
