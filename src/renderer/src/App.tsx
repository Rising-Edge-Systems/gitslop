import React, { useCallback, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'
import { useTheme } from './hooks/useTheme'

function App(): React.JSX.Element {
  const [currentRepo, setCurrentRepo] = useState<string | null>(null)
  const { theme, toggleTheme } = useTheme()

  const handleRepoOpen = useCallback((repoPath: string) => {
    setCurrentRepo(repoPath)
  }, [])

  const handleCloseRepo = useCallback(() => {
    setCurrentRepo(null)
  }, [])

  return (
    <div className="app">
      <TitleBar repoPath={currentRepo} theme={theme} onToggleTheme={toggleTheme} />
      <AppLayout currentRepo={currentRepo} onRepoOpen={handleRepoOpen} onCloseRepo={handleCloseRepo} />
    </div>
  )
}

export default App
