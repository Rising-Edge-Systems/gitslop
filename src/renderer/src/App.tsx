import React, { useState, useCallback, useEffect } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'
import { SettingsPanel } from './components/SettingsPanel'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useSettings } from './hooks/useSettings'

function App(): React.JSX.Element {
  const [currentRepo, setCurrentRepo] = useState<string | null>(null)
  const {
    settings,
    updateSettings,
    resetSettings,
    settingsOpen,
    openSettings,
    closeSettings,
    toggleTheme
  } = useSettings()

  const handleRepoOpen = useCallback((repoPath: string) => {
    setCurrentRepo(repoPath)
  }, [])

  const handleCloseRepo = useCallback(() => {
    setCurrentRepo(null)
  }, [])

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

  return (
    <div className="app">
      <TitleBar repoPath={currentRepo} theme={settings.theme} onToggleTheme={toggleTheme} />
      <ErrorBoundary>
        <AppLayout
          currentRepo={currentRepo}
          onRepoOpen={handleRepoOpen}
          onCloseRepo={handleCloseRepo}
          onOpenSettings={openSettings}
          settings={settings}
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
