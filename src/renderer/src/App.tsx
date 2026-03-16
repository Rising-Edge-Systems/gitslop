import React, { useCallback, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'

function App(): React.JSX.Element {
  const [currentRepo, setCurrentRepo] = useState<string | null>(null)

  const handleRepoOpen = useCallback((repoPath: string) => {
    setCurrentRepo(repoPath)
  }, [])

  const handleCloseRepo = useCallback(() => {
    setCurrentRepo(null)
  }, [])

  return (
    <div className="app">
      <TitleBar repoPath={currentRepo} />
      <AppLayout currentRepo={currentRepo} onRepoOpen={handleRepoOpen} onCloseRepo={handleCloseRepo} />
    </div>
  )
}

export default App
