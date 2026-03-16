import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import Store from 'electron-store'

const execFileAsync = promisify(execFile)
const isDev = !app.isPackaged

interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

interface StoreSchema {
  recentRepos: RecentRepo[]
}

const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: []
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false,
    backgroundColor: '#1e1e2e'
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Window control IPC handlers
ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})

ipcMain.handle('window:isMaximized', () => {
  return mainWindow?.isMaximized() ?? false
})

// Dialog IPC handlers
ipcMain.handle('dialog:openDirectory', async () => {
  if (!mainWindow) return null
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// Git IPC handlers
ipcMain.handle('git:isRepo', async (_event, dirPath: string) => {
  try {
    await execFileAsync('git', ['rev-parse', '--git-dir'], { cwd: dirPath })
    return true
  } catch {
    return false
  }
})

ipcMain.handle('git:init', async (_event, dirPath: string) => {
  try {
    await execFileAsync('git', ['init'], { cwd: dirPath })
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to initialize repository'
    return { success: false, error: message }
  }
})

// Recent repos IPC handlers
ipcMain.handle('repos:getRecent', () => {
  return store.get('recentRepos', [])
})

ipcMain.handle('repos:addRecent', (_event, repoPath: string, repoName: string) => {
  const recentRepos = store.get('recentRepos', [])
  // Remove existing entry with same path
  const filtered = recentRepos.filter((r: RecentRepo) => r.path !== repoPath)
  // Add to front
  filtered.unshift({
    path: repoPath,
    name: repoName,
    lastOpened: new Date().toISOString()
  })
  // Keep max 20 entries
  const trimmed = filtered.slice(0, 20)
  store.set('recentRepos', trimmed)
  return trimmed
})

ipcMain.handle('repos:removeRecent', (_event, repoPath: string) => {
  const recentRepos = store.get('recentRepos', [])
  const filtered = recentRepos.filter((r: RecentRepo) => r.path !== repoPath)
  store.set('recentRepos', filtered)
  return filtered
})

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
