import React, { useCallback, useState } from 'react'
import { TitleBar } from './components/TitleBar'
import { AppLayout } from './components/AppLayout'

function App(): React.JSX.Element {
  const [currentRepo, setCurrentRepo] = useState<string | null>(null)

  const handleRepoOpen = useCallback((repoPath: string) => {
    setCurrentRepo(repoPath)
  }, [])

  return (
    <div className="app">
      <TitleBar />
      <AppLayout currentRepo={currentRepo} onRepoOpen={handleRepoOpen} />
    </div>
  )
}

export default App
