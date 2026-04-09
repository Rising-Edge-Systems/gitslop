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
        about?: () => Promise<void>
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
        getBranchesContaining: (repoPath: string, hash: string) => Promise<GitServiceResult>
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
        showFileAtCommit: (repoPath: string, hash: string, filePath: string) => Promise<GitServiceResult>
        showFileAtParent: (repoPath: string, hash: string, filePath: string) => Promise<GitServiceResult>
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
      profiles: {
        list: () => Promise<{ id: string; name: string; authorName: string; authorEmail: string; isDefault: boolean }[]>
        getActive: () => Promise<string>
        create: (profile: { name: string; authorName: string; authorEmail: string; isDefault: boolean }) => Promise<{ id: string; name: string; authorName: string; authorEmail: string; isDefault: boolean }>
        update: (id: string, updates: Partial<{ name: string; authorName: string; authorEmail: string; isDefault: boolean }>) => Promise<GitServiceResult>
        delete: (id: string) => Promise<{ id: string; name: string; authorName: string; authorEmail: string; isDefault: boolean }[]>
        setActive: (id: string) => Promise<GitServiceResult>
        apply: (id: string, repoPath: string) => Promise<GitServiceResult>
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
      onCliOpenRepo?: (callback: (repoPath: string) => void) => () => void
      menu: {
        onOpenRepository: (callback: (repoPath: string) => void) => () => void
        onCloneRepository: (callback: () => void) => () => void
        onInitRepository: (callback: () => void) => () => void
        onCloseTab: (callback: () => void) => () => void
        onSettings: (callback: () => void) => () => void
        onToggleSidebar: (callback: () => void) => () => void
        onToggleTerminal: (callback: () => void) => () => void
        onKeyboardShortcuts: (callback: () => void) => () => void
        onToggleBranchLabels: (callback: () => void) => () => void
      }
    }
  }
}

export type DiffViewMode = 'inline' | 'side-by-side' | 'full' | 'file'
export type FileListView = 'path' | 'tree'
export type RightPanelPosition = 'right' | 'bottom'

export interface LayoutState {
  sidebarSize: number
  bottomPanelSize: number  // now stored as pixels (terminal height), default 200
  bottomPanelVisible: boolean
  sidebarVisible: boolean
  sidebarCollapsed: boolean
  rightPanelSize: number
  stagingCollapsed: boolean
  detailPanelCollapsed: boolean
  diffViewMode: DiffViewMode
  detailStagingSplit: number // 0-100, percent for detail share
  fileListView: FileListView
  stagingInternalSplit: number // 0-100, percent for file list share (top) vs commit form (bottom)
  detailInternalSplit: number // 0-100, percent for metadata share (top) vs files (bottom)
  rightPanelPosition: RightPanelPosition
  showBranchLabels: boolean
}

const STORAGE_KEY = 'gitslop-layout-state'

const DEFAULT_LAYOUT: LayoutState = {
  sidebarSize: 260,
  bottomPanelSize: 200,
  bottomPanelVisible: false,
  sidebarVisible: true,
  sidebarCollapsed: false,
  rightPanelSize: 340,
  stagingCollapsed: false,
  detailPanelCollapsed: false,
  diffViewMode: 'inline',
  detailStagingSplit: 60,
  fileListView: 'path',
  stagingInternalSplit: 65,
  detailInternalSplit: 40,
  rightPanelPosition: 'right',
  showBranchLabels: true
}

// Sidebar pixel bounds
const MIN_SIDEBAR_SIZE = 180
const MAX_SIDEBAR_SIZE = 400
const MIN_RIGHT_PANEL_SIZE = 280
const MAX_RIGHT_PANEL_SIZE = 600
const DEFAULT_RIGHT_PANEL_SIZE = 340
const MIN_BOTTOM_PANEL_SIZE = 10

