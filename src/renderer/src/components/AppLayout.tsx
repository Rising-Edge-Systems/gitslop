import React, { useCallback, useMemo, useState } from 'react'
import { useWindowWidth } from '../hooks/useWindowWidth'
import {
  Group,
  Panel,
  Separator
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

interface AppLayoutProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
  onOpenSettings: () => void
  settings: { sidebarPosition: 'left' | 'right'; autoFetchInterval: number }
}

export function AppLayout({ currentRepo, onRepoOpen, onCloseRepo, onOpenSettings, settings: appSettings }: AppLayoutProps): React.JSX.Element {
  const {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    setRightPanelSize,
    toggleBottomPanel,
    toggleSidebar,
    toggleSidebarCollapse
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

  // Hybrid detail panel: inline when wide, overlay when narrow
  const DETAIL_PANEL_BREAKPOINT = 1400
  const windowWidth = useWindowWidth()
  const useOverlayDetailPanel = windowWidth < DETAIL_PANEL_BREAKPOINT

  // Auto-fetch: fetches on configurable interval, tracks incoming changes
  const { incomingChanges, lastFetchTime, fetching: autoFetching, manualRefresh } = useAutoFetch({
    repoPath: currentRepo,
    intervalMinutes: appSettings.autoFetchInterval,
    onNotify: addNotification
  })

  const handleSidebarResize = useCallback(
    (panelSize: PanelSize) => {
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
  }, [])

  const handleCloseDetailPanel = useCallback(() => {
    setSelectedCommit(null)
  }, [])

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
        {/* Collapsed sidebar icon rail — rendered outside resizable panels */}
        {layout.sidebarVisible && layout.sidebarCollapsed && appSettings.sidebarPosition === 'left' && (
          <Sidebar currentRepo={currentRepo} collapsed={true} onToggleCollapse={toggleSidebarCollapse} />
        )}
        <Group orientation="vertical" id="gitslop-outer-vertical">
          <Panel id="columns" minSize={20}>
            <Group orientation="horizontal" id="gitslop-horizontal">
              {layout.sidebarVisible && appSettings.sidebarPosition === 'left' && !layout.sidebarCollapsed && (
                <>
                  <Panel
                    id="sidebar"
                    defaultSize={layout.sidebarSize}
                    minSize={12}
                    maxSize={40}
                    onResize={handleSidebarResize}
                  >
                    <Sidebar currentRepo={currentRepo} collapsed={false} onToggleCollapse={toggleSidebarCollapse} />
                  </Panel>
                  <Separator className="resize-handle resize-handle-horizontal" />
                </>
              )}
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
                  <Separator className="resize-handle resize-handle-horizontal" />
                  <Panel
                    id="detail"
                    defaultSize={layout.rightPanelSize}
                    minSize={15}
                    maxSize={50}
                    onResize={handleRightPanelResize}
                  >
                    <DetailPanel
                      detail={selectedCommit}
                      repoPath={currentRepo}
                      onClose={handleCloseDetailPanel}
                    />
                  </Panel>
                </>
              )}
              {layout.sidebarVisible && appSettings.sidebarPosition === 'right' && !layout.sidebarCollapsed && (
                <>
                  <Separator className="resize-handle resize-handle-horizontal" />
                  <Panel
                    id="sidebar"
                    defaultSize={layout.sidebarSize}
                    minSize={12}
                    maxSize={40}
                    onResize={handleSidebarResize}
                  >
                    <Sidebar currentRepo={currentRepo} collapsed={false} onToggleCollapse={toggleSidebarCollapse} />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
          {layout.bottomPanelVisible && (
            <>
              <Separator className="resize-handle resize-handle-vertical" />
              <Panel
                id="bottom"
                defaultSize={layout.bottomPanelSize}
                minSize={10}
                maxSize={60}
                onResize={handleBottomResize}
              >
                <TerminalPanel currentRepo={currentRepo} onToggle={toggleBottomPanel} />
              </Panel>
            </>
          )}
        </Group>
        {/* Collapsed sidebar icon rail — right position */}
        {layout.sidebarVisible && layout.sidebarCollapsed && appSettings.sidebarPosition === 'right' && (
          <Sidebar currentRepo={currentRepo} collapsed={true} onToggleCollapse={toggleSidebarCollapse} />
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
