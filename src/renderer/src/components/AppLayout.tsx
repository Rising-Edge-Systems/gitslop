import React, { useCallback } from 'react'
import {
  Group,
  Panel,
  Separator
} from 'react-resizable-panels'
import type { PanelSize } from 'react-resizable-panels'
import { Toolbar } from './Toolbar'
import { Sidebar } from './Sidebar'
import { MainContent } from './MainContent'
import { BottomPanel } from './BottomPanel'
import { useLayoutState } from '../hooks/useLayoutState'

interface AppLayoutProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
}

export function AppLayout({ currentRepo, onRepoOpen, onCloseRepo }: AppLayoutProps): React.JSX.Element {
  const {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    toggleBottomPanel,
    toggleSidebar
  } = useLayoutState()

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

  // Keyboard shortcuts
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      // Ctrl+B to toggle sidebar
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault()
        toggleSidebar()
      }
      // Ctrl+` to toggle bottom panel
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        toggleBottomPanel()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleSidebar, toggleBottomPanel])

  return (
    <div className="app-layout">
      <Toolbar />
      <div className="app-body">
        <Group orientation="horizontal" id="gitslop-horizontal">
          {layout.sidebarVisible && (
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
                    <BottomPanel onToggle={toggleBottomPanel} />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
        </Group>
      </div>
    </div>
  )
}
