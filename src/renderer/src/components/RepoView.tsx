import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, FileCode, GitCompare } from 'lucide-react'
import styles from './RepoView.module.css'
import { RepoViewSkeleton } from './Skeleton'
import blameStyles from './BlameView.module.css'
import conflictStyles from './ConflictResolver.module.css'
import { BlameView } from './BlameView'
import { CommitFilterBar, CommitFilters, EMPTY_FILTERS, hasActiveFilters } from './CommitFilterBar'
import { CommitGraph, CommitLogFilters, CommitDetail } from './CommitGraph'
import { ConflictResolver } from './ConflictResolver'
// StatusPanel moved to right panel in AppLayout
import { DiffViewer, FullDiffView, type DiffViewMode } from './DiffViewer'
import { Columns } from 'lucide-react'

interface RepoViewProps {
  repoPath: string
  onCommitSelect?: (detail: CommitDetail | null) => void
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
  // Working-tree file selected in StatusPanel — shown in the main center viewer
  workingTreeFile?: { path: string; staged: boolean; isUntracked: boolean } | null
  onCloseWorkingTreeFile?: () => void
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

export function RepoView({ repoPath, onCommitSelect, onRepoLoaded, viewingDiff, diffFile, diffCommitHash, selectedCommit, onBackToGraph, onNavigateFile, diffViewMode, onDiffViewModeChange, showBranchLabels, commitHistoryDepth, workingTreeFile, onCloseWorkingTreeFile }: RepoViewProps): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showConflictResolver, setShowConflictResolver] = useState(false)
  const [hasConflicts, setHasConflicts] = useState(false)
  const [blameFilePath, setBlameFilePath] = useState<string | null>(null)
  const [commitFilters, setCommitFilters] = useState<CommitFilters>(EMPTY_FILTERS)
  const [fileHistoryPath, setFileHistoryPath] = useState<string | undefined>(undefined)

  // ─── Center-Stage Diff Loading ───────────────────────────────────────────
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  // ─── Full File View ─────────────────────────────────────────────────────
  // Derive centerViewMode from persisted diffViewMode, but force File view
  // for files that have no diff to show:
  //   - status 'A' (newly added) — there's no parent version to diff against
  //     so the Diff and Full views would render blank. The actual content
  //     only exists in File view.
  //   - working-tree untracked files — same reason.
  // This override is DERIVED, not persisted — the user's saved view-mode
  // preference is untouched, so the next click on a modified file returns
  // to whatever mode they last selected.
  const currentFileDetail = selectedCommit?.fileDetails?.find((f) => f.path === diffFile)
  const noDiffForCurrentFile =
    currentFileDetail?.status === 'A' ||
    (workingTreeFile?.isUntracked ?? false)
  const persistedCenterView: 'diff' | 'full' | 'file' =
    diffViewMode === 'full' ? 'full' : diffViewMode === 'file' ? 'file' : 'diff'
  const centerViewMode: 'diff' | 'full' | 'file' = noDiffForCurrentFile ? 'file' : persistedCenterView
  // Track last-used diff sub-mode (inline/side-by-side) so we can restore it when switching back to diff
  const lastDiffSubMode = useRef<'inline' | 'side-by-side'>((diffViewMode === 'inline' || diffViewMode === 'side-by-side') ? diffViewMode : 'inline')
  // Keep lastDiffSubMode up to date
  if (diffViewMode === 'inline' || diffViewMode === 'side-by-side') {
    lastDiffSubMode.current = diffViewMode
  }
  const setCenterViewMode = useCallback((mode: 'diff' | 'full' | 'file') => {
    if (mode === 'diff') {
      onDiffViewModeChange?.(lastDiffSubMode.current)
    } else if (mode === 'full') {
      onDiffViewModeChange?.('full')
    } else {
      onDiffViewModeChange?.('file')
    }
  }, [onDiffViewModeChange])
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  // ─── Full Diff View (old + new file content) ───────────────────────────
  const [fullOldContent, setFullOldContent] = useState<string | null>(null)
  const [fullNewContent, setFullNewContent] = useState<string | null>(null)
  const [fullLoading, setFullLoading] = useState(false)
  const [fullError, setFullError] = useState<string | null>(null)

  // ─── Working-Tree File Diff (staged/unstaged/untracked) ─────────────────
  const [workingTreeDiff, setWorkingTreeDiff] = useState<string | null>(null)
  const [workingTreeDiffLoading, setWorkingTreeDiffLoading] = useState(false)
  const [workingTreeDiffError, setWorkingTreeDiffError] = useState<string | null>(null)
  const [workingTreeRefreshKey, setWorkingTreeRefreshKey] = useState(0)

  useEffect(() => {
    if (!workingTreeFile) {
      setWorkingTreeDiff(null)
      setWorkingTreeDiffError(null)
      return
    }
    let cancelled = false
    setWorkingTreeDiffLoading(true)
    setWorkingTreeDiffError(null)
    window.electronAPI.git
      .diff(repoPath, workingTreeFile.path, { staged: workingTreeFile.staged })
      .then((result) => {
        if (cancelled) return
        if (result.success && typeof result.data === 'string' && result.data.length > 0) {
          setWorkingTreeDiff(result.data as string)
        } else if (result.success) {
          setWorkingTreeDiff(
            workingTreeFile.isUntracked
              ? `(New untracked file: ${workingTreeFile.path})`
              : '(No changes to display)'
          )
        } else {
          setWorkingTreeDiffError(result.error || 'Failed to load diff')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setWorkingTreeDiffError(err instanceof Error ? err.message : 'Failed to load diff')
      })
      .finally(() => {
        if (!cancelled) setWorkingTreeDiffLoading(false)
      })
    return () => { cancelled = true }
  }, [workingTreeFile, repoPath, workingTreeRefreshKey])

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

  // Reset file content caches when file changes (but keep the persisted view mode)
  useEffect(() => {
    setFileContent(null)
    setFileError(null)
    setFullOldContent(null)
    setFullNewContent(null)
    setFullError(null)
  }, [diffFile, diffCommitHash, workingTreeFile])

  // Load full file content when switching to file view
  useEffect(() => {
    if (centerViewMode !== 'file' || !diffFile || !diffCommitHash) {
      return
    }
    let cancelled = false
    setFileLoading(true)
    setFileError(null)
    window.electronAPI.git.showFileAtCommit(repoPath, diffCommitHash, diffFile)
      .then((result) => {
        if (cancelled) return
        if (result.success && typeof result.data === 'string') {
          // Detect binary content (null bytes indicate binary)
          if (result.data.includes('\0')) {
            setFileError('Binary file — cannot display')
          } else {
            setFileContent(result.data)
          }
        } else {
          setFileError(result.error || 'Failed to load file content')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFileError(err instanceof Error ? err.message : 'Failed to load file content')
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })
    return () => { cancelled = true }
  }, [centerViewMode, diffFile, diffCommitHash, repoPath])

  // Load old + new file content when switching to full diff view
  useEffect(() => {
    if (centerViewMode !== 'full' || !diffFile || !diffCommitHash) {
      return
    }
    let cancelled = false
    setFullLoading(true)
    setFullError(null)
    setFullOldContent(null)
    setFullNewContent(null)

    Promise.all([
      window.electronAPI.git.showFileAtParent(repoPath, diffCommitHash, diffFile),
      window.electronAPI.git.showFileAtCommit(repoPath, diffCommitHash, diffFile)
    ])
      .then(([oldResult, newResult]) => {
        if (cancelled) return
        // Old content: may fail for new files — treat as empty
        if (oldResult.success && typeof oldResult.data === 'string') {
          if (oldResult.data.includes('\0')) {
            setFullError('Binary file — cannot display')
            return
          }
          setFullOldContent(oldResult.data)
        } else {
          setFullOldContent('') // New file — no old content
        }
        // New content: may be empty for deleted files
        if (newResult.success && typeof newResult.data === 'string') {
          if (newResult.data.includes('\0')) {
            setFullError('Binary file — cannot display')
            return
          }
          setFullNewContent(newResult.data)
        } else {
          setFullNewContent('') // Deleted file — no new content
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFullError(err instanceof Error ? err.message : 'Failed to load file content')
      })
      .finally(() => {
        if (!cancelled) setFullLoading(false)
      })
    return () => { cancelled = true }
  }, [centerViewMode, diffFile, diffCommitHash, repoPath])

  // ─── Working-Tree File View Loader ──────────────────────────────────────
  // Loads the "new" side of a working-tree file:
  //   staged    → git show :<path>      (index version)
  //   unstaged  → <repoPath>/<path>     (disk, current working tree)
  //   untracked → <repoPath>/<path>     (disk)
  useEffect(() => {
    if (centerViewMode !== 'file' || !workingTreeFile) return
    let cancelled = false
    setFileLoading(true)
    setFileError(null)

    const loader = workingTreeFile.staged
      ? window.electronAPI.git.showFileAtCommit(repoPath, '', workingTreeFile.path)
      : window.electronAPI.file.read(`${repoPath}/${workingTreeFile.path}`)

    loader
      .then((result) => {
        if (cancelled) return
        if (result.success && typeof result.data === 'string') {
          if (result.data.includes('\0')) {
            setFileError('Binary file — cannot display')
          } else {
            setFileContent(result.data)
          }
        } else {
          setFileError(result.error || 'Failed to load file content')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFileError(err instanceof Error ? err.message : 'Failed to load file content')
      })
      .finally(() => {
        if (!cancelled) setFileLoading(false)
      })
    return () => { cancelled = true }
  }, [centerViewMode, workingTreeFile, repoPath, workingTreeRefreshKey])

  // ─── Working-Tree Full Diff Loader ──────────────────────────────────────
  // Loads old + new file contents for side-by-side highlighted view:
  //   staged    → old = HEAD,  new = index
  //   unstaged  → old = index, new = working tree (disk)
  //   untracked → old = '',    new = working tree (disk)
  useEffect(() => {
    if (centerViewMode !== 'full' || !workingTreeFile) return
    let cancelled = false
    setFullLoading(true)
    setFullError(null)
    setFullOldContent(null)
    setFullNewContent(null)

    const { path, staged, isUntracked } = workingTreeFile

    // Resolve old-content source
    const oldLoader: Promise<{ success: boolean; data?: string; error?: string }> = isUntracked
      ? Promise.resolve({ success: true, data: '' })
      : staged
        ? window.electronAPI.git.showFileAtCommit(repoPath, 'HEAD', path)
        : window.electronAPI.git.showFileAtCommit(repoPath, '', path) // index

    // Resolve new-content source
    const newLoader: Promise<{ success: boolean; data?: string; error?: string }> = staged
      ? window.electronAPI.git.showFileAtCommit(repoPath, '', path) // index
      : window.electronAPI.file.read(`${repoPath}/${path}`) // disk

    Promise.all([oldLoader, newLoader])
      .then(([oldResult, newResult]) => {
        if (cancelled) return
        if (oldResult.success && typeof oldResult.data === 'string') {
          if (oldResult.data.includes('\0')) {
            setFullError('Binary file — cannot display')
            return
          }
          setFullOldContent(oldResult.data)
        } else {
          setFullOldContent('')
        }
        if (newResult.success && typeof newResult.data === 'string') {
          if (newResult.data.includes('\0')) {
            setFullError('Binary file — cannot display')
            return
          }
          setFullNewContent(newResult.data)
        } else {
          setFullNewContent('')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setFullError(err instanceof Error ? err.message : 'Failed to load file content')
      })
      .finally(() => {
        if (!cancelled) setFullLoading(false)
      })
    return () => { cancelled = true }
  }, [centerViewMode, workingTreeFile, repoPath, workingTreeRefreshKey])

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

  // Escape key returns from working-tree diff to graph
  useEffect(() => {
    if (!workingTreeFile) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseWorkingTreeFile?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [workingTreeFile, onCloseWorkingTreeFile])

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
      // On error, CommitGraph never mounts and can't signal completion,
      // so dismiss the tab-switch overlay here instead.
      onRepoLoaded?.()
    } finally {
      setLoading(false)
      initialLoadDone.current = true
    }
  }, [repoPath, onRepoLoaded])

  useEffect(() => {
    loadRepoData()
    window.electronAPI.watcher.start(repoPath)
    return () => {
      window.electronAPI.watcher.stop()
    }
  }, [loadRepoData, repoPath])

  // Handlers for hunk-level staging from the center DiffViewer. Each receives
  // a ready-to-apply git patch built by DiffViewer itself.
  const handleStageHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.stageHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    }
  }, [repoPath, workingTreeFile, loadRepoData])

  const handleUnstageHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    }
  }, [repoPath, workingTreeFile, loadRepoData])

  const handleDiscardHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.discardHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    }
  }, [repoPath, workingTreeFile, loadRepoData])

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

  return (
    <div className={styles.repoView}>
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

          {/* Center-Stage Diff View OR Working-Tree Diff OR Commit Graph */}
          {workingTreeFile ? (
            <>
              <div className={styles.diffBackBar}>
                <button className={styles.diffBackBtn} onClick={onCloseWorkingTreeFile}>
                  <ArrowLeft size={14} />
                  <span>Back to Graph</span>
                </button>
                <span className={styles.diffBackSeparator}>·</span>
                <span className={styles.diffBackPath}>
                  <code className={styles.diffBackHash}>
                    {workingTreeFile.staged ? 'STAGED' : workingTreeFile.isUntracked ? 'UNTRACKED' : 'UNSTAGED'}
                  </code>
                  {' / '}
                  {workingTreeFile.path}
                </span>
                <div className={styles.viewModeToggle}>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'diff' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('diff')}
                    disabled={noDiffForCurrentFile}
                    title={noDiffForCurrentFile ? 'No diff available for this file' : 'View diff'}
                  >
                    <GitCompare size={13} />
                    Diff
                  </button>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'full' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('full')}
                    disabled={noDiffForCurrentFile}
                    title={noDiffForCurrentFile ? 'No diff available for this file' : 'View full files side-by-side with diff highlights'}
                  >
                    <Columns size={13} />
                    Full
                  </button>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'file' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('file')}
                    title="View full file"
                  >
                    <FileCode size={13} />
                    File
                  </button>
                </div>
              </div>

              {/* Diff view */}
              {centerViewMode === 'diff' && (
                <div className={styles.centerDiffContainer}>
                  {workingTreeDiffLoading && (
                    <div className={styles.diffLoadingState}>Loading diff…</div>
                  )}
                  {workingTreeDiffError && (
                    <div className={styles.diffErrorState}>
                      <AlertTriangle size={14} /> {workingTreeDiffError}
                    </div>
                  )}
                  {!workingTreeDiffLoading && !workingTreeDiffError && workingTreeDiff !== null && (
                    <DiffViewer
                      diffContent={workingTreeDiff}
                      filePath={workingTreeFile.path}
                      initialMode={diffViewMode}
                      onModeChange={onDiffViewModeChange}
                      className={styles.centerDiffViewer}
                      stagingMode={
                        workingTreeFile.isUntracked
                          ? 'untracked'
                          : workingTreeFile.staged
                            ? 'staged'
                            : 'unstaged'
                      }
                      onStageHunk={handleStageHunk}
                      onUnstageHunk={handleUnstageHunk}
                      onDiscardHunk={handleDiscardHunk}
                    />
                  )}
                </div>
              )}

              {/* Full diff view (old + new side-by-side with highlights) */}
              {centerViewMode === 'full' && (
                <div className={styles.centerDiffContainer}>
                  {fullLoading && (
                    <div className={styles.diffLoadingState}>Loading full file comparison…</div>
                  )}
                  {fullError && (
                    <div className={styles.diffErrorState}>
                      <AlertTriangle size={14} /> {fullError}
                    </div>
                  )}
                  {!fullLoading && !fullError && fullOldContent !== null && fullNewContent !== null && workingTreeDiff !== null && (
                    <FullDiffView
                      oldContent={fullOldContent}
                      newContent={fullNewContent}
                      diffContent={workingTreeDiff}
                      filePath={workingTreeFile.path}
                      className={styles.centerDiffViewer}
                      fileStatus={workingTreeFile.isUntracked ? 'A' : 'M'}
                      stagingMode={
                        workingTreeFile.isUntracked
                          ? 'untracked'
                          : workingTreeFile.staged
                            ? 'staged'
                            : 'unstaged'
                      }
                      onStageHunk={handleStageHunk}
                      onUnstageHunk={handleUnstageHunk}
                      onDiscardHunk={handleDiscardHunk}
                    />
                  )}
                </div>
              )}

              {/* Full file content */}
              {centerViewMode === 'file' && (
                <div className={styles.centerDiffContainer}>
                  {fileLoading && (
                    <div className={styles.diffLoadingState}>Loading file…</div>
                  )}
                  {fileError && (
                    <div className={styles.diffErrorState}>
                      <AlertTriangle size={14} /> {fileError}
                    </div>
                  )}
                  {!fileLoading && !fileError && fileContent !== null && (
                    <div className={styles.fullFileViewer}>
                      <pre className={styles.fullFilePre}>
                        <code>{fileContent.split('\n').map((line, i) => (
                          <div key={i} className={styles.fullFileLine}>
                            <span className={styles.fullFileLineNum}>{i + 1}</span>
                            <span className={styles.fullFileLineContent}>{line}</span>
                          </div>
                        ))}</code>
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : viewingDiff && diffFile && diffCommitHash ? (
            <>
              {/* Back breadcrumb bar with Diff/File toggle */}
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
                <div className={styles.viewModeToggle}>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'diff' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('diff')}
                    disabled={noDiffForCurrentFile}
                    title={noDiffForCurrentFile ? 'No diff available for this file' : 'View diff'}
                  >
                    <GitCompare size={13} />
                    Diff
                  </button>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'full' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('full')}
                    disabled={noDiffForCurrentFile}
                    title={noDiffForCurrentFile ? 'No diff available for this file' : 'View full files side-by-side with diff highlights'}
                  >
                    <Columns size={13} />
                    Full
                  </button>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'file' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('file')}
                    title="View full file"
                  >
                    <FileCode size={13} />
                    File
                  </button>
                </div>
              </div>

              {/* Diff content */}
              {centerViewMode === 'diff' && (
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
                        initialMode={diffViewMode}
                        onModeChange={onDiffViewModeChange}
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
              )}

              {/* Full diff view (side-by-side complete files with highlights) */}
              {centerViewMode === 'full' && (
                <div className={styles.centerDiffContainer}>
                  {fullLoading && (
                    <div className={styles.diffLoadingState}>Loading full file comparison…</div>
                  )}
                  {fullError && (
                    <div className={styles.diffErrorState}>
                      <AlertTriangle size={14} /> {fullError}
                    </div>
                  )}
                  {!fullLoading && !fullError && fullOldContent !== null && fullNewContent !== null && diffContent !== null && (() => {
                    const fileDetail = selectedCommit?.fileDetails.find(f => f.path === diffFile)
                    return (
                      <FullDiffView
                        oldContent={fullOldContent}
                        newContent={fullNewContent}
                        diffContent={diffContent}
                        filePath={diffFile}
                        className={styles.centerDiffViewer}
                        fileStatus={fileDetail?.status}
                        oldPath={fileDetail?.oldPath}
                      />
                    )
                  })()}
                </div>
              )}

              {/* Full file content */}
              {centerViewMode === 'file' && (
                <div className={styles.centerDiffContainer}>
                  {fileLoading && (
                    <div className={styles.diffLoadingState}>Loading file…</div>
                  )}
                  {fileError && (
                    <div className={styles.diffErrorState}>
                      <AlertTriangle size={14} /> {fileError}
                    </div>
                  )}
                  {!fileLoading && !fileError && fileContent !== null && (
                    <div className={styles.fullFileViewer}>
                      <pre className={styles.fullFilePre}>
                        <code>{fileContent.split('\n').map((line, i) => (
                          <div key={i} className={styles.fullFileLine}>
                            <span className={styles.fullFileLineNum}>{i + 1}</span>
                            <span className={styles.fullFileLineContent}>{line}</span>
                          </div>
                        ))}</code>
                      </pre>
                    </div>
                  )}
                  {!fileLoading && !fileError && fileContent !== null && fileContent.length === 0 && (
                    <div className={styles.diffLoadingState}>Empty file</div>
                  )}
                </div>
              )}

              {/* Staging Area moved to right panel in AppLayout */}
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
              <CommitGraph repoPath={repoPath} onRefresh={loadRepoData} onCommitSelect={onCommitSelect} onLoadComplete={onRepoLoaded} filters={graphFilters} showBranchLabels={showBranchLabels} maxCommits={commitHistoryDepth} />

              {/* Staging Area moved to right panel in AppLayout */}
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

        </div>
      )}
    </div>
  )
}
