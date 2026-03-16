import React from 'react'
import { WelcomeScreen } from './WelcomeScreen'
import { RepoView } from './RepoView'

interface MainContentProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
}

export function MainContent({ currentRepo, onRepoOpen, onCloseRepo }: MainContentProps): React.JSX.Element {
  if (!currentRepo) {
    return (
      <div className="main-content">
        <WelcomeScreen onRepoOpen={onRepoOpen} />
      </div>
    )
  }

  return (
    <div className="main-content">
      <RepoView repoPath={currentRepo} onCloseRepo={onCloseRepo} />
    </div>
  )
}
