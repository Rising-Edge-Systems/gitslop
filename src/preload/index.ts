import { contextBridge, ipcRenderer } from 'electron'

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
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
      ipcRenderer.invoke('git:init', dirPath)
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
