import React, { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X, AlertTriangle, FileText, ArrowLeft } from 'lucide-react'
import styles from './RepoView.module.css'
import { RepoViewSkeleton } from './Skeleton'
import blameStyles from './BlameView.module.css'
import conflictStyles from './ConflictResolver.module.css'
import editorStyles from './CodeEditor.module.css'
import { BlameView } from './BlameView'
import { CodeEditor } from './CodeEditor'
import { CommitFilterBar, CommitFilters, EMPTY_FILTERS, hasActiveFilters } from './CommitFilterBar'
import { CommitGraph, CommitLogFilters, CommitDetail } from './CommitGraph'
import { ConflictResolver } from './ConflictResolver'
import { StatusPanel } from './StatusPanel'
import { DiffViewer } from './DiffViewer'

interface RepoViewProps {
  repoPath: string
  onCloseRepo: () => void
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

export function RepoView({ repoPath, onCloseRepo, onCommitSelect, stagingCollapsed, onToggleStagingCollapse, viewingDiff, diffFile, diffCommitHash, selectedCommit, onBackToGraph, onNavigateFile }: RepoViewProps): React.JSX.Element {
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

  // ─── Center-Stage Diff Loading ───────────────────────────────────────────
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // Load diff content when viewingDiff / diffFile / diffCommitHash changes
  useEffect(() => {
    if (!viewingDiff || !diffFile || !diffCommitHash) {
      setDiffContent(null)
      setDiffError(null)
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiffError(null)
    window.electronAPI.git.showCommitFileDiff(repoPath, diffCommitHash, diffFile)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) {
          setDiffContent(result.data as string)
        } else {
          setDiffError(result.error || 'Failed to load diff')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setDiffError(err instanceof Error ? err.message : 'Failed to load diff')
      })
      .finally(() => {
        if (!cancelled) setDiffLoading(false)
      })
    return () => { cancelled = true }
  }, [viewingDiff, diffFile, diffCommitHash, repoPath])

  // Escape key returns from diff to graph; [ and ] navigate files
  useEffect(() => {
    if (!viewingDiff) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onBackToGraph?.()
      } else if (e.key === '[') {
        e.preventDefault()
        onNavigateFile?.('prev')
      } else if (e.key === ']') {
        e.preventDefault()
        onNavigateFile?.('next')
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [viewingDiff, onBackToGraph, onNavigateFile])

  const initialLoadDone = useRef(false)

  const loadRepoData = useCallback(async () => {
    // Only show loading spinner on initial load, not on refreshes
    if (!initialLoadDone.current) {
      setLoading(true)
    }
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
      initialLoadDone.current = true
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

  return (
    <div className={styles.repoView}>
      <div className={styles.repoViewHeader}>
        <div className={styles.repoViewInfo}>
          <h2 className={styles.repoViewName}>{repoName}</h2>
          <span className={styles.repoViewPath} title={repoPath}>
            {repoPath}
          </span>
        </div>
        <div className={styles.repoViewActions}>
          <button className={styles.repoViewRefresh} onClick={loadRepoData} title="Refresh">
            <RefreshCw size={14} />
          </button>
          <button className={styles.repoViewClose} onClick={onCloseRepo} title="Close repository">
            <X size={14} /> Close
          </button>
        </div>
      </div>

      {loading && (
        <RepoViewSkeleton />
      )}

      {error && (
        <div className={styles.repoViewError}>
          <span><AlertTriangle size={14} /></span> {error}
          <button onClick={loadRepoData}>Retry</button>
        </div>
      )}

      {!loading && !error && (
        <div className={styles.repoViewContent}>
          {/* Conflict Banner */}
          {hasConflicts && !showConflictResolver && (
            <div className={conflictStyles.conflictBanner}>
              <span className={conflictStyles.conflictBannerIcon}><AlertTriangle size={16} /></span>
              <span>Merge conflicts detected. Resolve them to continue.</span>
              <button
                className={conflictStyles.conflictBannerBtn}
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

          {/* Center-Stage Diff View OR Commit Graph */}
          {viewingDiff && diffFile && diffCommitHash ? (
            <>
              {/* Back breadcrumb bar */}
              <div className={styles.diffBackBar}>
                <button className={styles.diffBackBtn} onClick={onBackToGraph}>
                  <ArrowLeft size={14} />
                  <span>Back to Graph</span>
                </button>
                <span className={styles.diffBackSeparator}>·</span>
                <span className={styles.diffBackPath}>
                  <code className={styles.diffBackHash}>{diffCommitHash.substring(0, 7)}</code>
                  {' / '}
                  {diffFile}
                </span>
              </div>

              {/* Diff content */}
              <div className={styles.centerDiffContainer}>
                {diffLoading && (
                  <div className={styles.diffLoadingState}>Loading diff…</div>
                )}
                {diffError && (
                  <div className={styles.diffErrorState}>
                    <AlertTriangle size={14} /> {diffError}
                  </div>
                )}
                {!diffLoading && !diffError && diffContent !== null && (() => {
                  const currentFileDetail = selectedCommit?.fileDetails.find(f => f.path === diffFile)
                  const currentFileIndex = selectedCommit?.fileDetails.findIndex(f => f.path === diffFile) ?? 0
                  return (
                    <DiffViewer
                      diffContent={diffContent}
                      filePath={diffFile}
                      className={styles.centerDiffViewer}
                      fileStatus={currentFileDetail?.status}
                      fileIndex={currentFileIndex >= 0 ? currentFileIndex : 0}
                      fileCount={selectedCommit?.fileDetails.length}
                      onNavigateFile={onNavigateFile}
                    />
                  )
                })()}
                {!diffLoading && !diffError && diffContent === null && (
                  <div className={styles.diffLoadingState}>No diff content available</div>
                )}
              </div>

              {/* Staging Area (below diff) */}
              <StatusPanel repoPath={repoPath} onRefresh={loadRepoData} collapsed={stagingCollapsed} onToggleCollapse={onToggleStagingCollapse} />
            </>
          ) : (
            <>
              {/* Commit History Filters */}
              <CommitFilterBar
                filters={commitFilters}
                onFiltersChange={setCommitFilters}
                filePath={fileHistoryPath}
              />

              {/* Commit Graph */}
              <CommitGraph repoPath={repoPath} onRefresh={loadRepoData} onCommitSelect={onCommitSelect} filters={graphFilters} />

              {/* Staging Area (below graph) */}
              <StatusPanel repoPath={repoPath} onRefresh={loadRepoData} collapsed={stagingCollapsed} onToggleCollapse={onToggleStagingCollapse} />
            </>
          )}

          {/* Blame View */}
          {blameFilePath && (
            <div className={blameStyles.viewPanel}>
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
          <div className={editorStyles.editorToggleBar}>
            <button
              className={`${editorStyles.editorToggleBtn} ${showEditor ? editorStyles.editorToggleBtnActive : ''}`}
              onClick={() => setShowEditor((prev) => !prev)}
              title="Toggle Code Editor"
            >
              <FileText size={14} /> Editor {showEditor ? '(hide)' : '(show)'}
            </button>
          </div>
          {showEditor && (
            <div className={editorStyles.codeEditorPanel}>
              <CodeEditor repoPath={repoPath} onFileSaved={loadRepoData} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
