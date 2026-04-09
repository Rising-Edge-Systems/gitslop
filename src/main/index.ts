import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell } from 'electron'
import { join } from 'path'
import { readFile, writeFile, readdir, stat } from 'fs'
import * as https from 'https'
import { exec } from 'child_process'
import { promisify } from 'util'
import { homedir } from 'os'
import { watch as chokidarWatch, type FSWatcher } from 'chokidar'
import Store from 'electron-store'
import { autoUpdater } from 'electron-updater'
import { registerGitIpcHandlers } from './git-ipc'
import { gitService } from './git-service'
import { registerTerminalIpcHandlers, killAllTerminals } from './terminal-manager'
import {
  createWatcherState,
  suppressWatcher as _suppressWatcher,
  gitOperationStarted as _gitOperationStarted,
  gitOperationFinished as _gitOperationFinished,
  isWatcherSuppressed as _isWatcherSuppressed,
  shouldIgnorePath
} from './watcher-utils'

const isDev = !app.isPackaged

interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

export interface Profile {
  id: string
  name: string
  authorName: string
  authorEmail: string
  isDefault: boolean
  signingMethod: 'none' | 'gpg' | 'ssh'
  gpgKeyId?: string
  sshKeyPath?: string
}

interface StoreSchema {
  recentRepos: RecentRepo[]
  profiles: Profile[]
  activeProfileId: string
  githubToken: string  // encrypted via safeStorage
  gitlabToken: string  // encrypted via safeStorage
  gitlabInstanceUrl: string
}

const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    profiles: [],
    activeProfileId: '',
    githubToken: '',
    gitlabToken: '',
    gitlabInstanceUrl: 'https://gitlab.com'
  }
})

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
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

ipcMain.handle('menu:about', async () => {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  if (win && !win.isDestroyed()) {
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'About GitSlop',
      message: 'GitSlop',
      detail: `A powerful, open-source Git client.\n\nVersion: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode.js: ${process.versions.node}\nPlatform: ${process.platform} ${process.arch}`,
      buttons: ['OK']
    })
  }
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

// Git IPC handlers are registered via git-ipc module (see app.whenReady)

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

// Profile IPC handlers
ipcMain.handle('profiles:list', () => {
  return store.get('profiles', [])
})

ipcMain.handle('profiles:getActive', () => {
  return store.get('activeProfileId', '')
})

