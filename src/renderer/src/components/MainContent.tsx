import React from 'react'
import { WelcomeScreen } from './WelcomeScreen'

interface MainContentProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
}

export function MainContent({ currentRepo, onRepoOpen }: MainContentProps): React.JSX.Element {
  if (!currentRepo) {
    return (
      <div className="main-content">
        <WelcomeScreen onRepoOpen={onRepoOpen} />
      </div>
    )
  }

  return (
    <div className="main-content">
      <div className="repo-view-placeholder">
        <p>Repository: {currentRepo}</p>
      </div>
    </div>
  )
}
