import { useState, useCallback, useEffect, useRef } from 'react'

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

interface GitServiceResult {
  success: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any
  error?: string
  code?: string
  operationId?: string
}

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      git: {
        isRepo: (dirPath: string) => Promise<boolean>
        init: (dirPath: string) => Promise<{ success: boolean; error?: string }>
        getVersion: () => Promise<GitServiceResult>
        log: (repoPath: string, opts?: { maxCount?: number; all?: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string }) => Promise<GitServiceResult>
        getBranches: (repoPath: string) => Promise<GitServiceResult>
        getRemotes: (repoPath: string) => Promise<GitServiceResult>
        getTags: (repoPath: string) => Promise<GitServiceResult>
        createTag: (
          repoPath: string,
          name: string,
          target?: string,
          opts?: { message?: string }
        ) => Promise<GitServiceResult>
        deleteTag: (repoPath: string, name: string) => Promise<GitServiceResult>
        pushTag: (repoPath: string, tagName: string, remoteName?: string) => Promise<GitServiceResult>
        getStashes: (repoPath: string) => Promise<GitServiceResult>
        stashSave: (
          repoPath: string,
          opts?: { message?: string; includeUntracked?: boolean }
        ) => Promise<GitServiceResult>
        stashApply: (repoPath: string, index: number) => Promise<GitServiceResult>
        stashPop: (repoPath: string, index: number) => Promise<GitServiceResult>
        stashDrop: (repoPath: string, index: number) => Promise<GitServiceResult>
        stashShow: (repoPath: string, index: number) => Promise<GitServiceResult>
        getStatus: (repoPath: string) => Promise<GitServiceResult>
        diff: (repoPath: string, filePath?: string, opts?: { staged?: boolean }) => Promise<GitServiceResult>
        showCommit: (repoPath: string, hash: string) => Promise<GitServiceResult>
        showCommitFileDiff: (repoPath: string, hash: string, filePath: string) => Promise<GitServiceResult>
        cancelOperation: (operationId: string) => Promise<{ success: boolean; error?: string }>
        exec: (args: string[], repoPath: string) => Promise<GitServiceResult>
        checkout: (repoPath: string, branchName: string) => Promise<GitServiceResult>
        createBranch: (
          repoPath: string,
          branchName: string,
          baseBranch?: string,
          opts?: { checkout?: boolean }
        ) => Promise<GitServiceResult>
        deleteBranch: (
          repoPath: string,
          branchName: string,
          opts?: { force?: boolean }
        ) => Promise<GitServiceResult>
        renameBranch: (
          repoPath: string,
          oldName: string,
          newName: string
        ) => Promise<GitServiceResult>
        getRemoteBranches: (repoPath: string) => Promise<GitServiceResult>
        addRemote: (repoPath: string, name: string, url: string) => Promise<GitServiceResult>
        editRemoteUrl: (repoPath: string, name: string, newUrl: string) => Promise<GitServiceResult>
        removeRemote: (repoPath: string, name: string) => Promise<GitServiceResult>
        fetch: (repoPath: string, remoteName?: string) => Promise<GitServiceResult>
        deleteRemoteBranch: (repoPath: string, remoteName: string, branchName: string) => Promise<GitServiceResult>
        checkoutRemoteBranch: (repoPath: string, remoteName: string, branchName: string) => Promise<GitServiceResult>
        stageFiles: (repoPath: string, filePaths: string[]) => Promise<GitServiceResult>
        unstageFiles: (repoPath: string, filePaths: string[]) => Promise<GitServiceResult>
        stageAll: (repoPath: string) => Promise<GitServiceResult>
        unstageAll: (repoPath: string) => Promise<GitServiceResult>
        stageHunk: (repoPath: string, patch: string) => Promise<GitServiceResult>
        unstageHunk: (repoPath: string, patch: string) => Promise<GitServiceResult>
        commit: (
          repoPath: string,
          message: string,
          opts?: { amend?: boolean; signoff?: boolean; gpgSign?: boolean; gpgKeyId?: string }
        ) => Promise<GitServiceResult>
        getLastCommitMessage: (repoPath: string) => Promise<GitServiceResult>
        push: (
          repoPath: string,
          opts?: { force?: boolean; setUpstream?: { remote: string; branch: string } }
        ) => Promise<GitServiceResult>
        pull: (repoPath: string, opts?: { rebase?: boolean }) => Promise<GitServiceResult>
        fetchWithProgress: (repoPath: string, remoteName?: string) => Promise<GitServiceResult>
        hasUpstream: (repoPath: string) => Promise<GitServiceResult>
        getCurrentBranch: (repoPath: string) => Promise<GitServiceResult>
        onOperationProgress: (
          callback: (progress: { operationId: string; operation: string; phase: string; percent: number | null; current: number | null; total: number | null }) => void
        ) => () => void
        mergePreview: (repoPath: string, branchName: string) => Promise<GitServiceResult>
        merge: (
          repoPath: string,
          branchName: string,
          opts?: { noFastForward?: boolean; fastForwardOnly?: boolean }
        ) => Promise<GitServiceResult>
        mergeAbort: (repoPath: string) => Promise<GitServiceResult>
        isMerging: (repoPath: string) => Promise<GitServiceResult>
        getConflictedFiles: (repoPath: string) => Promise<GitServiceResult>
        cherryPick: (repoPath: string, hashes: string[]) => Promise<GitServiceResult>
        cherryPickAbort: (repoPath: string) => Promise<GitServiceResult>
        cherryPickContinue: (repoPath: string) => Promise<GitServiceResult>
        isCherryPicking: (repoPath: string) => Promise<GitServiceResult>
        rebasePreview: (repoPath: string, ontoBranch: string) => Promise<GitServiceResult>
        rebase: (repoPath: string, ontoBranch: string) => Promise<GitServiceResult>
        rebaseInteractive: (
          repoPath: string,
          ontoBranch: string,
          actions: { hash: string; action: 'pick' | 'squash' | 'edit' | 'drop' | 'reword' | 'fixup' }[]
        ) => Promise<GitServiceResult>
        rebaseContinue: (repoPath: string) => Promise<GitServiceResult>
        rebaseAbort: (repoPath: string) => Promise<GitServiceResult>
        rebaseSkip: (repoPath: string) => Promise<GitServiceResult>
        isRebasing: (repoPath: string) => Promise<GitServiceResult>
        rebaseProgress: (repoPath: string) => Promise<GitServiceResult>
        reset: (
          repoPath: string,
          targetHash: string,
          mode: 'soft' | 'mixed' | 'hard'
        ) => Promise<GitServiceResult>
        revert: (
          repoPath: string,
          hash: string,
          opts?: { parentNumber?: number }
        ) => Promise<GitServiceResult>
        revertAbort: (repoPath: string) => Promise<GitServiceResult>
        revertContinue: (repoPath: string) => Promise<GitServiceResult>
        isReverting: (repoPath: string) => Promise<GitServiceResult>
        getConflictContent: (repoPath: string, filePath: string) => Promise<GitServiceResult>
        resolveConflictFile: (repoPath: string, filePath: string, content: string) => Promise<GitServiceResult>
        resolveConflictFileWith: (repoPath: string, filePath: string, choice: 'ours' | 'theirs') => Promise<GitServiceResult>
        getActiveOperation: (repoPath: string) => Promise<GitServiceResult>
        blame: (repoPath: string, filePath: string) => Promise<GitServiceResult>
        autoFetch: (repoPath: string) => Promise<GitServiceResult>
        discardFiles: (repoPath: string, filePaths: string[], opts?: { untracked?: boolean }) => Promise<GitServiceResult>
        discardHunk: (repoPath: string, patch: string) => Promise<GitServiceResult>
        fileLog: (repoPath: string, filePath: string, maxCount?: number) => Promise<GitServiceResult>
        getSubmodules: (repoPath: string) => Promise<GitServiceResult>
        submoduleInit: (repoPath: string, submodulePath: string) => Promise<GitServiceResult>
        submoduleUpdate: (repoPath: string, submodulePath: string) => Promise<GitServiceResult>
        getAvailableGpgKeys: () => Promise<GitServiceResult>
        getGitSigningKey: (repoPath: string) => Promise<GitServiceResult>
        setGitSigningKey: (repoPath: string, keyId: string) => Promise<GitServiceResult>
        clone: (url: string, destPath: string) => Promise<GitServiceResult>
        onCloneProgress: (
          callback: (progress: { operationId: string; phase: string; percent: number | null; current: number | null; total: number | null }) => void
        ) => () => void
      }
      file: {
        read: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>
        write: (filePath: string, content: string) => Promise<{ success: boolean; error?: string }>
      }
      watcher: {
        start: (repoPath: string) => Promise<{ success: boolean; error?: string }>
        stop: () => Promise<{ success: boolean }>
      }
      onRepoChanged: (callback: () => void) => () => void
      repos: {
        getRecent: () => Promise<RecentRepo[]>
        addRecent: (repoPath: string, repoName: string) => Promise<RecentRepo[]>
        removeRecent: (repoPath: string) => Promise<RecentRepo[]>
      }
      terminal: {
        create: (opts: { cwd?: string; id?: string }) => Promise<{ success: boolean; data?: { id: string }; error?: string }>
        write: (opts: { id: string; data: string }) => Promise<{ success: boolean; error?: string }>
        resize: (opts: { id: string; cols: number; rows: number }) => Promise<{ success: boolean; error?: string }>
        kill: (id: string) => Promise<{ success: boolean; error?: string }>
        setCwd: (opts: { id: string; cwd: string }) => Promise<{ success: boolean; error?: string }>
        onData: (callback: (payload: { id: string; data: string }) => void) => () => void
        onExit: (callback: (payload: { id: string; exitCode: number }) => void) => () => void
      }
    }
  }
}