ipcMain.handle('profiles:create', (_event, profile: Omit<Profile, 'id'>) => {
  const profiles = store.get('profiles', [])
  const newProfile: Profile = {
    ...profile,
    id: `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }
  // If this is the first profile or marked as default, clear other defaults
  if (newProfile.isDefault || profiles.length === 0) {
    newProfile.isDefault = true
    for (const p of profiles) {
      p.isDefault = false
    }
  }
  profiles.push(newProfile)
  store.set('profiles', profiles)
  // If this is default and no active profile, set as active
  if (newProfile.isDefault && !store.get('activeProfileId', '')) {
    store.set('activeProfileId', newProfile.id)
  }
  return newProfile
})

ipcMain.handle('profiles:update', (_event, id: string, updates: Partial<Omit<Profile, 'id'>>) => {
  const profiles = store.get('profiles', [])
  const index = profiles.findIndex((p: Profile) => p.id === id)
  if (index === -1) return { success: false, error: 'Profile not found' }

  // If setting as default, clear other defaults
  if (updates.isDefault) {
    for (const p of profiles) {
      p.isDefault = false
    }
  }
  profiles[index] = { ...profiles[index], ...updates, id }
  store.set('profiles', profiles)
  return { success: true, data: profiles[index] }
})

ipcMain.handle('profiles:delete', (_event, id: string) => {
  const profiles = store.get('profiles', [])
  const filtered = profiles.filter((p: Profile) => p.id !== id)
  store.set('profiles', filtered)
  // If deleted profile was active, clear active
  if (store.get('activeProfileId', '') === id) {
    // Set to default profile if one exists, otherwise clear
    const defaultProfile = filtered.find((p: Profile) => p.isDefault)
    store.set('activeProfileId', defaultProfile ? defaultProfile.id : '')
  }
  return filtered
})

ipcMain.handle('profiles:setActive', (_event, id: string) => {
  store.set('activeProfileId', id)
  return { success: true }
})

ipcMain.handle('profiles:apply', async (_event, id: string, repoPath: string) => {
  const profiles = store.get('profiles', [])
  const profile = profiles.find((p: Profile) => p.id === id)
  if (!profile) return { success: false, error: 'Profile not found' }

  try {
    await gitService.exec(['config', 'user.name', profile.authorName], repoPath)
    await gitService.exec(['config', 'user.email', profile.authorEmail], repoPath)

    // Configure commit signing based on profile settings
    const signingMethod = profile.signingMethod || 'none'
    if (signingMethod === 'gpg' && profile.gpgKeyId) {
      await gitService.exec(['config', 'commit.gpgsign', 'true'], repoPath)
      await gitService.exec(['config', 'gpg.format', 'openpgp'], repoPath)
      await gitService.exec(['config', 'user.signingkey', profile.gpgKeyId], repoPath)
    } else if (signingMethod === 'ssh' && profile.sshKeyPath) {
      await gitService.exec(['config', 'commit.gpgsign', 'true'], repoPath)
      await gitService.exec(['config', 'gpg.format', 'ssh'], repoPath)
      await gitService.exec(['config', 'user.signingkey', profile.sshKeyPath], repoPath)
    } else {
      // No signing — disable and unset keys
      await gitService.exec(['config', 'commit.gpgsign', 'false'], repoPath)
      try { await gitService.exec(['config', '--unset', 'gpg.format'], repoPath) } catch { /* may not exist */ }
      try { await gitService.exec(['config', '--unset', 'user.signingkey'], repoPath) } catch { /* may not exist */ }
    }

    store.set('activeProfileId', id)
    return { success: true, data: profile }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to apply profile' }
  }
})

// ─── SSH Key Management IPC handlers ──────────────────────────────────────

const execAsync = promisify(exec)

interface SSHKeyInfo {
  name: string
  path: string
  pubKeyPath: string
  type: string
  fingerprint: string
}

ipcMain.handle('sshkeys:list', async () => {
  const sshDir = join(homedir(), '.ssh')
  try {
    const files = await new Promise<string[]>((resolve, reject) => {
      readdir(sshDir, (err, items) => {
        if (err) reject(err)
        else resolve(items)
      })
    })

    // Find .pub files and their corresponding private keys
    const pubFiles = files.filter((f) => f.endsWith('.pub'))
    const keys: SSHKeyInfo[] = []

    for (const pubFile of pubFiles) {
      const baseName = pubFile.replace(/\.pub$/, '')
      const privKeyPath = join(sshDir, baseName)
      const pubKeyPath = join(sshDir, pubFile)

      // Check if private key exists
      const privExists = await new Promise<boolean>((resolve) => {
        stat(privKeyPath, (err, stats) => {
          resolve(!err && stats.isFile())
        })
      })

      if (!privExists) continue

      // Try to get fingerprint
      let fingerprint = ''
      let keyType = ''
      try {
        const { stdout } = await execAsync(`ssh-keygen -l -f "${pubKeyPath}"`)
        const parts = stdout.trim().split(/\s+/)
        fingerprint = parts[1] || ''
        // Type is typically in parens at end, e.g. "(ED25519)"
        const typeMatch = stdout.match(/\((\w+)\)/)
        keyType = typeMatch ? typeMatch[1] : ''
      } catch {
        // If ssh-keygen fails, still list the key
      }

      keys.push({
        name: baseName,
        path: privKeyPath,
        pubKeyPath,
        type: keyType,
        fingerprint
      })
    }

    return { success: true, data: keys }
  } catch (err) {
    return { success: true, data: [] } // Empty if ~/.ssh doesn't exist
  }
})

ipcMain.handle('sshkeys:readPublicKey', async (_event, pubKeyPath: string) => {
  return new Promise<{ success: boolean; data?: string; error?: string }>((resolve) => {
    readFile(pubKeyPath, 'utf-8', (err, data) => {
      if (err) {
        resolve({ success: false, error: err.message })
      } else {
        resolve({ success: true, data: data.trim() })
      }
    })
  })
})

ipcMain.handle('sshkeys:copyToClipboard', (_event, text: string) => {
  clipboard.writeText(text)
  return { success: true }
})

ipcMain.handle(
  'sshkeys:generate',
  async (
    _event,
    opts: {
      name: string
      type: 'ed25519' | 'rsa'
      passphrase?: string
      comment?: string
    }
  ) => {
    const sshDir = join(homedir(), '.ssh')
    const keyPath = join(sshDir, opts.name)

    // Check if key already exists
    const exists = await new Promise<boolean>((resolve) => {
      stat(keyPath, (err) => resolve(!err))
    })
    if (exists) {
      return { success: false, error: `Key "${opts.name}" already exists` }
    }

    const passphrase = opts.passphrase || ''
    const comment = opts.comment || `${opts.name}@gitslop`
    const typeFlag = opts.type === 'rsa' ? '-t rsa -b 4096' : '-t ed25519'
    const cmd = `ssh-keygen ${typeFlag} -C "${comment}" -f "${keyPath}" -N "${passphrase}"`

    try {
      await execAsync(cmd)
      return { success: true, data: { path: keyPath, pubKeyPath: `${keyPath}.pub` } }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to generate key'
      }
    }
  }
)

ipcMain.handle('sshkeys:testConnection', async (_event, host: string) => {
  try {
    const { stdout, stderr } = await execAsync(`ssh -T -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 ${host} 2>&1`, {
      timeout: 15000
    }).catch((err) => {
      // ssh -T to github returns exit code 1 even on success
      return { stdout: err.stdout || '', stderr: err.stderr || '' }
    })
    const output = (stdout || '') + (stderr || '')
    const isSuccess =
      output.includes('successfully authenticated') ||
      output.includes('You\'ve successfully') ||
      output.includes('Welcome to GitLab')
    return {
      success: true,
      data: {
        authenticated: isSuccess,
        message: output.trim()
      }
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Connection test failed'
    }
  }
})

// ─── GitHub Integration IPC handlers ──────────────────────────────────────

function githubApiRequest(
  method: string,
  path: string,
  token: string,
  body?: string
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'GitSlop',
        'Accept': 'application/vnd.github.v3+json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }))
    })
    req.on('error', (err) => reject(err))
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')) })
    if (body) req.write(body)
    req.end()
  })
}

function encryptToken(token: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(token).toString('base64')
  }
  // Fallback: store as-is (not ideal but functional)
  return `plain:${token}`
}

function decryptToken(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) {
    return stored.slice(6)
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    }
  } catch {
    // If decryption fails, token is invalid
  }
  return ''
}

ipcMain.handle('github:login', async (_event, pat: string) => {
  try {
    // Validate PAT by fetching user info
    const { statusCode, data } = await githubApiRequest('GET', '/user', pat)
    if (statusCode !== 200) {
      const parsed = JSON.parse(data)
      return { success: false, error: parsed.message || 'Authentication failed' }
    }
    const user = JSON.parse(data)
    // Store encrypted token
    const encrypted = encryptToken(pat)
    store.set('githubToken', encrypted)
    return {
      success: true,
      data: {
        login: user.login,
        name: user.name || user.login,
        avatarUrl: user.avatar_url,
        email: user.email
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
  }
})

ipcMain.handle('github:getUser', async () => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  if (!token) return { success: false, error: 'Not logged in' }
  try {
    const { statusCode, data } = await githubApiRequest('GET', '/user', token)
    if (statusCode !== 200) {
      return { success: false, error: 'Token invalid or expired' }
    }
    const user = JSON.parse(data)
    return {
      success: true,
      data: {
        login: user.login,
        name: user.name || user.login,
        avatarUrl: user.avatar_url,
        email: user.email
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to get user' }
  }
})

ipcMain.handle('github:logout', () => {
  store.set('githubToken', '')
  return { success: true }
})

ipcMain.handle('github:isLoggedIn', () => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  return { success: true, data: !!token }
})

// Parse GitHub owner/repo from a remote URL
function parseGitHubRemote(url: string): { owner: string; repo: string } | null {
  // SSH: git@github.com:owner/repo.git
  // HTTPS: https://github.com/owner/repo.git or https://github.com/owner/repo
  const match = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/)
  if (match) return { owner: match[1], repo: match[2] }
  return null
}

ipcMain.handle('github:parseRemote', async (_event, repoPath: string) => {
  try {
    const remotes = await gitService.getRemotes(repoPath)
    const origin = remotes.find((r: { name: string }) => r.name === 'origin') || remotes[0]
    if (!origin) return { success: false, error: 'No remotes found' }
    const parsed = parseGitHubRemote(origin.fetchUrl)
    if (!parsed) return { success: false, error: 'Not a GitHub repository' }
    return { success: true, data: parsed }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to parse remote' }
  }
})

ipcMain.handle('github:listPullRequests', async (_event, owner: string, repo: string, state?: string) => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  if (!token) return { success: false, error: 'Not logged in to GitHub' }
  try {
    const queryState = state || 'open'
    const { statusCode, data } = await githubApiRequest(
      'GET',
      `/repos/${owner}/${repo}/pulls?state=${queryState}&per_page=50&sort=updated&direction=desc`,
      token
    )
    if (statusCode !== 200) {
      const parsed = JSON.parse(data)
      return { success: false, error: parsed.message || 'Failed to fetch pull requests' }
    }
    const prs = JSON.parse(data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = prs.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      author: pr.user?.login || 'unknown',
      authorAvatar: pr.user?.avatar_url || '',
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      headBranch: pr.head?.ref || '',
      baseBranch: pr.base?.ref || '',
      draft: pr.draft || false,
      htmlUrl: pr.html_url,
      body: pr.body || '',
      labels: (pr.labels || []).map((l: { name: string; color: string }) => ({ name: l.name, color: l.color })),
      reviewStatus: pr.requested_reviewers?.length > 0 ? 'review_requested' : 'none',
      mergeable: pr.mergeable,
      additions: pr.additions || 0,
      deletions: pr.deletions || 0,
      changedFiles: pr.changed_files || 0
    }))
    return { success: true, data: mapped }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch pull requests' }
  }
})

ipcMain.handle('github:getPullRequest', async (_event, owner: string, repo: string, prNumber: number) => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  if (!token) return { success: false, error: 'Not logged in to GitHub' }
  try {
    // Fetch PR details, comments, and reviews in parallel
    const [prRes, commentsRes, reviewsRes, filesRes] = await Promise.all([
      githubApiRequest('GET', `/repos/${owner}/${repo}/pulls/${prNumber}`, token),
      githubApiRequest('GET', `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=50`, token),
      githubApiRequest('GET', `/repos/${owner}/${repo}/pulls/${prNumber}/reviews?per_page=50`, token),
      githubApiRequest('GET', `/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, token)
    ])

    if (prRes.statusCode !== 200) {
      const parsed = JSON.parse(prRes.data)
      return { success: false, error: parsed.message || 'Failed to fetch PR' }
    }

    const pr = JSON.parse(prRes.data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comments = commentsRes.statusCode === 200 ? JSON.parse(commentsRes.data).map((c: any) => ({
      id: c.id,
      author: c.user?.login || 'unknown',
      authorAvatar: c.user?.avatar_url || '',
      body: c.body || '',
      createdAt: c.created_at
    })) : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reviews = reviewsRes.statusCode === 200 ? JSON.parse(reviewsRes.data).map((r: any) => ({
      id: r.id,
      author: r.user?.login || 'unknown',
      authorAvatar: r.user?.avatar_url || '',
      state: r.state,
      body: r.body || '',
      submittedAt: r.submitted_at
    })) : []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files = filesRes.statusCode === 200 ? JSON.parse(filesRes.data).map((f: any) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes
    })) : []

    return {
      success: true,
      data: {
        number: pr.number,
        title: pr.title,
        state: pr.state,
        author: pr.user?.login || 'unknown',
        authorAvatar: pr.user?.avatar_url || '',
        createdAt: pr.created_at,
        updatedAt: pr.updated_at,
        headBranch: pr.head?.ref || '',
        baseBranch: pr.base?.ref || '',
        draft: pr.draft || false,
        htmlUrl: pr.html_url,
        body: pr.body || '',
        labels: (pr.labels || []).map((l: { name: string; color: string }) => ({ name: l.name, color: l.color })),
        mergeable: pr.mergeable,
        additions: pr.additions || 0,
        deletions: pr.deletions || 0,
        changedFiles: pr.changed_files || 0,
        comments,
        reviews,
        files
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch PR details' }
  }
})

