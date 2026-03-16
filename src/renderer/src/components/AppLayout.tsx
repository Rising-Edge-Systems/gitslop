import React, { useCallback, useMemo, useState } from 'react'
import {
  Group,
  Panel,
  Separator
} from 'react-resizable-panels'
import type { PanelSize } from 'react-resizable-panels'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { MainContent } from './MainContent'
import { TerminalPanel } from './Terminal'
import { SearchPalette } from './SearchPalette'
import { KeyboardShortcutsPanel } from './KeyboardShortcutsPanel'
import { useLayoutState } from '../hooks/useLayoutState'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'

interface AppLayoutProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
  onOpenSettings: () => void
  settings: { sidebarPosition: 'left' | 'right' }
}

export function AppLayout({ currentRepo, onRepoOpen, onCloseRepo, onOpenSettings, settings: appSettings }: AppLayoutProps): React.JSX.Element {
  const {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    toggleBottomPanel,
    toggleSidebar
  } = useLayoutState()

  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

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

  return (
    <div className="app-layout">
      <Toolbar currentRepo={currentRepo} onOpenSettings={onOpenSettings} />

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
        <Group orientation="horizontal" id="gitslop-horizontal">
          {layout.sidebarVisible && appSettings.sidebarPosition === 'left' && (
            <>
              <Panel
                id="sidebar"
                defaultSize={layout.sidebarSize}
                minSize={12}
                maxSize={40}
                onResize={handleSidebarResize}
              >
                <Sidebar currentRepo={currentRepo} />
              </Panel>
              <Separator className="resize-handle resize-handle-horizontal" />
            </>
          )}
          <Panel id="center" minSize={30}>
            <Group orientation="vertical" id="gitslop-vertical">
              <Panel id="main" minSize={20}>
                <MainContent currentRepo={currentRepo} onRepoOpen={onRepoOpen} onCloseRepo={onCloseRepo} />
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
          </Panel>
          {layout.sidebarVisible && appSettings.sidebarPosition === 'right' && (
            <>
              <Separator className="resize-handle resize-handle-horizontal" />
              <Panel
                id="sidebar"
                defaultSize={layout.sidebarSize}
                minSize={12}
                maxSize={40}
                onResize={handleSidebarResize}
              >
                <Sidebar currentRepo={currentRepo} />
              </Panel>
            </>
          )}
        </Group>
      </div>
    </div>
  )
}