export interface LayoutState {
  sidebarSize: number
  bottomPanelSize: number
  bottomPanelVisible: boolean
  sidebarVisible: boolean
  sidebarCollapsed: boolean
  rightPanelSize: number
}

const STORAGE_KEY = 'gitslop-layout-state'

const DEFAULT_LAYOUT: LayoutState = {
  sidebarSize: 20,
  bottomPanelSize: 25,
  bottomPanelVisible: false,
  sidebarVisible: true,
  sidebarCollapsed: false,
  rightPanelSize: 25
}

function loadLayout(): LayoutState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LayoutState>
      return { ...DEFAULT_LAYOUT, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_LAYOUT
}

function saveLayout(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

export function useLayoutState(): {
  layout: LayoutState
  setSidebarSize: (size: number) => void
  setBottomPanelSize: (size: number) => void
  setRightPanelSize: (size: number) => void
  toggleBottomPanel: () => void
  toggleSidebar: () => void
  toggleSidebarCollapse: () => void
  setSidebarCollapsed: (collapsed: boolean) => void
} {
  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveLayout(layout)
    }, 300)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [layout])

  const setSidebarSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, sidebarSize: size }))
  }, [])

  const setBottomPanelSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, bottomPanelSize: size }))
  }, [])

  const setRightPanelSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, rightPanelSize: size }))
  }, [])

  const toggleBottomPanel = useCallback(() => {
    setLayout((prev) => ({ ...prev, bottomPanelVisible: !prev.bottomPanelVisible }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setLayout((prev) => ({ ...prev, sidebarVisible: !prev.sidebarVisible }))
  }, [])

  const toggleSidebarCollapse = useCallback(() => {
    setLayout((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }))
  }, [])

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, sidebarCollapsed: collapsed }))
  }, [])

  return {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    setRightPanelSize,
    toggleBottomPanel,
    toggleSidebar,
    toggleSidebarCollapse,
    setSidebarCollapsed
  }
}