ipcMain.handle('github:createPullRequest', async (_event, owner: string, repo: string, opts: { title: string; body: string; head: string; base: string; draft?: boolean }) => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  if (!token) return { success: false, error: 'Not logged in to GitHub' }
  try {
    const body = JSON.stringify({
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
      draft: opts.draft || false
    })
    const { statusCode, data } = await githubApiRequest(
      'POST',
      `/repos/${owner}/${repo}/pulls`,
      token,
      body
    )
    if (statusCode !== 201) {
      const parsed = JSON.parse(data)
      return { success: false, error: parsed.message || 'Failed to create pull request' }
    }
    const pr = JSON.parse(data)
    return {
      success: true,
      data: {
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.html_url,
        state: pr.state
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create pull request' }
  }
})

app.whenReady().then(async () => {
  // Register git IPC handlers
  registerGitIpcHandlers()

  // Register terminal IPC handlers
  registerTerminalIpcHandlers()

  // Check git version on startup
  try {
    const version = await gitService.getVersion()
    if (!version.supported) {
      console.warn(
        `Git version ${version.raw} is older than recommended (2.20+). Some features may not work.`
      )
    }
  } catch {
    console.warn('Git is not installed or not found in PATH.')
  }

  createWindow()

  // ─── Application Menu ────────────────────────────────────────────────────
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Window',
          click: (): void => {
            createWindow()
          }
        },
        {
          label: 'Open Repository',
          accelerator: 'CmdOrCtrl+O',
          click: async (): Promise<void> => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (!win || win.isDestroyed()) return
            const result = await dialog.showOpenDialog(win, {
              properties: ['openDirectory']
            })
            if (!result.canceled && result.filePaths.length > 0) {
              win.webContents.send('menu:open-repository', result.filePaths[0])
            }
          }
        },
        {
          label: 'Clone Repository',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:clone-repository')
            }
          }
        },
        {
          label: 'Init Repository',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:init-repository')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:close-tab')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:settings')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click: (): void => {
            app.quit()
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:toggle-sidebar')
            }
          }
        },
        {
          label: 'Toggle Terminal',
          accelerator: 'CmdOrCtrl+`',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:toggle-terminal')
            }
          }
        },
        {
          label: 'Toggle Branch Labels',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:toggle-branch-labels')
            }
          }
        },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              win.webContents.send('menu:keyboard-shortcuts')
            }
          }
        },
        { type: 'separator' },
        {
          label: 'About GitSlop',
          click: (): void => {
            const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
            if (win && !win.isDestroyed()) {
              dialog.showMessageBox(win, {
                type: 'info',
                title: 'About GitSlop',
                message: 'GitSlop',
                detail: `Version: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChromium: ${process.versions.chrome}\nNode.js: ${process.versions.node}`,
                buttons: ['OK']
              })
            }
          }
        }
      ]
    }
  ]

  // Keep the menu for keyboard accelerators but hide it (frameless window has in-app menu)
  const menu = Menu.buildFromTemplate(menuTemplate)
  Menu.setApplicationMenu(menu)
  if (mainWindow) {
    mainWindow.setMenuBarVisibility(false)
  }

  // ─── CLI: --open-repo <path> support (for GUI testing) ────────────────────
  const openRepoArg = process.argv.find((_, i) => process.argv[i - 1] === '--open-repo')
  if (openRepoArg && mainWindow) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow?.webContents.send('cli:open-repo', openRepoArg)
    })
  }

  // ─── Auto-Updater Setup ──────────────────────────────────────────────────
  if (!isDev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.logger = {
      info: (msg: unknown) => console.log('[AutoUpdater]', msg),
      warn: (msg: unknown) => console.warn('[AutoUpdater]', msg),
      error: (msg: unknown) => console.error('[AutoUpdater]', msg),
      debug: (msg: unknown) => console.log('[AutoUpdater:debug]', msg)
    }

    autoUpdater.on('update-available', (info) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('updater:update-available', {
          version: info.version,
          releaseDate: info.releaseDate
        })
      }
    })

    autoUpdater.on('update-downloaded', (info) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) {
        win.webContents.send('updater:update-downloaded', {
          version: info.version
        })
      }
    })

    autoUpdater.on('error', (err) => {
      console.error('[AutoUpdater] Error:', err.message)
    })

    // Check for updates after a brief delay
    setTimeout(() => {
      autoUpdater.checkForUpdatesAndNotify().catch((err) => {
        console.error('[AutoUpdater] Check failed:', err)
      })
    }, 5000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// ─── File Read/Write IPC ─────────────────────────────────────────────────────

ipcMain.handle('file:read', async (_event, filePath: string) => {
  return new Promise<{ success: boolean; data?: string; error?: string }>((resolve) => {
    readFile(filePath, 'utf-8', (err, data) => {
      if (err) {
        resolve({ success: false, error: err.message })
      } else {
        resolve({ success: true, data })
      }
    })
  })
})

ipcMain.handle('file:write', async (_event, filePath: string, content: string) => {
  return new Promise<{ success: boolean; error?: string }>((resolve) => {
    writeFile(filePath, content, 'utf-8', (err) => {
      if (err) {
        resolve({ success: false, error: err.message })
      } else {
        resolve({ success: true })
      }
    })
  })
})

// ─── File Watcher for repo changes (chokidar) ──────────────────────────────

let activeWatcher: FSWatcher | null = null
const watcherState = createWatcherState()

/**
 * Suppress watcher events for a duration (ms) after git operations complete.
 * While suppressed, file change events are silently dropped.
 */
export function suppressWatcher(durationMs = 1000): void {
  _suppressWatcher(watcherState, durationMs)
}

/**
 * Track start/end of git operations. While any operation is in progress,
 * watcher events are suppressed. After the last operation completes,
 * events remain suppressed for 1 additional second.
 */
export function gitOperationStarted(): void {
  _gitOperationStarted(watcherState)
}

export function gitOperationFinished(): void {
  _gitOperationFinished(watcherState)
}

/**
 * Send a repo:changed event immediately, bypassing watcher suppression.
 * Used after git operations complete to ensure the UI refreshes,
 * since the normal file watcher events are suppressed during operations.
 */
export function sendRepoChangedForced(): void {
  // Small delay to let git finish writing to disk
  setTimeout(() => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('repo:changed')
    }
  }, 150)
}

