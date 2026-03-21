import React from 'react'
import { WelcomeScreen } from './WelcomeScreen'
import { RepoView } from './RepoView'
import type { CommitDetail } from './CommitGraph'

interface MainContentProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCommitSelect?: (detail: CommitDetail | null) => void
  stagingCollapsed: boolean
  onToggleStagingCollapse: () => void
  // Center-stage diff props
  viewingDiff?: boolean
  diffFile?: string | null
  diffCommitHash?: string | null
  selectedCommit?: CommitDetail | null
  onBackToGraph?: () => void
  onNavigateFile?: (direction: 'prev' | 'next') => void
}

export const MainContent = React.memo(function MainContent({ currentRepo, onRepoOpen, onCommitSelect, stagingCollapsed, onToggleStagingCollapse, viewingDiff, diffFile, diffCommitHash, selectedCommit, onBackToGraph, onNavigateFile }: MainContentProps): React.JSX.Element {
  if (!currentRepo) {
    return (
      <div className="main-content main-content--centered">
        <WelcomeScreen onRepoOpen={onRepoOpen} />
      </div>
    )
  }

  return (
    <div className="main-content">
      <RepoView
        repoPath={currentRepo}
        onCommitSelect={onCommitSelect}
        stagingCollapsed={stagingCollapsed}
        onToggleStagingCollapse={onToggleStagingCollapse}
        viewingDiff={viewingDiff}
        diffFile={diffFile}
        diffCommitHash={diffCommitHash}
        selectedCommit={selectedCommit}
        onBackToGraph={onBackToGraph}
        onNavigateFile={onNavigateFile}
      />
    </div>
  )
})
