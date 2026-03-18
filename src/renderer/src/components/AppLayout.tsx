import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowWidth } from '../hooks/useWindowWidth'
import {
  Group,
  Panel,
  Separator,
  usePanelRef
} from 'react-resizable-panels'
import type { PanelSize } from 'react-resizable-panels'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { MainContent } from './MainContent'
import { DetailPanel } from './DetailPanel'
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
import type { CommitDetail } from './CommitGraph'
import type { TabPerTabState } from '../hooks/useRepoTabs'

interface AppLayoutProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
  onOpenSettings: () => void
  settings: { sidebarPosition: 'left' | 'right'; autoFetchInterval: number }
  getTabState: (repoPath: string) => TabPerTabState
  saveTabState: (repoPath: string, state: Partial<TabPerTabState>) => void
}

export function AppLayout({ currentRepo, onRepoOpen, onCloseRepo, onOpenSettings, settings: appSettings, getTabState, saveTabState }: AppLayoutProps): React.JSX.Element {
  const {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    setRightPanelSize,
    toggleBottomPanel,
    toggleSidebar,
    toggleSidebarCollapse,
    setSidebarCollapsed
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

    // Restore state for new tab — but don't override sidebar state on first load
    // because the expanded sidebar has a Panel sizing bug that makes it 5px wide
    if (currentRepo && currentRepo !== prevRepo && prevRepo !== null) {
      const restored = getTabState(currentRepo)
      setSidebarCollapsed(restored.sidebarCollapsed)
      // Clear selected commit — it will be re-selected by the commit graph if the hash matches.
      // We can't restore the full CommitDetail object (it's not persisted), so we clear it.
      // The detail panel open/closed state is derived from selectedCommit being non-null.
      setSelectedCommit(null)
    }

    prevRepoRef.current = currentRepo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo])

  // Responsive breakpoints
  const DETAIL_PANEL_BREAKPOINT = 1400
  const SIDEBAR_COLLAPSE_BREAKPOINT = 900
  const windowWidth = useWindowWidth()

  // Hybrid detail panel: inline when wide, overlay when narrow
  const useOverlayDetailPanel = windowWidth < DETAIL_PANEL_BREAKPOINT

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

  // Auto-fetch: fetches on configurable interval, tracks incoming changes
  const { incomingChanges, lastFetchTime, fetching: autoFetching, manualRefresh } = useAutoFetch({
    repoPath: currentRepo,
    intervalMinutes: appSettings.autoFetchInterval,
    onNotify: addNotification
  })

  const handleSidebarResize = useCallback(
    (panelSize: PanelSize) => {
      // Ignore resize events that would corrupt the sidebar to an unusable width
      if (panelSize.asPercentage < 12) {
        console.warn(`[Sidebar] Ignoring corrupt resize: ${panelSize.asPercentage}%`)
        return
      }
      setSidebarSize(panelSize.asPercentage)
    },
    [setSidebarSize]
  )

  const handleBottomResize = useCallback(
    (panelSize: PanelSize) => {
      setBottomPanelSize(panelSize.asPercentage)
    },
    [setBottomPanelSize]
  )

  const handleRightPanelResize = useCallback(
    (panelSize: PanelSize) => {
      setRightPanelSize(panelSize.asPercentage)
    },
    [setRightPanelSize]
  )

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
    if (currentRepo) {
      saveTabState(currentRepo, {
        selectedCommitHash: null,
        detailPanelOpen: false
      })
    }
  }, [currentRepo, saveTabState])

  // Panel refs for double-click-to-reset on dividers
  const sidebarPanelRef = usePanelRef()
  const detailPanelRef = usePanelRef()
  const bottomPanelRef = usePanelRef()

  const DEFAULT_SIDEBAR_SIZE = 20
  const DEFAULT_BOTTOM_SIZE = 25
  const DEFAULT_RIGHT_PANEL_SIZE = 25

  // Force sidebar to a valid size when it becomes visible in expanded mode.
  // react-resizable-panels squeezes newly-rendered Panels to near-zero.
  // This effect forces the sidebar to its intended size after mount.
  const sidebarExpanded = layout.sidebarVisible && !layout.sidebarCollapsed
  useEffect(() => {
    if (sidebarExpanded) {
      // Try multiple times — the panel may need a few frames to be ready
      const targetSize = layout.sidebarSize >= 12 ? layout.sidebarSize : DEFAULT_SIDEBAR_SIZE
      const attempts = [50, 150, 300, 500]
      const timers = attempts.map((delay) =>
        setTimeout(() => {
          try {
            sidebarPanelRef.current?.resize(targetSize)
          } catch {
            // Panel not ready yet
          }
        }, delay)
      )
      return () => timers.forEach(clearTimeout)
    }
  }, [sidebarExpanded, layout.sidebarSize, sidebarPanelRef])

  const handleSidebarDividerDoubleClick = useCallback(() => {
    sidebarPanelRef.current?.resize(DEFAULT_SIDEBAR_SIZE)
  }, [sidebarPanelRef])

  const handleDetailDividerDoubleClick = useCallback(() => {
    detailPanelRef.current?.resize(DEFAULT_RIGHT_PANEL_SIZE)
  }, [detailPanelRef])

  const handleBottomDividerDoubleClick = useCallback(() => {
    bottomPanelRef.current?.resize(DEFAULT_BOTTOM_SIZE)
  }, [bottomPanelRef])

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

  // Right detail panel is visible when a commit is selected and a repo is open
  const rightPanelVisible = selectedCommit !== null && currentRepo !== null

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

      <div className="app-body">
        {/* Sidebar — rendered OUTSIDE react-resizable-panels with fixed CSS width.
            The Panel-based approach was broken: conditionally rendering a Panel
            caused react-resizable-panels to squeeze it to ~1% width on mount. */}
        {layout.sidebarVisible && appSettings.sidebarPosition === 'left' && (
          layout.sidebarCollapsed ? (
            <Sidebar currentRepo={currentRepo} collapsed={true} onToggleCollapse={toggleSidebarCollapse} />
          ) : (
            <div style={{ width: 260, flexShrink: 0, height: '100%', overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
              <Sidebar currentRepo={currentRepo} collapsed={false} onToggleCollapse={toggleSidebarCollapse} />
            </div>
          )
        )}
        <Group orientation="vertical" id="gitslop-outer-vertical">
          <Panel id="columns" minSize={20}>
            <Group orientation="horizontal" id="gitslop-horizontal">
              <Panel id="center" minSize={30}>
                <MainContent
                  currentRepo={currentRepo}
                  onRepoOpen={onRepoOpen}
                  onCloseRepo={onCloseRepo}
                  onCommitSelect={handleCommitSelect}
                />
              </Panel>
              {rightPanelVisible && !useOverlayDetailPanel && (
                <>
                  <Separator className="resize-handle resize-handle-horizontal" onDoubleClick={handleDetailDividerDoubleClick} />
                  <Panel
                    id="detail"
                    defaultSize={layout.rightPanelSize}
                    minSize={15}
                    maxSize={50}
                    onResize={handleRightPanelResize}
                    panelRef={detailPanelRef}
                    className="panel-animate-detail"
                  >
                    <DetailPanel
                      detail={selectedCommit}
                      repoPath={currentRepo}
                      onClose={handleCloseDetailPanel}
                    />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
          {layout.bottomPanelVisible && (
            <>
              <Separator className="resize-handle resize-handle-vertical" onDoubleClick={handleBottomDividerDoubleClick} />
              <Panel
                id="bottom"
                defaultSize={layout.bottomPanelSize}
                minSize={10}
                maxSize={60}
                onResize={handleBottomResize}
                panelRef={bottomPanelRef}
                className="panel-animate-terminal"
              >
                <TerminalPanel currentRepo={currentRepo} onToggle={toggleBottomPanel} />
              </Panel>
            </>
          )}
        </Group>
        {/* Sidebar — right position */}
        {layout.sidebarVisible && appSettings.sidebarPosition === 'right' && (
          layout.sidebarCollapsed ? (
            <Sidebar currentRepo={currentRepo} collapsed={true} onToggleCollapse={toggleSidebarCollapse} />
          ) : (
            <div style={{ width: 260, flexShrink: 0, height: '100%', overflow: 'hidden', borderLeft: '1px solid var(--border)' }}>
              <Sidebar currentRepo={currentRepo} collapsed={false} onToggleCollapse={toggleSidebarCollapse} />
            </div>
          )
        )}
      </div>

      {/* Overlay detail panel for narrow windows */}
      {rightPanelVisible && useOverlayDetailPanel && (
        <DetailPanel
          detail={selectedCommit}
          repoPath={currentRepo}
          onClose={handleCloseDetailPanel}
          overlay
        />
      )}

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
