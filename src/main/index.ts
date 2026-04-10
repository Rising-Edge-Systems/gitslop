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

interface IntegrationAccount {
  id: string
  label: string      // user-chosen name like "Work" or "Personal"
  username: string    // fetched from API after login
  token: string       // encrypted via safeStorage
  instanceUrl?: string // for self-hosted GitLab
}

interface StoreSchema {
  recentRepos: RecentRepo[]
  profiles: Profile[]
  activeProfileId: string
  githubAccounts: IntegrationAccount[]
  gitlabAccounts: IntegrationAccount[]
  // Legacy single-token fields (migrated on load)
  githubToken?: string
  gitlabToken?: string
  gitlabInstanceUrl?: string
}

const store = new Store<StoreSchema>({
  defaults: {
    recentRepos: [],
    profiles: [],
    activeProfileId: '',
    githubAccounts: [],
    gitlabAccounts: []
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

// Migrate legacy single-token to multi-account on first access
function migrateGitHubLegacy(): void {
  const legacy = store.get('githubToken' as keyof StoreSchema, '') as string
  if (legacy && legacy !== '') {
    const token = decryptToken(legacy)
    if (token) {
      const accounts = store.get('githubAccounts', [])
      if (accounts.length === 0) {
        accounts.push({ id: `gh-${Date.now()}`, label: 'Default', username: '', token: encryptToken(token) })
        store.set('githubAccounts', accounts)
      }
    }
    store.delete('githubToken' as keyof StoreSchema)
  }
}

ipcMain.handle('github:addAccount', async (_event, pat: string, label: string) => {
  try {
    const { statusCode, data } = await githubApiRequest('GET', '/user', pat)
    if (statusCode !== 200) {
      const parsed = JSON.parse(data)
      return { success: false, error: parsed.message || 'Authentication failed' }
    }
    const user = JSON.parse(data)
    const account: IntegrationAccount = {
      id: `gh-${Date.now()}`,
      label: label || user.login,
      username: user.login,
      token: encryptToken(pat)
    }
    const accounts = store.get('githubAccounts', [])
    accounts.push(account)
    store.set('githubAccounts', accounts)
    return {
      success: true,
      data: { id: account.id, label: account.label, username: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: user.email }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
  }
})

ipcMain.handle('github:getAccounts', async () => {
  migrateGitHubLegacy()
  const accounts = store.get('githubAccounts', [])
  const results = []
  for (const acct of accounts) {
    const token = decryptToken(acct.token)
    if (!token) continue
    try {
      const { statusCode, data } = await githubApiRequest('GET', '/user', token)
      if (statusCode === 200) {
        const user = JSON.parse(data)
        results.push({ id: acct.id, label: acct.label, username: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: user.email })
      } else {
        results.push({ id: acct.id, label: acct.label, username: acct.username, name: acct.username, avatarUrl: '', email: '', error: 'Token expired' })
      }
    } catch {
      results.push({ id: acct.id, label: acct.label, username: acct.username, name: acct.username, avatarUrl: '', email: '', error: 'Connection failed' })
    }
  }
  return { success: true, data: results }
})

ipcMain.handle('github:removeAccount', (_event, accountId: string) => {
  const accounts = store.get('githubAccounts', [])
  store.set('githubAccounts', accounts.filter((a: IntegrationAccount) => a.id !== accountId))
  return { success: true }
})

// Legacy compatibility — getUser returns first account, login adds account
ipcMain.handle('github:getUser', async () => {
  migrateGitHubLegacy()
  const accounts = store.get('githubAccounts', [])
  if (accounts.length === 0) return { success: false, error: 'Not logged in' }
  const token = decryptToken(accounts[0].token)
  if (!token) return { success: false, error: 'Not logged in' }
  try {
    const { statusCode, data } = await githubApiRequest('GET', '/user', token)
    if (statusCode !== 200) return { success: false, error: 'Token invalid' }
    const user = JSON.parse(data)
    return { success: true, data: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: user.email } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed' }
  }
})

ipcMain.handle('github:login', async (_event, pat: string) => {
  try {
    const { statusCode, data } = await githubApiRequest('GET', '/user', pat)
    if (statusCode !== 200) {
      const parsed = JSON.parse(data)
      return { success: false, error: parsed.message || 'Authentication failed' }
    }
    const user = JSON.parse(data)
    const account: IntegrationAccount = { id: `gh-${Date.now()}`, label: user.login, username: user.login, token: encryptToken(pat) }
    const accounts = store.get('githubAccounts', [])
    accounts.push(account)
    store.set('githubAccounts', accounts)
    return { success: true, data: { login: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: user.email } }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
  }
})

ipcMain.handle('github:logout', () => {
  store.set('githubAccounts', [])
  return { success: true }
})

ipcMain.handle('github:isLoggedIn', () => {
  const encrypted = store.get('githubToken', '')
  const token = decryptToken(encrypted)
  return { success: true, data: !!token }
})

// ─── GitHub OAuth Device Flow ────────────────────────────────────────────

const GITHUB_OAUTH_CLIENT_ID = 'Ov23liAVjXNTZR7qBroD'

// Track active device flow polling so we can cancel it
let deviceFlowAbortController: { cancelled: boolean } | null = null

function githubFormPost(
  path: string,
  body: string
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'github.com',
      path,
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'GitSlop'
      }
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk: string) => { data += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }))
    })
    req.on('error', (err) => reject(err))
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')) })
    req.write(body)
    req.end()
  })
}