function sendRepoChanged(): void {
  // Drop events while git operations are in progress or during suppression window
  if (_isWatcherSuppressed(watcherState)) {
    return
  }

  if (watcherState.debounceTimer) {
    clearTimeout(watcherState.debounceTimer)
  }
  watcherState.debounceTimer = setTimeout(() => {
    // Re-check suppression at send time (operation may have started during debounce)
    if (_isWatcherSuppressed(watcherState)) {
      return
    }
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('repo:changed')
    }
  }, 500)
}

ipcMain.handle('watcher:start', async (_event, repoPath: string) => {
  // Stop previous watcher if any
  if (activeWatcher) {
    await activeWatcher.close()
    activeWatcher = null
  }

  try {
    activeWatcher = chokidarWatch(repoPath, {
      ignored: (path: string) => shouldIgnorePath(path),
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100
      }
    })

    activeWatcher.on('add', () => sendRepoChanged())
    activeWatcher.on('change', () => sendRepoChanged())
    activeWatcher.on('unlink', () => sendRepoChanged())
    activeWatcher.on('addDir', () => sendRepoChanged())
    activeWatcher.on('unlinkDir', () => sendRepoChanged())

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Watch failed' }
  }
})

ipcMain.handle('watcher:stop', async () => {
  if (activeWatcher) {
    await activeWatcher.close()
    activeWatcher = null
  }
  return { success: true }
})

