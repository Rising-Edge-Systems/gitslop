import React from 'react'
import { WelcomeScreen } from './WelcomeScreen'
import { RepoView } from './RepoView'
import type { CommitDetail } from './CommitGraph'

interface MainContentProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCloseRepo: () => void
  onCommitSelect?: (detail: CommitDetail | null) => void
}

export const MainContent = React.memo(function MainContent({ currentRepo, onRepoOpen, onCloseRepo, onCommitSelect }: MainContentProps): React.JSX.Element {
  if (!currentRepo) {
    return (
      <div className="main-content main-content--centered">
        <WelcomeScreen onRepoOpen={onRepoOpen} />
      </div>
    )
  }

  return (
    <div className="main-content">
      <RepoView repoPath={currentRepo} onCloseRepo={onCloseRepo} onCommitSelect={onCommitSelect} />
    </div>
  )
})