function loadLayout(): LayoutState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LayoutState>
      const layout = { ...DEFAULT_LAYOUT, ...parsed }

      // Migrate old percentage-based sidebarSize (< 100) to pixel width
      if (layout.sidebarSize < 100) layout.sidebarSize = DEFAULT_LAYOUT.sidebarSize
      // Clamp sidebar to valid pixel range
      if (layout.sidebarSize < MIN_SIDEBAR_SIZE) layout.sidebarSize = MIN_SIDEBAR_SIZE
      if (layout.sidebarSize > MAX_SIDEBAR_SIZE) layout.sidebarSize = MAX_SIDEBAR_SIZE
      // Migrate old percentage-based rightPanelSize (< 100) to pixel width
      if (layout.rightPanelSize < 100) layout.rightPanelSize = DEFAULT_RIGHT_PANEL_SIZE
      // Clamp right panel to valid pixel range
      if (layout.rightPanelSize < MIN_RIGHT_PANEL_SIZE) layout.rightPanelSize = MIN_RIGHT_PANEL_SIZE
      if (layout.rightPanelSize > MAX_RIGHT_PANEL_SIZE) layout.rightPanelSize = MAX_RIGHT_PANEL_SIZE
      if (layout.bottomPanelSize < MIN_BOTTOM_PANEL_SIZE) layout.bottomPanelSize = DEFAULT_LAYOUT.bottomPanelSize
      // Clamp detailStagingSplit to valid range
      if (layout.detailStagingSplit == null || layout.detailStagingSplit < 10) layout.detailStagingSplit = DEFAULT_LAYOUT.detailStagingSplit
      if (layout.detailStagingSplit > 90) layout.detailStagingSplit = 90
      // Clamp stagingInternalSplit to valid range
      if (layout.stagingInternalSplit == null || layout.stagingInternalSplit < 20) layout.stagingInternalSplit = DEFAULT_LAYOUT.stagingInternalSplit
      if (layout.stagingInternalSplit > 90) layout.stagingInternalSplit = 90
      // Clamp detailInternalSplit to valid range
      if (layout.detailInternalSplit == null || layout.detailInternalSplit < 15) layout.detailInternalSplit = DEFAULT_LAYOUT.detailInternalSplit
      if (layout.detailInternalSplit > 85) layout.detailInternalSplit = 85
      // Migrate old percentage-based bottomPanelSize to pixels
      if (layout.bottomPanelSize < 100) layout.bottomPanelSize = DEFAULT_LAYOUT.bottomPanelSize
      // Clamp terminal height
      if (layout.bottomPanelSize < 100) layout.bottomPanelSize = 100
      if (layout.bottomPanelSize > 500) layout.bottomPanelSize = 500
      // Validate rightPanelPosition
      if (layout.rightPanelPosition !== 'right' && layout.rightPanelPosition !== 'bottom') {
        layout.rightPanelPosition = DEFAULT_LAYOUT.rightPanelPosition
      }

      return layout
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
  setStagingCollapsed: (collapsed: boolean) => void
  toggleStagingCollapse: () => void
  setDetailPanelCollapsed: (collapsed: boolean) => void
  toggleDetailPanelCollapse: () => void
  setDiffViewMode: (mode: DiffViewMode) => void
  setDetailStagingSplit: (split: number) => void
  setFileListView: (view: FileListView) => void
  setStagingInternalSplit: (split: number) => void
  setDetailInternalSplit: (split: number) => void
  setRightPanelPosition: (position: RightPanelPosition) => void
  toggleRightPanelPosition: () => void
  setShowBranchLabels: (show: boolean) => void
  toggleShowBranchLabels: () => void
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
    const clamped = Math.max(MIN_SIDEBAR_SIZE, Math.min(MAX_SIDEBAR_SIZE, Math.round(size)))
    setLayout((prev) => ({ ...prev, sidebarSize: clamped }))
  }, [])

  const setBottomPanelSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, bottomPanelSize: size }))
  }, [])

  const setRightPanelSize = useCallback((size: number) => {
    const clamped = Math.max(MIN_RIGHT_PANEL_SIZE, Math.min(MAX_RIGHT_PANEL_SIZE, Math.round(size)))
    setLayout((prev) => ({ ...prev, rightPanelSize: clamped }))
  }, [])

  const toggleBottomPanel = useCallback(() => {
    setLayout((prev) => ({ ...prev, bottomPanelVisible: !prev.bottomPanelVisible }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setLayout((prev) => {
      if (!prev.sidebarVisible) {
        // Sidebar hidden → show expanded
        return { ...prev, sidebarVisible: true, sidebarCollapsed: false }
      }
      if (prev.sidebarCollapsed) {
        // Icon rail visible → expand to full sidebar
        return { ...prev, sidebarCollapsed: false }
      }
      // Full sidebar visible → collapse to icon rail
      return { ...prev, sidebarCollapsed: true }
    })
  }, [])

  const toggleSidebarCollapse = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      sidebarCollapsed: !prev.sidebarCollapsed,
      // Ensure sidebar is visible when toggling collapse
      sidebarVisible: true
    }))
  }, [])

  const setSidebarCollapsed = useCallback((collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, sidebarCollapsed: collapsed, sidebarVisible: true }))
  }, [])

  const setStagingCollapsed = useCallback((collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, stagingCollapsed: collapsed }))
  }, [])

  const toggleStagingCollapse = useCallback(() => {
    setLayout((prev) => ({ ...prev, stagingCollapsed: !prev.stagingCollapsed }))
  }, [])

  const setDetailPanelCollapsed = useCallback((collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, detailPanelCollapsed: collapsed }))
  }, [])

  const toggleDetailPanelCollapse = useCallback(() => {
    setLayout((prev) => ({ ...prev, detailPanelCollapsed: !prev.detailPanelCollapsed }))
  }, [])

  const setDiffViewMode = useCallback((mode: DiffViewMode) => {
    setLayout((prev) => ({ ...prev, diffViewMode: mode }))
  }, [])

  const setDetailStagingSplit = useCallback((split: number) => {
    const clamped = Math.max(10, Math.min(90, Math.round(split)))
    setLayout((prev) => ({ ...prev, detailStagingSplit: clamped }))
  }, [])

  const setFileListView = useCallback((view: FileListView) => {
    setLayout((prev) => ({ ...prev, fileListView: view }))
  }, [])

  const setStagingInternalSplit = useCallback((split: number) => {
    const clamped = Math.max(20, Math.min(90, Math.round(split)))
    setLayout((prev) => ({ ...prev, stagingInternalSplit: clamped }))
  }, [])

  const setDetailInternalSplit = useCallback((split: number) => {
    const clamped = Math.max(15, Math.min(85, Math.round(split)))
    setLayout((prev) => ({ ...prev, detailInternalSplit: clamped }))
  }, [])

  const setRightPanelPosition = useCallback((position: RightPanelPosition) => {
    setLayout((prev) => ({ ...prev, rightPanelPosition: position }))
  }, [])

  const toggleRightPanelPosition = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      rightPanelPosition: prev.rightPanelPosition === 'right' ? 'bottom' : 'right'
    }))
  }, [])

  const setShowBranchLabels = useCallback((show: boolean) => {
    setLayout((prev) => ({ ...prev, showBranchLabels: show }))
  }, [])

  const toggleShowBranchLabels = useCallback(() => {
    setLayout((prev) => ({ ...prev, showBranchLabels: !prev.showBranchLabels }))
  }, [])

  return {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    setRightPanelSize,
    toggleBottomPanel,
    toggleSidebar,
    toggleSidebarCollapse,
    setSidebarCollapsed,
    setStagingCollapsed,
    toggleStagingCollapse,
    setDetailPanelCollapsed,
    toggleDetailPanelCollapse,
    setDiffViewMode,
    setDetailStagingSplit,
    setFileListView,
    setStagingInternalSplit,
    setDetailInternalSplit,
    setRightPanelPosition,
    toggleRightPanelPosition,
    setShowBranchLabels,
    toggleShowBranchLabels
  }
}
