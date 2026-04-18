import { contextBridge, ipcRenderer } from 'electron'

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

export interface ProfileData {
  id: string
  name: string
  authorName: string
  authorEmail: string
  isDefault: boolean
  signingMethod: 'none' | 'gpg' | 'ssh'
  gpgKeyId?: string
  sshKeyPath?: string
}

export interface SSHKeyInfo {
  name: string
  path: string
  pubKeyPath: string
  type: string
  fingerprint: string
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
    about: (): Promise<void> => ipcRenderer.invoke('menu:about'),
    showMessage: (title: string, message: string): Promise<void> => ipcRenderer.invoke('window:showMessage', title, message),
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
      opts?: { maxCount?: number; skip?: number; all?: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string; includeHashes?: string[] }
    ): Promise<GitServiceResult> => ipcRenderer.invoke('git:log', repoPath, opts),
    commitCount: (
      repoPath: string,
      opts?: { all?: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string }
    ): Promise<GitServiceResult> => ipcRenderer.invoke('git:commitCount', repoPath, opts),
    getBranches: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getBranches', repoPath),
    getRemotes: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getRemotes', repoPath),
    getBranchesContaining: (
      repoPath: string,
      hash: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getBranchesContaining', repoPath, hash),
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
    diffNumstat: (
      repoPath: string,
      opts?: { staged?: boolean }
    ): Promise<GitServiceResult> => ipcRenderer.invoke('git:diffNumstat', repoPath, opts),
    showCommit: (repoPath: string, hash: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showCommit', repoPath, hash),
    showCommitFileDiff: (
      repoPath: string,
      hash: string,
      filePath: string,
      opts?: { isMerge?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showCommitFileDiff', repoPath, hash, filePath, opts),
    diffTwoCommits: (
      repoPath: string,
      hashFrom: string,
      hashTo: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:diffTwoCommits', repoPath, hashFrom, hashTo),
    diffTwoCommitsFile: (
      repoPath: string,
      hashFrom: string,
      hashTo: string,
      filePath: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:diffTwoCommitsFile', repoPath, hashFrom, hashTo, filePath),
    showFileAtCommit: (
      repoPath: string,
      hash: string,
      filePath: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showFileAtCommit', repoPath, hash, filePath),
    showFileAtParent: (
      repoPath: string,
      hash: string,
      filePath: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:showFileAtParent', repoPath, hash, filePath),
    listFilesAtCommit: (
      repoPath: string,
      hash: string
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:listFilesAtCommit', repoPath, hash),
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
      opts?: { amend?: boolean; signoff?: boolean; gpgSign?: boolean; gpgKeyId?: string }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:commit', repoPath, message, opts),
    getLastCommitMessage: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getLastCommitMessage', repoPath),
    push: (
      repoPath: string,
      opts?: { force?: boolean; setUpstream?: { remote: string; branch: string } }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:push', repoPath, opts),
    pull: (repoPath: string, opts?: { rebase?: boolean; autoStash?: boolean }): Promise<GitServiceResult> =>
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
      opts?: { noFastForward?: boolean; fastForwardOnly?: boolean; squash?: boolean }
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
    blame: (repoPath: string, filePath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:blame', repoPath, filePath),
    autoFetch: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:autoFetch', repoPath),
    discardFiles: (
      repoPath: string,
      filePaths: string[],
      opts?: { untracked?: boolean }
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:discardFiles', repoPath, filePaths, opts),
    discardHunk: (repoPath: string, patch: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:discardHunk', repoPath, patch),
    fileLog: (
      repoPath: string,
      filePath: string,
      maxCount?: number
    ): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:fileLog', repoPath, filePath, maxCount),
    getSubmodules: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getSubmodules', repoPath),
    submoduleInit: (repoPath: string, submodulePath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:submoduleInit', repoPath, submodulePath),
    submoduleUpdate: (repoPath: string, submodulePath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:submoduleUpdate', repoPath, submodulePath),
    getAvailableGpgKeys: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getAvailableGpgKeys'),
    getGitSigningKey: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:getGitSigningKey', repoPath),
    setGitSigningKey: (repoPath: string, keyId: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('git:setGitSigningKey', repoPath, keyId),
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
  file: {
    read: (filePath: string): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('file:read', filePath),
    write: (filePath: string, content: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('file:write', filePath, content)
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
  },
  profiles: {
    list: (): Promise<ProfileData[]> => ipcRenderer.invoke('profiles:list'),
    getActive: (): Promise<string> => ipcRenderer.invoke('profiles:getActive'),
    create: (profile: Omit<ProfileData, 'id'>): Promise<ProfileData> =>
      ipcRenderer.invoke('profiles:create', profile),
    update: (id: string, updates: Partial<Omit<ProfileData, 'id'>>): Promise<GitServiceResult> =>
      ipcRenderer.invoke('profiles:update', id, updates),
    delete: (id: string): Promise<ProfileData[]> =>
      ipcRenderer.invoke('profiles:delete', id),
    setActive: (id: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('profiles:setActive', id),
    apply: (id: string, repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('profiles:apply', id, repoPath)
  },
  sshkeys: {
    list: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('sshkeys:list'),
    readPublicKey: (pubKeyPath: string): Promise<{ success: boolean; data?: string; error?: string }> =>
      ipcRenderer.invoke('sshkeys:readPublicKey', pubKeyPath),
    copyToClipboard: (text: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('sshkeys:copyToClipboard', text),
    generate: (opts: {
      name: string
      type: 'ed25519' | 'rsa'
      passphrase?: string
      comment?: string
    }): Promise<GitServiceResult> =>
      ipcRenderer.invoke('sshkeys:generate', opts),
    testConnection: (host: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('sshkeys:testConnection', host)
  },
  github: {
    login: (pat: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:login', pat),
    getUser: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:getUser'),
    logout: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:logout'),
    addAccount: (pat: string, label: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:addAccount', pat, label),
    getAccounts: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:getAccounts'),
    removeAccount: (accountId: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:removeAccount', accountId),
    isLoggedIn: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:isLoggedIn'),
    startDeviceFlow: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:startDeviceFlow'),
    pollDeviceFlow: (deviceCode: string, interval: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:pollDeviceFlow', deviceCode, interval),
    cancelDeviceFlow: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:cancelDeviceFlow'),
    parseRemote: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:parseRemote', repoPath),
    listPullRequests: (owner: string, repo: string, state?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:listPullRequests', owner, repo, state),
    getPullRequest: (owner: string, repo: string, prNumber: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:getPullRequest', owner, repo, prNumber),
    createPullRequest: (owner: string, repo: string, opts: { title: string; body: string; head: string; base: string; draft?: boolean }): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:createPullRequest', owner, repo, opts),
    listIssues: (owner: string, repo: string, state?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:listIssues', owner, repo, state),
    getIssue: (owner: string, repo: string, issueNumber: number): Promise<GitServiceResult> =>
      ipcRenderer.invoke('github:getIssue', owner, repo, issueNumber)
  },
  gitlab: {
    login: (pat: string, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:login', pat, instanceUrl),
    getUser: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:getUser'),
    logout: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:logout'),
    addAccount: (pat: string, label: string, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:addAccount', pat, label, instanceUrl),
    startOAuthFlow: (opts: { instanceUrl?: string; clientId: string; label?: string }): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:startOAuthFlow', opts),
    getAccounts: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:getAccounts'),
    removeAccount: (accountId: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:removeAccount', accountId),
    isLoggedIn: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:isLoggedIn'),
    getInstanceUrl: (): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:getInstanceUrl'),
    parseRemote: (repoPath: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:parseRemote', repoPath),
    listMergeRequests: (projectPath: string, state?: string, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:listMergeRequests', projectPath, state, instanceUrl),
    getMergeRequest: (projectPath: string, mrIid: number, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:getMergeRequest', projectPath, mrIid, instanceUrl),
    createMergeRequest: (projectPath: string, opts: { title: string; description: string; sourceBranch: string; targetBranch: string }, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:createMergeRequest', projectPath, opts, instanceUrl),
    listIssues: (projectPath: string, state?: string, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:listIssues', projectPath, state, instanceUrl),
    getIssue: (projectPath: string, issueIid: number, instanceUrl?: string): Promise<GitServiceResult> =>
      ipcRenderer.invoke('gitlab:getIssue', projectPath, issueIid, instanceUrl)
  },
  updates: {
    checkForUpdates: (): Promise<{ available: boolean; version?: string; releaseNotes?: string }> =>
      ipcRenderer.invoke('updates:checkForUpdates'),
    downloadUpdate: (): Promise<void> =>
      ipcRenderer.invoke('updates:downloadUpdate'),
    installUpdate: (): Promise<void> =>
      ipcRenderer.invoke('updates:installUpdate'),
    onUpdateAvailable: (callback: (info: { version: string; releaseNotes: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, info: { version: string; releaseNotes: string }): void => {
        callback(info)
      }
      ipcRenderer.on('update:available', handler)
      return () => {
        ipcRenderer.removeListener('update:available', handler)
      }
    },
    onDownloadProgress: (callback: (progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: { percent: number; bytesPerSecond: number; transferred: number; total: number }): void => {
        callback(progress)
      }
      ipcRenderer.on('update:download-progress', handler)
      return () => {
        ipcRenderer.removeListener('update:download-progress', handler)
      }
    },
    onUpdateDownloaded: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('update:downloaded', handler)
      return () => {
        ipcRenderer.removeListener('update:downloaded', handler)
      }
    },
    onUpdateError: (callback: (error: { message: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: { message: string }): void => {
        callback(error)
      }
      ipcRenderer.on('update:error', handler)
      return () => {
        ipcRenderer.removeListener('update:error', handler)
      }
    },
    setAutoCheck: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('updates:setAutoCheck', enabled)
  },
  terminal: {
    create: (opts: { cwd?: string; id?: string }): Promise<{ success: boolean; data?: { id: string }; error?: string }> =>
      ipcRenderer.invoke('terminal:create', opts),
    write: (opts: { id: string; data: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:write', opts),
    resize: (opts: { id: string; cols: number; rows: number }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:resize', opts),
    kill: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:kill', id),
    setCwd: (opts: { id: string; cwd: string }): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:setCwd', opts),
    onData: (callback: (payload: { id: string; data: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; data: string }): void => {
        callback(payload)
      }
      ipcRenderer.on('terminal:data', handler)
      return () => {
        ipcRenderer.removeListener('terminal:data', handler)
      }
    },
    onExit: (callback: (payload: { id: string; exitCode: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: { id: string; exitCode: number }): void => {
        callback(payload)
      }
      ipcRenderer.on('terminal:exit', handler)
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler)
      }
    }
  }
}

// CLI: --open-repo support — listen for main process signal to auto-open a repo
const cliOpenRepoListeners: ((repoPath: string) => void)[] = []
ipcRenderer.on('cli:open-repo', (_event, repoPath: string) => {
  for (const listener of cliOpenRepoListeners) {
    listener(repoPath)
  }
})

const extendedElectronAPI = {
  ...electronAPI,
  onCliOpenRepo: (callback: (repoPath: string) => void): (() => void) => {
    cliOpenRepoListeners.push(callback)
    return () => {
      const idx = cliOpenRepoListeners.indexOf(callback)
      if (idx >= 0) cliOpenRepoListeners.splice(idx, 1)
    }
  },
  menu: {
    onOpenRepository: (callback: (repoPath: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, repoPath: string): void => {
        callback(repoPath)
      }
      ipcRenderer.on('menu:open-repository', handler)
      return () => {
        ipcRenderer.removeListener('menu:open-repository', handler)
      }
    },
    onCloneRepository: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:clone-repository', handler)
      return () => {
        ipcRenderer.removeListener('menu:clone-repository', handler)
      }
    },
    onInitRepository: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:init-repository', handler)
      return () => {
        ipcRenderer.removeListener('menu:init-repository', handler)
      }
    },
    onCloseTab: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:close-tab', handler)
      return () => {
        ipcRenderer.removeListener('menu:close-tab', handler)
      }
    },
    onSettings: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:settings', handler)
      return () => {
        ipcRenderer.removeListener('menu:settings', handler)
      }
    },
    onToggleSidebar: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:toggle-sidebar', handler)
      return () => {
        ipcRenderer.removeListener('menu:toggle-sidebar', handler)
      }
    },
    onToggleTerminal: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:toggle-terminal', handler)
      return () => {
        ipcRenderer.removeListener('menu:toggle-terminal', handler)
      }
    },
    onKeyboardShortcuts: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:keyboard-shortcuts', handler)
      return () => {
        ipcRenderer.removeListener('menu:keyboard-shortcuts', handler)
      }
    },
    onToggleBranchLabels: (callback: () => void): (() => void) => {
      const handler = (): void => {
        callback()
      }
      ipcRenderer.on('menu:toggle-branch-labels', handler)
      return () => {
        ipcRenderer.removeListener('menu:toggle-branch-labels', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('electronAPI', extendedElectronAPI)

export type ElectronAPI = typeof extendedElectronAPI