ipcMain.handle('github:startDeviceFlow', async () => {
  try {
    const body = `client_id=${GITHUB_OAUTH_CLIENT_ID}&scope=repo,read:user,read:org`
    const { statusCode, data } = await githubFormPost('/login/device/code', body)
    if (statusCode !== 200) {
      return { success: false, error: `GitHub returned status ${statusCode}` }
    }
    const parsed = JSON.parse(data)
    if (parsed.error) {
      return { success: false, error: parsed.error_description || parsed.error }
    }
    // Reset abort controller for new flow
    deviceFlowAbortController = { cancelled: false }
    return {
      success: true,
      data: {
        deviceCode: parsed.device_code,
        userCode: parsed.user_code,
        verificationUri: parsed.verification_uri,
        expiresIn: parsed.expires_in,
        interval: parsed.interval || 5
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to start device flow' }
  }
})

ipcMain.handle('github:pollDeviceFlow', async (_event, deviceCode: string, interval: number) => {
  // Reset abort controller
  const controller = deviceFlowAbortController || { cancelled: false }
  deviceFlowAbortController = controller

  const pollOnce = async (): Promise<{ success: boolean; data?: unknown; error?: string }> => {
    const body = `client_id=${GITHUB_OAUTH_CLIENT_ID}&device_code=${deviceCode}&grant_type=urn:ietf:params:oauth:grant-type:device_code`
    const { data } = await githubFormPost('/login/oauth/access_token', body)
    const parsed = JSON.parse(data)

    if (parsed.access_token) {
      // Success! Validate token and add account
      const { statusCode, data: userData } = await githubApiRequest('GET', '/user', parsed.access_token)
      if (statusCode !== 200) {
        return { success: false, error: 'Got token but failed to fetch user info' }
      }
      const user = JSON.parse(userData)
      const account: IntegrationAccount = {
        id: `gh-${Date.now()}`,
        label: user.login,
        username: user.login,
        token: encryptToken(parsed.access_token)
      }
      const accounts = store.get('githubAccounts', [])
      accounts.push(account)
      store.set('githubAccounts', accounts)
      return {
        success: true,
        data: {
          status: 'complete',
          account: { id: account.id, label: account.label, username: user.login, name: user.name || user.login, avatarUrl: user.avatar_url, email: user.email }
        }
      }
    }

    if (parsed.error === 'authorization_pending') {
      return { success: true, data: { status: 'pending' } }
    }
    if (parsed.error === 'slow_down') {
      return { success: true, data: { status: 'slow_down', interval: parsed.interval || interval + 5 } }
    }
    if (parsed.error === 'expired_token') {
      return { success: false, error: 'Device code expired. Please try again.' }
    }
    if (parsed.error === 'access_denied') {
      return { success: false, error: 'Access denied. The user cancelled the authorization.' }
    }
    return { success: false, error: parsed.error_description || parsed.error || 'Unknown error' }
  }

  // Poll in a loop until success, error, or cancellation
  let currentInterval = interval
  const maxAttempts = 360 // 30 minutes at 5s intervals max
  for (let i = 0; i < maxAttempts; i++) {
    if (controller.cancelled) {
      return { success: false, error: 'Cancelled' }
    }
    await new Promise(resolve => setTimeout(resolve, currentInterval * 1000))
    if (controller.cancelled) {
      return { success: false, error: 'Cancelled' }
    }
    try {
      const result = await pollOnce()
      if (!result.success) return result
      const status = (result.data as { status: string; interval?: number }).status
      if (status === 'complete') return result
      if (status === 'slow_down') {
        currentInterval = (result.data as { status: string; interval: number }).interval
      }
      // 'pending' — continue polling
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Polling failed' }
    }
  }
  return { success: false, error: 'Polling timed out' }
})

ipcMain.handle('github:cancelDeviceFlow', () => {
  if (deviceFlowAbortController) {
    deviceFlowAbortController.cancelled = true
    deviceFlowAbortController = null
  }
  return { success: true }
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

// ─── GitLab Integration IPC handlers ──────────────────────────────────────

function gitlabApiRequest(
  method: string,
  path: string,
  token: string,
  instanceUrl: string,
  body?: string
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, instanceUrl)
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? https : require('http')
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'PRIVATE-TOKEN': token,
        'User-Agent': 'GitSlop',
        'Accept': 'application/json',
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {})
      }
    }
    const req = httpModule.request(options, (res: { statusCode?: number; on: (event: string, cb: (chunk?: string) => void) => void }) => {
      let data = ''
      res.on('data', (chunk?: string) => { data += chunk || '' })
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, data }))
    })
    req.on('error', (err: Error) => reject(err))
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')) })
    if (body) req.write(body)
    req.end()
  })
}