// ─── Auto-Updater IPC ─────────────────────────────────────────────────────

ipcMain.handle('updater:checkForUpdates', async () => {
  if (isDev) return { success: false, error: 'Auto-update disabled in development' }
  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      success: true,
      data: result
        ? { version: result.updateInfo.version, releaseDate: result.updateInfo.releaseDate }
        : null
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Update check failed' }
  }
})

ipcMain.handle('updater:quitAndInstall', () => {
  autoUpdater.quitAndInstall()
})

// ─── Auto-Fetch IPC ────────────────────────────────────────────────────────

ipcMain.handle('git:autoFetch', async (_event, repoPath: string) => {
  try {
    suppressWatcher(1000)
    await gitService.fetch(repoPath)
    suppressWatcher(1000)
    // After fetch, check ahead/behind
    const branch = await gitService.getCurrentBranch(repoPath)
    const branches = await gitService.getBranches(repoPath)
    const current = branches.find((b: { name: string; isCurrent?: boolean; current?: boolean }) => b.isCurrent || b.current)
    const behind = current?.behind || 0
    const ahead = current?.ahead || 0
    return { success: true, data: { behind, ahead, branch } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Auto-fetch failed' }
  }
})

app.on('window-all-closed', () => {
  if (activeWatcher) {
    activeWatcher.close().catch(() => {/* ignore */})
    activeWatcher = null
  }
  killAllTerminals()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
