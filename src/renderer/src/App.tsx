import React, { useCallback, useEffect, useMemo } from 'react'
import { MenuBar } from './components/MenuBar'
import { TabBar } from './components/TabBar'
import { AppLayout } from './components/AppLayout'
import { SettingsPanel } from './components/SettingsPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettings } from './hooks/useSettings'
import { useRepoTabs } from './hooks/useRepoTabs'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from './hooks/useKeyboardShortcuts'

function App(): React.JSX.Element {
  const {
    settings,
    updateSettings,
    resetSettings,
    settingsOpen,
    openSettings,
    closeSettings,
    toggleTheme
  } = useSettings()

  const {
    tabs,
    activeTab,
    activeIndex,
    activeRepoPath,
    openTab,
    closeTab,
    switchTab,
    nextTab,
    prevTab,
    reorderTabs,
    showWelcomeScreen,
    getTabState,
    saveTabState
  } = useRepoTabs()

  const handleRepoOpen = useCallback(
    (repoPath: string) => {
      openTab(repoPath)
    },
    [openTab]
  )

  const handleCloseRepo = useCallback(() => {
    if (activeIndex >= 0) {
      closeTab(activeIndex)
    }
  }, [activeIndex, closeTab])

  // Listen for 'open-repo' custom events (e.g., from submodule "Open as Repository")
  useEffect(() => {
    const handler = (e: Event): void => {
      const customEvent = e as CustomEvent<{ path: string }>
      if (customEvent.detail?.path) {
        handleRepoOpen(customEvent.detail.path)
      }
    }
    window.addEventListener('open-repo', handler)
    return () => window.removeEventListener('open-repo', handler)
  }, [handleRepoOpen])

  // CLI: --open-repo support for GUI testing
  useEffect(() => {
    if (window.electronAPI.onCliOpenRepo) {
      const cleanup = window.electronAPI.onCliOpenRepo((repoPath: string) => {
        handleRepoOpen(repoPath)
      })
      return cleanup
    }
  }, [handleRepoOpen])

  // Menu bar IPC listeners
  useEffect(() => {
    const cleanups: (() => void)[] = []

    // File > Open Repository — main process already shows the dialog and sends the path
    cleanups.push(
      window.electronAPI.menu.onOpenRepository((repoPath: string) => {
        handleRepoOpen(repoPath)
      })
    )

    // File > Clone Repository — dispatch custom event for WelcomeScreen/Toolbar to handle
    cleanups.push(
      window.electronAPI.menu.onCloneRepository(() => {
        window.dispatchEvent(new CustomEvent('menu:clone-repository'))
      })
    )

    // File > Init Repository — open directory picker, then init
    cleanups.push(
      window.electronAPI.menu.onInitRepository(async () => {
        const dirPath = await window.electronAPI.dialog.openDirectory()
        if (!dirPath) return
        const result = await window.electronAPI.git.init(dirPath)
        if (result.success) {
          handleRepoOpen(dirPath)
        }
      })
    )

    // File > Close Tab
    cleanups.push(
      window.electronAPI.menu.onCloseTab(() => {
        handleCloseRepo()
      })
    )

    // File > Settings
    cleanups.push(
      window.electronAPI.menu.onSettings(() => {
        openSettings()
      })
    )

    // View > Toggle Sidebar
    cleanups.push(
      window.electronAPI.menu.onToggleSidebar(() => {
        window.dispatchEvent(new CustomEvent('menu:toggle-sidebar'))
      })
    )

    // View > Toggle Terminal
    cleanups.push(
      window.electronAPI.menu.onToggleTerminal(() => {
        window.dispatchEvent(new CustomEvent('menu:toggle-terminal'))
      })
    )

    // Help > Keyboard Shortcuts
    cleanups.push(
      window.electronAPI.menu.onKeyboardShortcuts(() => {
        window.dispatchEvent(new CustomEvent('menu:keyboard-shortcuts'))
      })
    )

    return () => {
      cleanups.forEach((fn) => fn())
    }
  }, [handleRepoOpen, handleCloseRepo, openSettings])

  // Tab keyboard shortcuts
  const handleNextTab = useShortcutHandler(nextTab)
  const handlePrevTab = useShortcutHandler(prevTab)

  const tabShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'next-tab',
        'Next Tab',
        'Navigation',
        'Ctrl+Tab',
        { ctrl: true, key: 'Tab' },
        handleNextTab
      ),
      defineShortcut(
        'prev-tab',
        'Previous Tab',
        'Navigation',
        'Ctrl+Shift+Tab',
        { ctrl: true, shift: true, key: 'Tab' },
        handlePrevTab
      )
    ],
    [handleNextTab, handlePrevTab]
  )

  useKeyboardShortcuts(tabShortcuts)

  return (
    <div className="app">
      <MenuBar
        repoPath={activeRepoPath}
        theme={settings.theme}
        onToggleTheme={toggleTheme}
      />
      <TabBar
        tabs={tabs}
        activeIndex={activeIndex}
        onSwitchTab={switchTab}
        onCloseTab={closeTab}
        onReorderTabs={reorderTabs}
        onAddTab={showWelcomeScreen}
      />
      <ErrorBoundary>
        <AppLayout
          currentRepo={activeRepoPath}
          onRepoOpen={handleRepoOpen}
          onCloseRepo={handleCloseRepo}
          onOpenSettings={openSettings}
          settings={settings}
          getTabState={getTabState}
          saveTabState={saveTabState}
        />
        {settingsOpen && (
          <SettingsPanel
            settings={settings}
            onUpdate={updateSettings}
            onReset={resetSettings}
            onClose={closeSettings}
          />
        )}
      </ErrorBoundary>
    </div>
  )
}

export default App