// Migrate legacy single GitLab token to multi-account on first access
function migrateGitLabLegacy(): void {
  const legacy = store.get('gitlabToken' as keyof StoreSchema, '') as string
  if (legacy && legacy !== '') {
    const token = decryptToken(legacy)
    if (token) {
      const accounts = store.get('gitlabAccounts', [])
      if (accounts.length === 0) {
        const instanceUrl = store.get('gitlabInstanceUrl' as keyof StoreSchema, 'https://gitlab.com') as string
        accounts.push({ id: `gl-${Date.now()}`, label: 'Default', username: '', token: encryptToken(token), instanceUrl })
        store.set('gitlabAccounts', accounts)
      }
    }
    store.delete('gitlabToken' as keyof StoreSchema)
    store.delete('gitlabInstanceUrl' as keyof StoreSchema)
  }
}

function getGitLabConfig(): { token: string; instanceUrl: string } {
  // Try multi-account first (use first account as default)
  migrateGitLabLegacy()
  const accounts = store.get('gitlabAccounts', [])
  if (accounts.length > 0) {
    const token = decryptToken(accounts[0].token)
    const instanceUrl = accounts[0].instanceUrl || 'https://gitlab.com'
    return { token, instanceUrl }
  }
  return { token: '', instanceUrl: 'https://gitlab.com' }
}

