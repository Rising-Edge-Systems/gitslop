import React from 'react'
import { WelcomeScreen } from './WelcomeScreen'
import { RepoView } from './RepoView'
import type { CommitDetail } from './CommitGraph'
import type { DiffViewMode } from './DiffViewer'

interface MainContentProps {
  currentRepo: string | null
  onRepoOpen: (repoPath: string) => void
  onCommitSelect?: (detail: CommitDetail | null) => void
  onTwoCommitSelect?: (data: { hashFrom: string; hashTo: string; selectedCommits: Array<{ hash: string; shortHash: string; subject: string; authorName: string; authorDate: string }> } | null) => void
  onRepoLoaded?: () => void
  // Center-stage diff props
  viewingDiff?: boolean
  diffFile?: string | null
  diffCommitHash?: string | null
  selectedCommit?: CommitDetail | null
  onBackToGraph?: () => void
  onNavigateFile?: (direction: 'prev' | 'next') => void
  diffViewMode?: DiffViewMode
  onDiffViewModeChange?: (mode: DiffViewMode) => void
  showBranchLabels?: boolean
  commitHistoryDepth?: number
  // Working-tree file selected in StatusPanel — displayed in the main center viewer
  workingTreeFile?: { path: string; staged: boolean; isUntracked: boolean } | null
  onCloseWorkingTreeFile?: () => void
}

export const MainContent = React.memo(function MainContent({ currentRepo, onRepoOpen, onCommitSelect, onTwoCommitSelect, onRepoLoaded, viewingDiff, diffFile, diffCommitHash, selectedCommit, onBackToGraph, onNavigateFile, diffViewMode, onDiffViewModeChange, showBranchLabels, commitHistoryDepth, workingTreeFile, onCloseWorkingTreeFile }: MainContentProps): React.JSX.Element {
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
        onTwoCommitSelect={onTwoCommitSelect}
        onRepoLoaded={onRepoLoaded}
        viewingDiff={viewingDiff}
        diffFile={diffFile}
        diffCommitHash={diffCommitHash}
        selectedCommit={selectedCommit}
        onBackToGraph={onBackToGraph}
        onNavigateFile={onNavigateFile}
        diffViewMode={diffViewMode}
        onDiffViewModeChange={onDiffViewModeChange}
        showBranchLabels={showBranchLabels}
        commitHistoryDepth={commitHistoryDepth}
        workingTreeFile={workingTreeFile}
        onCloseWorkingTreeFile={onCloseWorkingTreeFile}
      />
    </div>
  )
})
