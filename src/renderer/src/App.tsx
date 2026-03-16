import React, { useState, useCallback } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'
import { SettingsPanel } from './components/SettingsPanel'
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

  return (
    <div className="app">
      <TitleBar repoPath={currentRepo} theme={settings.theme} onToggleTheme={toggleTheme} />
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
    </div>
  )
}

export default App
