import { contextBridge, ipcRenderer } from 'electron'

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
  }
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)

export type ElectronAPI = typeof electronAPI