ipcMain.handle('gitlab:addAccount', async (_event, pat: string, label: string, instanceUrl?: string) => {
  try {
    const baseUrl = instanceUrl || 'https://gitlab.com'
    const { statusCode, data } = await gitlabApiRequest('GET', '/api/v4/user', pat, baseUrl)
    if (statusCode !== 200) {
      let msg = 'Authentication failed'
      try { msg = JSON.parse(data).message || msg } catch { /* */ }
      return { success: false, error: msg }
    }
    const user = JSON.parse(data)
    const account: IntegrationAccount = {
      id: `gl-${Date.now()}`,
      label: label || user.username,
      username: user.username,
      token: encryptToken(pat),
      instanceUrl: baseUrl
    }
    const accounts = store.get('gitlabAccounts', [])
    accounts.push(account)
    store.set('gitlabAccounts', accounts)
    return {
      success: true,
      data: { id: account.id, label: account.label, username: user.username, name: user.name || user.username, avatarUrl: user.avatar_url, email: user.email, instanceUrl: baseUrl, webUrl: user.web_url }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
  }
})

ipcMain.handle('gitlab:getAccounts', async () => {
  migrateGitLabLegacy()
  const accounts = store.get('gitlabAccounts', [])
  const results = []
  for (const acct of accounts) {
    const token = decryptToken(acct.token)
    if (!token) continue
    const baseUrl = acct.instanceUrl || 'https://gitlab.com'
    try {
      const { statusCode, data } = await gitlabApiRequest('GET', '/api/v4/user', token, baseUrl)
      if (statusCode === 200) {
        const user = JSON.parse(data)
        results.push({ id: acct.id, label: acct.label, username: user.username, name: user.name || user.username, avatarUrl: user.avatar_url, email: user.email, instanceUrl: baseUrl, webUrl: user.web_url })
      } else {
        results.push({ id: acct.id, label: acct.label, username: acct.username, name: acct.username, avatarUrl: '', email: '', instanceUrl: baseUrl, webUrl: '', error: 'Token expired' })
      }
    } catch {
      results.push({ id: acct.id, label: acct.label, username: acct.username, name: acct.username, avatarUrl: '', email: '', instanceUrl: baseUrl, webUrl: '', error: 'Connection failed' })
    }
  }
  return { success: true, data: results }
})

ipcMain.handle('gitlab:removeAccount', (_event, accountId: string) => {
  const accounts = store.get('gitlabAccounts', [])
  store.set('gitlabAccounts', accounts.filter((a: IntegrationAccount) => a.id !== accountId))
  return { success: true }
})

// Parse GitLab project path from a remote URL
function parseGitLabRemote(url: string, instanceUrl: string): { projectPath: string; webUrl: string } | null {
  // Extract the hostname from instanceUrl for matching
  let instanceHost: string
  try {
    instanceHost = new URL(instanceUrl).hostname
  } catch {
    instanceHost = 'gitlab.com'
  }

  // SSH: git@gitlab.com:owner/repo.git or git@gitlab.com:group/subgroup/repo.git
  const sshMatch = url.match(new RegExp(`${instanceHost.replace(/\./g, '\\.')}[:/](.+?)(?:\\.git)?$`))
  if (sshMatch) {
    return { projectPath: sshMatch[1], webUrl: `${instanceUrl}/${sshMatch[1]}` }
  }

  // HTTPS: https://gitlab.com/owner/repo.git or https://gitlab.com/group/subgroup/repo
  const httpsMatch = url.match(new RegExp(`${instanceHost.replace(/\./g, '\\.')}[/](.+?)(?:\\.git)?$`))
  if (httpsMatch) {
    return { projectPath: httpsMatch[1], webUrl: `${instanceUrl}/${httpsMatch[1]}` }
  }

  return null
}

// Legacy compatibility — login adds as account, getUser returns first account
ipcMain.handle('gitlab:login', async (_event, pat: string, instanceUrl?: string) => {
  try {
    const baseUrl = instanceUrl || 'https://gitlab.com'
    const { statusCode, data } = await gitlabApiRequest('GET', '/api/v4/user', pat, baseUrl)
    if (statusCode !== 200) {
      let msg = 'Authentication failed'
      try { msg = JSON.parse(data).message || msg } catch { /* */ }
      return { success: false, error: msg }
    }
    const user = JSON.parse(data)
    // Add as multi-account
    const account: IntegrationAccount = {
      id: `gl-${Date.now()}`,
      label: user.username,
      username: user.username,
      token: encryptToken(pat),
      instanceUrl: baseUrl
    }
    const accounts = store.get('gitlabAccounts', [])
    accounts.push(account)
    store.set('gitlabAccounts', accounts)
    return {
      success: true,
      data: {
        username: user.username,
        name: user.name || user.username,
        avatarUrl: user.avatar_url,
        email: user.email,
        webUrl: user.web_url
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Login failed' }
  }
})

ipcMain.handle('gitlab:getUser', async () => {
  const { token, instanceUrl } = getGitLabConfig()
  if (!token) return { success: false, error: 'Not logged in' }
  try {
    const { statusCode, data } = await gitlabApiRequest('GET', '/api/v4/user', token, instanceUrl)
    if (statusCode !== 200) {
      return { success: false, error: 'Token invalid or expired' }
    }
    const user = JSON.parse(data)
    return {
      success: true,
      data: {
        username: user.username,
        name: user.name || user.username,
        avatarUrl: user.avatar_url,
        email: user.email,
        webUrl: user.web_url
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to get user' }
  }
})

ipcMain.handle('gitlab:logout', () => {
  // Legacy compat: remove all accounts
  store.set('gitlabAccounts', [])
  return { success: true }
})

ipcMain.handle('gitlab:isLoggedIn', () => {
  const { token } = getGitLabConfig()
  return { success: true, data: !!token }
})

ipcMain.handle('gitlab:getInstanceUrl', () => {
  const { token, instanceUrl } = getGitLabConfig()
  return { success: true, data: token ? instanceUrl : 'https://gitlab.com' }
})

ipcMain.handle('gitlab:parseRemote', async (_event, repoPath: string) => {
  try {
    const { instanceUrl } = getGitLabConfig()
    const remotes = await gitService.getRemotes(repoPath)
    const origin = remotes.find((r: { name: string }) => r.name === 'origin') || remotes[0]
    if (!origin) return { success: false, error: 'No remotes found' }
    const parsed = parseGitLabRemote(origin.fetchUrl, instanceUrl)
    if (!parsed) return { success: false, error: 'Not a GitLab repository' }
    return { success: true, data: parsed }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to parse remote' }
  }
})

ipcMain.handle('gitlab:listMergeRequests', async (_event, projectPath: string, state?: string) => {
  const { token, instanceUrl } = getGitLabConfig()
  if (!token) return { success: false, error: 'Not logged in to GitLab' }
  try {
    const queryState = state === 'closed' ? 'merged' : (state || 'opened')
    const encodedPath = encodeURIComponent(projectPath)
    const { statusCode, data } = await gitlabApiRequest(
      'GET',
      `/api/v4/projects/${encodedPath}/merge_requests?state=${queryState}&per_page=50&order_by=updated_at&sort=desc`,
      token,
      instanceUrl
    )
    if (statusCode !== 200) {
      let msg = 'Failed to fetch merge requests'
      try { msg = JSON.parse(data).message || msg } catch { /* */ }
      return { success: false, error: msg }
    }
    const mrs = JSON.parse(data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mapped = mrs.map((mr: any) => ({
      iid: mr.iid,
      title: mr.title,
      state: mr.state,
      author: mr.author?.username || 'unknown',
      authorAvatar: mr.author?.avatar_url || '',
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      sourceBranch: mr.source_branch || '',
      targetBranch: mr.target_branch || '',
      draft: mr.draft || mr.work_in_progress || false,
      webUrl: mr.web_url,
      description: mr.description || '',
      labels: (mr.labels || []).map((l: string) => ({ name: l })),
      mergeStatus: mr.merge_status,
      hasConflicts: mr.has_conflicts || false,
      userNotesCount: mr.user_notes_count || 0
    }))
    return { success: true, data: mapped }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch merge requests' }
  }
})

ipcMain.handle('gitlab:getMergeRequest', async (_event, projectPath: string, mrIid: number) => {
  const { token, instanceUrl } = getGitLabConfig()
  if (!token) return { success: false, error: 'Not logged in to GitLab' }
  try {
    const encodedPath = encodeURIComponent(projectPath)
    // Fetch MR details, notes (comments), and changes (files) in parallel
    const [mrRes, notesRes, changesRes] = await Promise.all([
      gitlabApiRequest('GET', `/api/v4/projects/${encodedPath}/merge_requests/${mrIid}`, token, instanceUrl),
      gitlabApiRequest('GET', `/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/notes?per_page=50&sort=asc`, token, instanceUrl),
      gitlabApiRequest('GET', `/api/v4/projects/${encodedPath}/merge_requests/${mrIid}/changes`, token, instanceUrl)
    ])

    if (mrRes.statusCode !== 200) {
      let msg = 'Failed to fetch MR'
      try { msg = JSON.parse(mrRes.data).message || msg } catch { /* */ }
      return { success: false, error: msg }
    }

    const mr = JSON.parse(mrRes.data)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notes = notesRes.statusCode === 200 ? JSON.parse(notesRes.data).filter((n: any) => !n.system).map((n: any) => ({
      id: n.id,
      author: n.author?.username || 'unknown',
      authorAvatar: n.author?.avatar_url || '',
      body: n.body || '',
      createdAt: n.created_at
    })) : []

    let files: { filename: string; status: string; additions: number; deletions: number; changes: number }[] = []
    if (changesRes.statusCode === 200) {
      const changesData = JSON.parse(changesRes.data)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      files = (changesData.changes || []).map((f: any) => ({
        filename: f.new_path || f.old_path,
        status: f.new_file ? 'added' : f.deleted_file ? 'removed' : f.renamed_file ? 'renamed' : 'modified',
        additions: 0, // GitLab changes endpoint doesn't give line counts per file easily
        deletions: 0,
        changes: 0
      }))
    }

    return {
      success: true,
      data: {
        iid: mr.iid,
        title: mr.title,
        state: mr.state,
        author: mr.author?.username || 'unknown',
        authorAvatar: mr.author?.avatar_url || '',
        createdAt: mr.created_at,
        updatedAt: mr.updated_at,
        sourceBranch: mr.source_branch || '',
        targetBranch: mr.target_branch || '',
        draft: mr.draft || mr.work_in_progress || false,
        webUrl: mr.web_url,
        description: mr.description || '',
        labels: (mr.labels || []).map((l: string) => ({ name: l })),
        mergeStatus: mr.merge_status,
        hasConflicts: mr.has_conflicts || false,
        userNotesCount: mr.user_notes_count || 0,
        notes,
        files
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to fetch MR details' }
  }
})

ipcMain.handle('gitlab:createMergeRequest', async (_event, projectPath: string, opts: { title: string; description: string; sourceBranch: string; targetBranch: string }) => {
  const { token, instanceUrl } = getGitLabConfig()
  if (!token) return { success: false, error: 'Not logged in to GitLab' }
  try {
    const encodedPath = encodeURIComponent(projectPath)
    const body = JSON.stringify({
      title: opts.title,
      description: opts.description,
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch
    })
    const { statusCode, data } = await gitlabApiRequest(
      'POST',
      `/api/v4/projects/${encodedPath}/merge_requests`,
      token,
      instanceUrl,
      body
    )
    if (statusCode !== 201) {
      let msg = 'Failed to create merge request'
      try {
        const parsed = JSON.parse(data)
        msg = (Array.isArray(parsed.message) ? parsed.message.join(', ') : parsed.message) || msg
      } catch { /* */ }
      return { success: false, error: msg }
    }
    const mr = JSON.parse(data)
    return {
      success: true,
      data: {
        iid: mr.iid,
        title: mr.title,
        webUrl: mr.web_url,
        state: mr.state
      }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to create merge request' }
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
let gitRefWatcher: FSWatcher | null = null
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
    // Don't let transient readdirp errors (e.g. traversing into .asar archives,
    // permission-denied dirs, broken symlinks) crash the main process.
    activeWatcher.on('error', (err) => {
      console.warn('[watcher] non-fatal error:', err instanceof Error ? err.message : err)
    })

    // Watch .git/refs and .git/HEAD for external changes (CLI commits, other tools).
    // This watcher uses the suppression-aware sendRepoChanged() so it won't double-fire
    // with sendRepoChangedForced() from our own IPC git operations.
    if (gitRefWatcher) {
      await gitRefWatcher.close()
      gitRefWatcher = null
    }
    const gitDir = join(repoPath, '.git')
    gitRefWatcher = chokidarWatch(
      [join(gitDir, 'HEAD'), join(gitDir, 'refs')],
      {
        ignoreInitial: true,
        persistent: true,
        depth: 5
      }
    )
    gitRefWatcher.on('add', () => sendRepoChanged())
    gitRefWatcher.on('change', () => sendRepoChanged())
    gitRefWatcher.on('unlink', () => sendRepoChanged())
    gitRefWatcher.on('error', (err) => {
      console.warn('[git-ref watcher] non-fatal error:', err instanceof Error ? err.message : err)
    })

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
  if (gitRefWatcher) {
    await gitRefWatcher.close()
    gitRefWatcher = null
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
