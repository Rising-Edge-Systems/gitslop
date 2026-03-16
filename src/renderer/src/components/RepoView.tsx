import React, { useCallback, useEffect, useState } from 'react'
import { BlameView } from './BlameView'
import { CodeEditor } from './CodeEditor'
import { CommitDialog } from './CommitDialog'
import { CommitFilterBar, CommitFilters, EMPTY_FILTERS, hasActiveFilters } from './CommitFilterBar'
import { CommitGraph, CommitLogFilters } from './CommitGraph'
import { ConflictResolver } from './ConflictResolver'
import { StatusPanel } from './StatusPanel'

interface RepoViewProps {
  repoPath: string
  onCloseRepo: () => void
}

interface BranchInfo {
  name: string
  current: boolean
}

interface RepoStatus {
  branch: string
  staged: number
  unstaged: number
  untracked: number
}

export function RepoView({ repoPath, onCloseRepo }: RepoViewProps): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConflictResolver, setShowConflictResolver] = useState(false)
  const [hasConflicts, setHasConflicts] = useState(false)
  const [showEditor, setShowEditor] = useState(false)
  const [blameFilePath, setBlameFilePath] = useState<string | null>(null)
  const [commitFilters, setCommitFilters] = useState<CommitFilters>(EMPTY_FILTERS)
  const [fileHistoryPath, setFileHistoryPath] = useState<string | undefined>(undefined)

  const loadRepoData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Load status
      const statusResult = await window.electronAPI.git.getStatus(repoPath)
      if (statusResult.success && statusResult.data) {
        const data = statusResult.data
        setStatus({
          branch: data.branch?.head || data.branch || 'unknown',
          staged: Array.isArray(data.staged) ? data.staged.length : 0,
          unstaged: Array.isArray(data.unstaged) ? data.unstaged.length : 0,
          untracked: Array.isArray(data.untracked) ? data.untracked.length : 0
        })
      }

      // Load branches
      const branchResult = await window.electronAPI.git.getBranches(repoPath)
      if (branchResult.success && Array.isArray(branchResult.data)) {
        setBranches(
          branchResult.data.map((b: { name: string; current: boolean }) => ({
            name: b.name,
            current: b.current
          }))
        )
      }

      // Check for conflicts
      const conflictsResult = await window.electronAPI.git.getConflictedFiles(repoPath)
      if (conflictsResult.success && Array.isArray(conflictsResult.data) && conflictsResult.data.length > 0) {
        setHasConflicts(true)
        setShowConflictResolver(true)
      } else {
        setHasConflicts(false)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load repository data')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    loadRepoData()
    // Start file watcher for this repo
    window.electronAPI.watcher.start(repoPath)
    return () => {
      window.electronAPI.watcher.stop()
    }
  }, [loadRepoData, repoPath])

  // Show editor panel when a file is opened
  useEffect(() => {
    const handler = (): void => {
      setShowEditor(true)
    }
    window.addEventListener('editor:open-file', handler)
    return () => window.removeEventListener('editor:open-file', handler)
  }, [])

  // Listen for blame open events
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ filePath: string }>).detail
      if (detail?.filePath) {
        setBlameFilePath(detail.filePath)
      }
    }
    window.addEventListener('blame:open', handler)
    return () => window.removeEventListener('blame:open', handler)
  }, [])

  // Listen for "show history for file" events (from context menus)
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ path: string }>).detail
      if (detail?.path) {
        setFileHistoryPath(detail.path)
        setCommitFilters((prev) => ({ ...prev, path: detail.path }))
      }
    }
    window.addEventListener('commit-filter:file-history', handler)
    return () => window.removeEventListener('commit-filter:file-history', handler)
  }, [])

  // Convert CommitFilters to CommitLogFilters (only non-empty values)
  const graphFilters: CommitLogFilters | undefined = hasActiveFilters(commitFilters)
    ? {
        ...(commitFilters.author ? { author: commitFilters.author } : {}),
        ...(commitFilters.since ? { since: commitFilters.since } : {}),
        ...(commitFilters.until ? { until: commitFilters.until } : {}),
        ...(commitFilters.grep ? { grep: commitFilters.grep } : {}),
        ...(commitFilters.path ? { path: commitFilters.path } : {})
      }
    : undefined

  const repoName = repoPath.split(/[/\\]/).pop() || repoPath
  const currentBranch = branches.find((b) => b.current)?.name || status?.branch || '—'

  return (
    <div className="repo-view">
      <div className="repo-view-header">
        <div className="repo-view-info">
          <h2 className="repo-view-name">{repoName}</h2>
          <span className="repo-view-path" title={repoPath}>
            {repoPath}
          </span>
        </div>
        <div className="repo-view-actions">
          <button className="repo-view-refresh" onClick={loadRepoData} title="Refresh">
            &#x21BB;
          </button>
          <button className="repo-view-close" onClick={onCloseRepo} title="Close repository">
            &#x2715; Close
          </button>
        </div>
      </div>

      {loading && (
        <div className="repo-view-loading">
          <span className="repo-view-spinner">&#x21BB;</span>
          Loading repository...
        </div>
      )}

      {error && (
        <div className="repo-view-error">
          <span>&#9888;</span> {error}
          <button onClick={loadRepoData}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className="repo-view-content">
          <div className="repo-view-summary">
            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9739;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Current Branch</span>
                <span className="repo-view-card-value">{currentBranch}</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9998;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Staged</span>
                <span className="repo-view-card-value">{status?.staged ?? 0} files</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#9997;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Unstaged</span>
                <span className="repo-view-card-value">{status?.unstaged ?? 0} files</span>
              </div>
            </div>

            <div className="repo-view-card">
              <span className="repo-view-card-icon">&#63;</span>
              <div className="repo-view-card-info">
                <span className="repo-view-card-label">Untracked</span>
                <span className="repo-view-card-value">{status?.untracked ?? 0} files</span>
              </div>
            </div>
          </div>

          {/* Conflict Banner */}
          {hasConflicts && !showConflictResolver && (
            <div className="conflict-banner">
              <span className="conflict-banner-icon">&#9888;</span>
              <span>Merge conflicts detected. Resolve them to continue.</span>
              <button
                className="conflict-banner-btn"
                onClick={() => setShowConflictResolver(true)}
              >
                Open Conflict Resolver
              </button>
            </div>
          )}

          {/* Conflict Resolver Overlay */}
          {showConflictResolver && (
            <ConflictResolver
              repoPath={repoPath}
              onResolved={() => {
                setShowConflictResolver(false)
                setHasConflicts(false)
                loadRepoData()
              }}
              onClose={() => setShowConflictResolver(false)}
            />
          )}

          {/* Status Panel */}
          <StatusPanel repoPath={repoPath} onRefresh={loadRepoData} />

          {/* Commit Dialog */}
          <CommitDialog
            repoPath={repoPath}
            stagedCount={status?.staged ?? 0}
            onCommitDone={loadRepoData}
          />

          {/* Blame View */}
          {blameFilePath && (
            <div className="blame-view-panel">
              <BlameView
                repoPath={repoPath}
                filePath={blameFilePath}
                onClose={() => setBlameFilePath(null)}
                onCommitClick={(hash) => {
                  // Dispatch event to scroll graph to this commit
                  window.dispatchEvent(
                    new CustomEvent('graph:scroll-to-commit', { detail: { hash } })
                  )
                }}
              />
            </div>
          )}

          {/* Editor Toggle + Panel */}
          <div className="editor-toggle-bar">
            <button
              className={`editor-toggle-btn ${showEditor ? 'active' : ''}`}
              onClick={() => setShowEditor((prev) => !prev)}
              title="Toggle Code Editor"
            >
              &#128196; Editor {showEditor ? '(hide)' : '(show)'}
            </button>
          </div>
          {showEditor && (
            <div className="code-editor-panel">
              <CodeEditor repoPath={repoPath} onFileSaved={loadRepoData} />
            </div>
          )}

          {/* Commit History Filters */}
          <CommitFilterBar
            filters={commitFilters}
            onFiltersChange={setCommitFilters}
            filePath={fileHistoryPath}
          />

          {/* Commit Graph */}
          <CommitGraph repoPath={repoPath} onRefresh={loadRepoData} filters={graphFilters} />
        </div>
      )}
    </div>
  )
}
