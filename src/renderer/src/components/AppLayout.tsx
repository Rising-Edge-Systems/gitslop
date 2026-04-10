import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, PanelRight, PanelBottom } from 'lucide-react'
import { useWindowWidth } from '../hooks/useWindowWidth'
// react-resizable-panels fully removed — all panels use plain CSS flex divs with drag handles
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { MainContent } from './MainContent'
import { DetailPanel } from './DetailPanel'
import { StatusPanel } from './StatusPanel'
import { TerminalPanel } from './Terminal'
import { SearchPalette } from './SearchPalette'
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel'
import { StatusBar } from './StatusBar'
import { NotificationToast } from './NotificationToast'
import { useAutoFetch } from '../hooks/useAutoFetch'
import { useLayoutState } from '../hooks/useLayoutState'
import { useNotifications } from '../hooks/useNotifications'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'
import type { CommitDetail, CommitFileDetail } from './CommitGraph'
import type { TabPerTabState } from '../hooks/useRepoTabs'

interface AppLayoutProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
  onOpenSettings: () => void
  settings: { sidebarPosition: 'left' | 'right'; autoFetchInterval: number; commitHistoryDepth: number }
  getTabState: (repoPath: string) => TabPerTabState
  saveTabState: (repoPath: string, state: Partial<TabPerTabState>) => void
}

export function AppLayout({ currentRepo, onRepoOpen, onCloseRepo, onOpenSettings, settings: appSettings, getTabState, saveTabState }: AppLayoutProps): React.JSX.Element {
  const {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    toggleBottomPanel,
    toggleSidebar,
    toggleSidebarCollapse,
    setSidebarCollapsed,
    setRightPanelSize,
    toggleStagingCollapse,
    setDetailPanelCollapsed,
    toggleDetailPanelCollapse,
    setDiffViewMode,
    setDetailStagingSplit,
    setFileListView,
    setStagingInternalSplit,
    setDetailInternalSplit,
    toggleRightPanelPosition,
    toggleShowBranchLabels
  } = useLayoutState()

  const {
    notifications,
    history,
    addNotification,
    dismissNotification,
    clearHistory,
    historyOpen,
    setHistoryOpen
  } = useNotifications()

  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [selectedCommit, setSelectedCommit] = useState<CommitDetail | null>(null)
  const [repoSwitching, setRepoSwitching] = useState(false)

  // ─── Center-Stage Diff View State ──────────────────────────────────────────
  const [viewingDiff, setViewingDiff] = useState(false)
  const [diffFile, setDiffFile] = useState<string | null>(null)
  const [diffCommitHash, setDiffCommitHash] = useState<string | null>(null)
  // Working-tree file selected in StatusPanel — routes to the main center diff viewer
  const [workingTreeFile, setWorkingTreeFile] = useState<{ path: string; staged: boolean; isUntracked: boolean } | null>(null)

  // ─── Per-Tab State Isolation ──────────────────────────────────────────────────
  // Track the previously active repo so we can save its state before switching.
  const prevRepoRef = useRef<string | null>(null)

  // Save current tab state and restore new tab state when currentRepo changes
  useEffect(() => {
    const prevRepo = prevRepoRef.current

    // Save state of previous tab
    if (prevRepo && prevRepo !== currentRepo) {
      saveTabState(prevRepo, {
        selectedCommitHash: selectedCommit?.commit?.hash ?? null,
        sidebarCollapsed: layout.sidebarCollapsed,
        detailPanelOpen: selectedCommit !== null,
        graphScrollOffset: 0 // CommitGraph manages its own scroll internally
      })
    }

    // Restore state for new tab
    if (currentRepo && currentRepo !== prevRepo && prevRepo !== null) {
      setRepoSwitching(true)
      const restored = getTabState(currentRepo)
      setSidebarCollapsed(restored.sidebarCollapsed)
      // Clear selected commit — it will be re-selected by the commit graph if the hash matches.
      // We can't restore the full CommitDetail object (it's not persisted), so we clear it.
      // The detail panel open/closed state is derived from selectedCommit being non-null.
      setSelectedCommit(null)
      // Clear diff state when switching tabs
      setViewingDiff(false)
      setDiffFile(null)
      setDiffCommitHash(null)
      setWorkingTreeFile(null)
    }

    prevRepoRef.current = currentRepo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo])

  // Responsive breakpoints
  const SIDEBAR_COLLAPSE_BREAKPOINT = 900
  const windowWidth = useWindowWidth()

  // Auto-collapse sidebar to icon rail on narrow windows.
  // Only trigger on window-width threshold crossing — not on sidebar state changes —
  // so that manual user toggles are never overridden.
  const autoCollapsedRef = useRef(false)
  const prevWidthNarrowRef = useRef(windowWidth < SIDEBAR_COLLAPSE_BREAKPOINT)

  useEffect(() => {
    const isNarrow = windowWidth < SIDEBAR_COLLAPSE_BREAKPOINT
    const wasNarrow = prevWidthNarrowRef.current
    prevWidthNarrowRef.current = isNarrow

    if (isNarrow && !wasNarrow) {
      // Just crossed below threshold — auto-collapse
      autoCollapsedRef.current = true
      setSidebarCollapsed(true)
    } else if (!isNarrow && wasNarrow) {
      // Just crossed above threshold — restore if we auto-collapsed
      if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false
        setSidebarCollapsed(false)
      }
    }
  }, [windowWidth, setSidebarCollapsed])

  // Menu bar IPC → DOM event listeners for sidebar/terminal toggles and keyboard shortcuts
  useEffect(() => {
    const handleToggleSidebarMenu = (): void => { toggleSidebar() }
    const handleToggleTerminalMenu = (): void => { toggleBottomPanel() }
    const handleKeyboardShortcutsMenu = (): void => {
      setTimeout(() => setShortcutsOpen(true), 0)
    }
    const handleToggleBranchLabelsMenu = (): void => { toggleShowBranchLabels() }

    window.addEventListener('menu:toggle-sidebar', handleToggleSidebarMenu)
    window.addEventListener('menu:toggle-terminal', handleToggleTerminalMenu)
    window.addEventListener('menu:keyboard-shortcuts', handleKeyboardShortcutsMenu)
    window.addEventListener('menu:toggle-branch-labels', handleToggleBranchLabelsMenu)
    return () => {
      window.removeEventListener('menu:toggle-sidebar', handleToggleSidebarMenu)
      window.removeEventListener('menu:toggle-terminal', handleToggleTerminalMenu)
      window.removeEventListener('menu:keyboard-shortcuts', handleKeyboardShortcutsMenu)
      window.removeEventListener('menu:toggle-branch-labels', handleToggleBranchLabelsMenu)
    }
  }, [toggleSidebar, toggleBottomPanel, toggleShowBranchLabels])

  // Auto-fetch: fetches on configurable interval, tracks incoming changes
  const { incomingChanges, lastFetchTime, fetching: autoFetching, manualRefresh } = useAutoFetch({
    repoPath: currentRepo,
    intervalMinutes: appSettings.autoFetchInterval,
    onNotify: addNotification
  })

  // handleBottomResize removed — terminal uses plain CSS div now

  // handleRightPanelResize removed — detail panel is now a plain CSS div, not a react-resizable-panels Panel

  const handleRepoLoaded = useCallback(() => {
    setRepoSwitching(false)
  }, [])

  const handleCommitSelect = useCallback((detail: CommitDetail | null) => {
    setSelectedCommit(detail)
    if (currentRepo) {
      saveTabState(currentRepo, {
        selectedCommitHash: detail?.commit?.hash ?? null,
        detailPanelOpen: detail !== null
      })
    }
  }, [currentRepo, saveTabState])

  const handleCloseDetailPanel = useCallback(() => {
    setSelectedCommit(null)
    setViewingDiff(false)
    setDiffFile(null)
    setDiffCommitHash(null)
    if (currentRepo) {
      saveTabState(currentRepo, {
        selectedCommitHash: null,
        detailPanelOpen: false
      })
    }
  }, [currentRepo, saveTabState])

  // ─── Center-Stage Diff Handlers ────────────────────────────────────────────
  const handleFileClick = useCallback((file: CommitFileDetail, commitHash: string) => {
    // Clicking a commit file clears any working-tree selection — the two views
    // are mutually exclusive in the center pane.
    setWorkingTreeFile(null)
    setDiffFile(file.path)
    setDiffCommitHash(commitHash)
    setViewingDiff(true)
  }, [])

  const handleWorkingTreeFileSelect = useCallback(
    (sel: { path: string; staged: boolean; isUntracked: boolean } | null) => {
      if (sel) {
        // Route to the main center diff viewer — clear any commit-file diff state.
        setViewingDiff(false)
        setDiffFile(null)
        setDiffCommitHash(null)
      }
      setWorkingTreeFile(sel)
    },
    []
  )

  const handleBackToGraph = useCallback(() => {
    setViewingDiff(false)
    setDiffFile(null)
    setDiffCommitHash(null)
  }, [])

  const handleNavigateFile = useCallback((direction: 'prev' | 'next') => {
    if (!selectedCommit || !diffFile) return
    const files = selectedCommit.fileDetails
    const currentIdx = files.findIndex(f => f.path === diffFile)
    if (currentIdx === -1) return
    const newIdx = direction === 'next'
      ? (currentIdx + 1) % files.length
      : (currentIdx - 1 + files.length) % files.length
    setDiffFile(files[newIdx].path)
  }, [selectedCommit, diffFile])

  // Terminal double-click-to-reset removed — handled inline in drag handle

  // ─── Sidebar Drag Handle ──────────────────────────────────────────────────
  const DEFAULT_SIDEBAR_WIDTH = 260
  const isDraggingRef = useRef(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartXRef = useRef(0)
  const dragStartWidthRef = useRef(0)

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRef.current = true
      setIsDragging(true)
      dragStartXRef.current = e.clientX
      dragStartWidthRef.current = layout.sidebarSize
      document.body.classList.add('sidebar-dragging')

      const isRight = appSettings.sidebarPosition === 'right'

      const onMouseMove = (ev: MouseEvent): void => {
        if (!isDraggingRef.current) return
        const delta = ev.clientX - dragStartXRef.current
        const newWidth = isRight
          ? dragStartWidthRef.current - delta
          : dragStartWidthRef.current + delta
        // Clamp 180-400
        const clamped = Math.max(180, Math.min(400, newWidth))
        setSidebarSize(clamped)
      }

      const onMouseUp = (): void => {
        isDraggingRef.current = false
        setIsDragging(false)
        document.body.classList.remove('sidebar-dragging')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [layout.sidebarSize, appSettings.sidebarPosition, setSidebarSize]
  )

  const handleDragHandleDoubleClick = useCallback(() => {
    setSidebarSize(DEFAULT_SIDEBAR_WIDTH)
  }, [setSidebarSize])

  // ─── Right Panel Drag Handle ──────────────────────────────────────────────
  const DEFAULT_RIGHT_PANEL_WIDTH = 340
  const isDraggingRightRef = useRef(false)
  const [isDraggingRight, setIsDraggingRight] = useState(false)
  const dragStartXRightRef = useRef(0)
  const dragStartWidthRightRef = useRef(0)

  const handleRightDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingRightRef.current = true
      setIsDraggingRight(true)
      dragStartXRightRef.current = e.clientX
      dragStartWidthRightRef.current = layout.rightPanelSize
      document.body.classList.add('sidebar-dragging')

      const onMouseMove = (ev: MouseEvent): void => {
        if (!isDraggingRightRef.current) return
        const delta = ev.clientX - dragStartXRightRef.current
        // Dragging LEFT makes the right panel wider
        const newWidth = dragStartWidthRightRef.current - delta
        setRightPanelSize(newWidth)
      }

      const onMouseUp = (): void => {
        isDraggingRightRef.current = false
        setIsDraggingRight(false)
        document.body.classList.remove('sidebar-dragging')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [layout.rightPanelSize, setRightPanelSize]
  )

  const handleRightDragHandleDoubleClick = useCallback(() => {
    setRightPanelSize(DEFAULT_RIGHT_PANEL_WIDTH)
  }, [setRightPanelSize])

  // ─── Detail/Staging Vertical Split Drag Handle ────────────────────────────
  const isDraggingDetailSplitRef = useRef(false)
  const [isDraggingDetailSplit, setIsDraggingDetailSplit] = useState(false)
  const dragStartYDetailRef = useRef(0)
  const dragStartSplitRef = useRef(0)
  const rightPanelContainerRef = useRef<HTMLDivElement>(null)
  const columnsContentRef = useRef<HTMLDivElement>(null)

  const handleDetailSplitDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      isDraggingDetailSplitRef.current = true
      setIsDraggingDetailSplit(true)
      dragStartYDetailRef.current = e.clientY
      dragStartSplitRef.current = layout.detailStagingSplit
      document.body.classList.add('sidebar-dragging')

      const onMouseMove = (ev: MouseEvent): void => {
        if (!isDraggingDetailSplitRef.current) return
        // In bottom mode, use the full columns container; in right mode, use the right panel container
        const container = layout.rightPanelPosition === 'bottom'
          ? columnsContentRef.current
          : rightPanelContainerRef.current
        if (!container) return
        const containerHeight = container.clientHeight
        if (containerHeight === 0) return
        const delta = ev.clientY - dragStartYDetailRef.current
        const deltaPercent = (delta / containerHeight) * 100
        const newSplit = dragStartSplitRef.current + deltaPercent
        setDetailStagingSplit(newSplit)
      }

      const onMouseUp = (): void => {
        isDraggingDetailSplitRef.current = false
        setIsDraggingDetailSplit(false)
        document.body.classList.remove('sidebar-dragging')
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [layout.detailStagingSplit, layout.rightPanelPosition, setDetailStagingSplit]
  )

  const handleDetailSplitDoubleClick = useCallback(() => {
    setDetailStagingSplit(60)
  }, [setDetailStagingSplit])

  const sidebarExpanded = layout.sidebarVisible && !layout.sidebarCollapsed

  const dragHandle = sidebarExpanded ? (
    <div
      className="sidebar-drag-handle"
      onMouseDown={handleDragStart}
      onDoubleClick={handleDragHandleDoubleClick}
    />
  ) : null

  // Stable handler refs for shortcuts
  const handleToggleSidebar = useShortcutHandler(toggleSidebar)
  const handleToggleTerminal = useShortcutHandler(toggleBottomPanel)
  const handleOpenSearch = useShortcutHandler(() => {
    if (currentRepo) setSearchOpen(true)
  })
  const handleOpenShortcuts = useShortcutHandler(() => setShortcutsOpen(true))

  // Register navigation/view shortcuts centrally
  const shortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'toggle-sidebar',
        'Toggle Sidebar',
        'View',
        'Ctrl+B',
        { ctrl: true, key: 'b' },
        handleToggleSidebar
      ),
      defineShortcut(
        'toggle-terminal',
        'Toggle Terminal',
        'View',
        'Ctrl+`',
        { ctrl: true, key: '`' },
        handleToggleTerminal
      ),
      defineShortcut(
        'open-search',
        'Search (Command Palette)',
        'Navigation',
        'Ctrl+K',
        { ctrl: true, key: 'k' },
        handleOpenSearch
      ),
      defineShortcut(
        'show-shortcuts',
        'Show Keyboard Shortcuts',
        'General',
        'Ctrl+?',
        { ctrl: true, key: '?' },
        handleOpenShortcuts
      )
    ],
    [handleToggleSidebar, handleToggleTerminal, handleOpenSearch, handleOpenShortcuts]
  )

  useKeyboardShortcuts(shortcuts)

  const handleToggleHistory = useCallback(() => {
    setHistoryOpen(!historyOpen)
  }, [historyOpen, setHistoryOpen])

  return (
    <div className="app-layout">
      <Toolbar
        currentRepo={currentRepo}
        onRepoOpen={onRepoOpen}
        onOpenSettings={onOpenSettings}
        onNotify={addNotification}
      />

      {/* Toast notifications */}
      <NotificationToast
        notifications={notifications}
        onDismiss={dismissNotification}
      />

      {/* Search Palette (Ctrl+K) */}
      {searchOpen && currentRepo && (
        <SearchPalette
          currentRepo={currentRepo}
          onClose={() => setSearchOpen(false)}
          onSelectCommit={(_hash) => {
            // TODO: scroll graph to commit — will be wired once graph exposes scroll API
          }}
          onSelectFile={(_filePath) => {
            // TODO: open file in editor — will be wired once editor supports programmatic open
          }}
          onCheckoutBranch={() => {
            // Branch was checked out — status will auto-refresh via file watcher
          }}
        />
      )}

      {/* Keyboard Shortcuts Panel (Ctrl+?) */}
      {shortcutsOpen && (
        <KeyboardShortcutsPanel onClose={() => setShortcutsOpen(false)} />
      )}

      <div className="app-body" style={{ position: 'relative' }}>
        {/* Repo switching overlay */}
        {repoSwitching && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            animation: 'fadeIn 0.15s ease'
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '12px',
              color: 'var(--text-secondary)'
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 0.8s linear infinite' }}>
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              <span style={{ fontSize: '13px', fontWeight: 500 }}>Loading repository...</span>
            </div>
          </div>
        )}
        {/* Sidebar — plain div outside react-resizable-panels, sized in pixels */}
        {layout.sidebarVisible && appSettings.sidebarPosition === 'left' && (
          <div style={{
            width: layout.sidebarCollapsed ? 48 : layout.sidebarSize,
            flexShrink: 0,
            height: '100%',
            overflow: layout.sidebarCollapsed ? 'visible' : 'hidden',
            position: 'relative',
            zIndex: layout.sidebarCollapsed ? 20 : undefined,
            borderRight: '1px solid var(--border)',
            transition: isDragging ? 'none' : 'width 200ms ease-out'
          }}>
            <Sidebar currentRepo={currentRepo} collapsed={layout.sidebarCollapsed} onToggleCollapse={toggleSidebarCollapse} />
          </div>
        )}
        {appSettings.sidebarPosition === 'left' && dragHandle}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div ref={columnsContentRef} style={{ display: 'flex', flexDirection: layout.rightPanelPosition === 'bottom' ? 'column' : 'row', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              {/* Top row: center panel + right panel (when position is 'right') */}
              <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {/* Center panel — takes remaining space */}
                <div style={{ flex: 1, minWidth: 0, height: '100%', overflow: 'hidden' }}>
                  <MainContent
                    currentRepo={currentRepo}
                    onRepoOpen={onRepoOpen}
                    onCommitSelect={handleCommitSelect}
                    onRepoLoaded={handleRepoLoaded}
                    viewingDiff={viewingDiff}
                    diffFile={diffFile}
                    diffCommitHash={diffCommitHash}
                    selectedCommit={selectedCommit}
                    onBackToGraph={handleBackToGraph}
                    onNavigateFile={handleNavigateFile}
                    diffViewMode={layout.diffViewMode}
                    onDiffViewModeChange={setDiffViewMode}
                    showBranchLabels={layout.showBranchLabels}
                    commitHistoryDepth={appSettings.commitHistoryDepth}
                    workingTreeFile={workingTreeFile}
                    onCloseWorkingTreeFile={() => setWorkingTreeFile(null)}
                  />
                </div>
                {/* Right panel drag handle + commit details on top, staging area below.
                    Only shown when position is 'right'. */}
                {currentRepo && layout.rightPanelPosition === 'right' && (
                  <div
                    className="sidebar-drag-handle"
                    style={{ cursor: 'col-resize' }}
                    onMouseDown={handleRightDragStart}
                    onDoubleClick={handleRightDragHandleDoubleClick}
                  />
                )}
                {currentRepo && layout.rightPanelPosition === 'right' && (
                  <div
                    ref={rightPanelContainerRef}
                    style={{
                      width: layout.rightPanelSize,
                      flexShrink: 0,
                      height: '100%',
                      overflow: 'hidden',
                      borderLeft: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      transition: isDraggingRight ? 'none' : undefined
                    }}
                  >
                    {/* Position toggle button */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      padding: '2px 4px',
                      borderBottom: '1px solid var(--border)',
                      flexShrink: 0
                    }}>
                      <button
                        onClick={toggleRightPanelPosition}
                        title="Move panel to bottom"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '3px',
                          borderRadius: 'var(--radius-sm)',
                          transition: 'background-color var(--transition-fast), color var(--transition-fast)'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
                      >
                        <PanelBottom size={14} />
                      </button>
                    </div>
                    {/* Detail panel — takes all space when staging collapsed, shrinks when detail collapsed */}
                    <div style={{
                      height: layout.detailPanelCollapsed
                        ? 'auto'
                        : layout.stagingCollapsed
                          ? '100%'
                          : `calc(${layout.detailStagingSplit}% - 2px)`,
                      minHeight: layout.detailPanelCollapsed ? undefined : 100,
                      flex: layout.detailPanelCollapsed ? '0 0 auto' : (layout.stagingCollapsed ? '1 1 auto' : undefined),
                      overflow: 'hidden',
                      transition: isDraggingDetailSplit ? 'none' : undefined
                    }}>
                      <DetailPanel
                        detail={selectedCommit}
                        repoPath={currentRepo}
                        onFileClick={handleFileClick}
                        selectedFilePath={viewingDiff ? diffFile : null}
                        fileListView={layout.fileListView}
                        onFileListViewChange={setFileListView}
                        detailInternalSplit={layout.detailInternalSplit}
                        onDetailInternalSplitChange={setDetailInternalSplit}
                        collapsed={layout.detailPanelCollapsed}
                        onToggleCollapse={toggleDetailPanelCollapse}
                      />
                    </div>
                    {/* Drag handle — only show when both panels are expanded */}
                    {!layout.stagingCollapsed && !layout.detailPanelCollapsed && (
                      <div
                        style={{
                          height: 5,
                          flexShrink: 0,
                          cursor: 'row-resize',
                          background: isDraggingDetailSplit ? 'var(--border)' : 'transparent',
                          borderTop: '1px solid var(--border)',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseDown={handleDetailSplitDragStart}
                        onDoubleClick={handleDetailSplitDoubleClick}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
                        onMouseLeave={(e) => { if (!isDraggingDetailSplit) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                      />
                    )}
                    {/* Staging panel — takes all space when detail collapsed, shrinks when staging collapsed */}
                    <div style={{
                      height: layout.stagingCollapsed
                        ? 'auto'
                        : layout.detailPanelCollapsed
                          ? '100%'
                          : `calc(${100 - layout.detailStagingSplit}% - 3px)`,
                      minHeight: layout.stagingCollapsed ? undefined : 100,
                      flex: layout.stagingCollapsed ? '0 0 auto' : (layout.detailPanelCollapsed ? '1 1 auto' : undefined),
                      overflow: 'hidden',
                      transition: isDraggingDetailSplit ? 'none' : undefined
                    }}>
                      <StatusPanel
                        repoPath={currentRepo}
                        collapsed={layout.stagingCollapsed}
                        onToggleCollapse={toggleStagingCollapse}
                        stagingInternalSplit={layout.stagingInternalSplit}
                        onStagingInternalSplitChange={setStagingInternalSplit}
                        onFileSelect={handleWorkingTreeFileSelect}
                        externallySelectedFile={workingTreeFile}
                      />
                    </div>
                  </div>
                )}
              </div>
              {/* Bottom panel strip: detail + staging side-by-side (when position is 'bottom') */}
              {currentRepo && layout.rightPanelPosition === 'bottom' && (
                <>
                  <div
                    style={{
                      height: 5,
                      flexShrink: 0,
                      cursor: 'row-resize',
                      background: isDraggingDetailSplit ? 'var(--border)' : 'transparent',
                      borderTop: '1px solid var(--border)',
                      transition: 'background 0.15s ease'
                    }}
                    onMouseDown={handleDetailSplitDragStart}
                    onDoubleClick={handleDetailSplitDoubleClick}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
                    onMouseLeave={(e) => { if (!isDraggingDetailSplit) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                  />
                  <div
                    ref={rightPanelContainerRef}
                    style={{
                      height: `calc(${100 - layout.detailStagingSplit}% - 5px)`,
                      minHeight: 120,
                      flexShrink: 0,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'row',
                      transition: isDraggingDetailSplit ? 'none' : undefined
                    }}
                  >
                    {/* Position toggle button */}
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      padding: '4px 2px',
                      borderRight: '1px solid var(--border)',
                      flexShrink: 0
                    }}>
                      <button
                        onClick={toggleRightPanelPosition}
                        title="Move panel to right"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: '3px',
                          borderRadius: 'var(--radius-sm)',
                          transition: 'background-color var(--transition-fast), color var(--transition-fast)'
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)' }}
                      >
                        <PanelRight size={14} />
                      </button>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <DetailPanel
                        detail={selectedCommit}
                        repoPath={currentRepo}
                        onFileClick={handleFileClick}
                        selectedFilePath={viewingDiff ? diffFile : null}
                        fileListView={layout.fileListView}
                        onFileListViewChange={setFileListView}
                        detailInternalSplit={layout.detailInternalSplit}
                        onDetailInternalSplitChange={setDetailInternalSplit}
                      />
                    </div>
                    <div style={{
                      width: 1,
                      flexShrink: 0,
                      background: 'var(--border)'
                    }} />
                    <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                      <StatusPanel
                        repoPath={currentRepo}
                        collapsed={layout.stagingCollapsed}
                        onToggleCollapse={toggleStagingCollapse}
                        stagingInternalSplit={layout.stagingInternalSplit}
                        onStagingInternalSplitChange={setStagingInternalSplit}
                        onFileSelect={handleWorkingTreeFileSelect}
                        externallySelectedFile={workingTreeFile}
                      />
                    </div>
                  </div>
                </>
              )}
            </div>
        {/* Terminal panel — plain CSS div with drag handle, inside the vertical flex column */}
        {layout.bottomPanelVisible && (
          <>
            <div
              style={{
                height: 5,
                flexShrink: 0,
                cursor: 'row-resize',
                background: 'transparent',
                borderTop: '1px solid var(--border)',
                transition: 'background 0.15s ease'
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                const startY = e.clientY
                const startHeight = layout.bottomPanelSize
                document.body.classList.add('sidebar-dragging')
                const onMove = (ev: MouseEvent): void => {
                  const delta = startY - ev.clientY
                  const newHeight = Math.max(100, Math.min(500, startHeight + delta))
                  setBottomPanelSize(newHeight)
                }
                const onUp = (): void => {
                  document.body.classList.remove('sidebar-dragging')
                  document.removeEventListener('mousemove', onMove)
                  document.removeEventListener('mouseup', onUp)
                }
                document.addEventListener('mousemove', onMove)
                document.addEventListener('mouseup', onUp)
              }}
              onDoubleClick={() => setBottomPanelSize(200)}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
            />
            <div style={{
              height: layout.bottomPanelSize,
              flexShrink: 0,
              overflow: 'hidden'
            }}>
              <TerminalPanel currentRepo={currentRepo} onToggle={toggleBottomPanel} />
            </div>
          </>
        )}
        </div>
        {/* Sidebar — right position */}
        {appSettings.sidebarPosition === 'right' && dragHandle}
        {layout.sidebarVisible && appSettings.sidebarPosition === 'right' && (
          <div style={{
            width: layout.sidebarCollapsed ? 48 : layout.sidebarSize,
            flexShrink: 0,
            height: '100%',
            overflow: layout.sidebarCollapsed ? 'visible' : 'hidden',
            position: 'relative',
            zIndex: layout.sidebarCollapsed ? 20 : undefined,
            borderLeft: '1px solid var(--border)',
            transition: isDragging ? 'none' : 'width 200ms ease-out'
          }}>
            <Sidebar currentRepo={currentRepo} collapsed={layout.sidebarCollapsed} onToggleCollapse={toggleSidebarCollapse} />
          </div>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar
        currentRepo={currentRepo}
        history={history}
        historyOpen={historyOpen}
        onToggleHistory={handleToggleHistory}
        onClearHistory={clearHistory}
        incomingChanges={incomingChanges}
        lastFetchTime={lastFetchTime}
        autoFetching={autoFetching}
        onManualRefresh={manualRefresh}
      />
    </div>
  )
}
