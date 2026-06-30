import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowLeft, FileCode, GitCompare, Pencil } from 'lucide-react'
import styles from './RepoView.module.css'
import { RepoViewSkeleton } from './Skeleton'
import blameStyles from './BlameView.module.css'
import conflictStyles from './ConflictResolver.module.css'
import { BlameView } from './BlameView'
import { CommitFilterBar, CommitFilters, EMPTY_FILTERS, hasActiveFilters } from './CommitFilterBar'
import { CommitGraph, CommitLogFilters, CommitDetail } from './CommitGraph'
import { ConflictResolver } from './ConflictResolver'
// StatusPanel moved to right panel in AppLayout
import { DiffViewer, FullDiffView, SyntaxHighlightedContent, RangeHighlightedContent, detectLanguage, type DiffViewMode } from './DiffViewer'
import { Columns } from 'lucide-react'
import { CodeEditor, openFileInEditor } from './CodeEditor'
import { defineShortcut, useKeyboardShortcuts, useShortcutHandler } from '../hooks/useKeyboardShortcuts'
import { FindWidget } from './FindWidget'
import { FullFileEditableView } from './FullFileEditableView'
import { useFindController } from '../hooks/useFindController'
import { useSelectionHighlight } from '../hooks/useSelectionHighlight'
import { type HighlightRange } from '../utils/textHighlight'
import { shouldShowLoadingSpinner } from './loadingDecision'
import { clampRestoreScrollTop } from './scrollPreserve'
import { isOpenFileAffected } from './repoChangeFilter'

interface RepoViewProps {
  repoPath: string
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
  // Working-tree file selected in StatusPanel — shown in the main center viewer
  workingTreeFile?: { path: string; staged: boolean; isUntracked: boolean } | null
  onCloseWorkingTreeFile?: () => void
  onNotify?: (type: 'success' | 'error' | 'warning' | 'info', message: string, details?: string) => void
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

/**
 * Build a unified-diff string for an untracked file, framed as `/dev/null` →
 * `b/<path>` with every line marked `+`. Mirrors what `git diff` would emit
 * for a newly-added file so the regular diff parser renders it correctly.
 */
function synthesizeNewFileDiff(path: string, content: string): string {
  const header = [
    `diff --git a/${path} b/${path}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${path}`
  ]
  if (content.includes('\0')) {
    return [...header, `Binary files /dev/null and b/${path} differ`, ''].join('\n')
  }
  if (content.length === 0) {
    return header.slice(0, 3).concat('').join('\n')
  }
  const hasTrailingNewline = content.endsWith('\n')
  const rawLines = content.split('\n')
  const bodyLines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines
  const plusLines = bodyLines.map((l) => '+' + l)
  if (!hasTrailingNewline) plusLines.push('\\ No newline at end of file')
  return [
    ...header,
    `@@ -0,0 +1,${bodyLines.length} @@`,
    ...plusLines,
    ''
  ].join('\n')
}

export function RepoView({ repoPath, onCommitSelect, onTwoCommitSelect, onRepoLoaded, viewingDiff, diffFile, diffCommitHash, selectedCommit, onBackToGraph, onNavigateFile, diffViewMode, onDiffViewModeChange, showBranchLabels, commitHistoryDepth, workingTreeFile, onCloseWorkingTreeFile, onNotify }: RepoViewProps): React.JSX.Element {
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
  // New/untracked files produce a valid diff with `--- /dev/null` and every
  // line marked added, so the user's persisted choice is honored for every
  // file regardless of status.
  const centerViewMode: 'diff' | 'full' | 'file' =
    diffViewMode === 'full' ? 'full' : diffViewMode === 'file' ? 'file' : 'diff'
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

  // Syntax-highlighting language for the file view in either branch
  // (working-tree file vs. commit-diff file).
  const workingTreeFileLanguage = useMemo(
    () => (workingTreeFile ? detectLanguage(workingTreeFile.path) : null),
    [workingTreeFile]
  )
  const diffFileLanguage = useMemo(
    () => (diffFile ? detectLanguage(diffFile) : null),
    [diffFile]
  )

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
  // Identity = path|staged|untracked. A change means a DIFFERENT file/version is
  // open → show the spinner. A bare refreshKey bump keeps the same identity →
  // fetch silently and swap content in place (no flash; react-window keeps scroll).
  const workingTreeIdentity = useMemo(
    () => (workingTreeFile ? `${workingTreeFile.path}|${workingTreeFile.staged}|${workingTreeFile.isUntracked}` : null),
    [workingTreeFile]
  )
  const diffIdentityRef = useRef<string | null>(null)
  const fileIdentityRef = useRef<string | null>(null)
  const workingTreeFileRef = useRef(workingTreeFile)
  workingTreeFileRef.current = workingTreeFile
  const fullIdentityRef = useRef<string | null>(null)
  const fileViewScrollRef = useRef<HTMLDivElement>(null)
  const pendingFileScrollRef = useRef<number | null>(null)
  // Mirror refs: read "do we have content?" inside loaders WITHOUT putting the
  // content state in their deps (that would loop the silent re-fetch).
  const workingTreeDiffRef = useRef(workingTreeDiff)
  workingTreeDiffRef.current = workingTreeDiff
  const fileContentRef = useRef(fileContent)
  fileContentRef.current = fileContent
  const fullReadyRef = useRef(false)
  fullReadyRef.current = fullOldContent !== null && fullNewContent !== null
  // Inline editor toggle — swaps the working-tree diff viewer for the Monaco
  // editor on the same file. Reset whenever the selected file changes so
  // switching files always lands you on the diff first.
  const [editingWorkingTree, setEditingWorkingTree] = useState(false)
  const [editorDirty, setEditorDirty] = useState(false)
  // Honors `working-tree:enter-edit-mode` requests (e.g. from the search
  // palette). The request is queued because workingTreeFile is set in the
  // same tick — we wait a render until the path catches up, then trigger.
  const [editRequestPath, setEditRequestPath] = useState<string | null>(null)
  // Tracks the last path we asked CodeEditor to open. Lets us dispatch
  // editor:open-file from a post-commit effect (so the listener exists)
  // without redispatching on every unrelated re-render.
  const lastOpenedEditorPathRef = useRef<string | null>(null)
  useEffect(() => {
    setEditingWorkingTree(false)
  }, [workingTreeFile?.path])
  const enterEditMode = useCallback(() => {
    if (!workingTreeFile) return
    setEditingWorkingTree(true)
  }, [workingTreeFile])
  // Open the file once CodeEditor is actually mounted. Dispatching the event
  // synchronously alongside setEditingWorkingTree(true) loses it because the
  // listener doesn't register until after React commits.
  useEffect(() => {
    if (editingWorkingTree && workingTreeFile) {
      const fullPath = `${repoPath}/${workingTreeFile.path}`
      if (lastOpenedEditorPathRef.current !== fullPath) {
        lastOpenedEditorPathRef.current = fullPath
        openFileInEditor(fullPath)
      }
    } else if (!editingWorkingTree) {
      lastOpenedEditorPathRef.current = null
    }
  }, [editingWorkingTree, workingTreeFile, repoPath])
  useEffect(() => {
    const handler = (e: Event): void => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path
      if (path) setEditRequestPath(path)
    }
    window.addEventListener('working-tree:enter-edit-mode', handler)
    return () => window.removeEventListener('working-tree:enter-edit-mode', handler)
  }, [])
  useEffect(() => {
    if (editRequestPath && workingTreeFile?.path === editRequestPath) {
      enterEditMode()
      setEditRequestPath(null)
    }
  }, [editRequestPath, workingTreeFile, enterEditMode])
  // Guard exit from edit mode if there are unsaved edits.
  const exitEditMode = useCallback(() => {
    if (editorDirty) {
      const ok = window.confirm(
        'You have unsaved changes in the editor. Discard them and return to the diff view?'
      )
      if (!ok) return
    }
    setEditingWorkingTree(false)
  }, [editorDirty])
  const handleEditorFileSaved = useCallback(() => {
    setWorkingTreeRefreshKey((k) => k + 1)
  }, [])

  // ─── Find (Ctrl+F) in the custom text/diff views ──────────────────────────
  // Owned here so a single Find widget is shared by whichever diff view is
  // mounted. Disabled while the Monaco editor is up (editingWorkingTree) so
  // Monaco keeps its own native Ctrl+F find.
  const [findOpen, setFindOpen] = useState(false)
  const stableOpenFind = useShortcutHandler(() => setFindOpen(true))
  const findShortcuts = useMemo(
    () => [
      defineShortcut(
        'find-in-view',
        'Find',
        'View',
        'Ctrl+F',
        { ctrl: true, key: 'f' },
        stableOpenFind,
        !editingWorkingTree
      )
    ],
    [stableOpenFind, editingWorkingTree]
  )
  useKeyboardShortcuts(findShortcuts)
  // Close Find when the view mode or selected working-tree file changes.
  useEffect(() => {
    setFindOpen(false)
  }, [centerViewMode, workingTreeFile?.path])

  // ─── File View Find (non-virtualized) ──────────────────────────────────────
  const [fileViewFindQuery, setFileViewFindQuery] = useState('')
  const [fileViewFindCase, setFileViewFindCase] = useState(false)
  const [fileViewFindWord, setFileViewFindWord] = useState(false)
  const fileViewFindOpts = useMemo(
    () => ({ caseSensitive: fileViewFindCase, wholeWord: fileViewFindWord }),
    [fileViewFindCase, fileViewFindWord]
  )
  const fileLineModel = useMemo(
    () => (fileContent ?? '').split('\n').map((text) => ({ text })),
    [fileContent]
  )
  const fileFind = useFindController(
    fileLineModel,
    centerViewMode === 'file' && findOpen && !blameFilePath ? fileViewFindQuery : '',
    fileViewFindOpts
  )
  const fileRangesByLine = useMemo(() => {
    const map = new Map<number, HighlightRange[]>()
    fileFind.matches.forEach((m, i) => {
      const cls = i === fileFind.currentIndex ? 'findMatchCurrent' : 'findMatch'
      const arr = map.get(m.lineIndex) ?? []
      arr.push({ ...m, className: cls })
      map.set(m.lineIndex, arr)
    })
    return map
  }, [fileFind.matches, fileFind.currentIndex])
  useEffect(() => {
    if (!findOpen || centerViewMode !== 'file' || !!blameFilePath) return
    const cur = fileFind.matches[fileFind.currentIndex]
    if (!cur) return
    fileViewScrollRef.current
      ?.querySelector(`[data-find-line="${cur.lineIndex}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [findOpen, centerViewMode, blameFilePath, fileFind.currentIndex, fileFind.matches])

  // ─── File View selection highlight (Part 4) — mutually exclusive with Find ──
  // Enabled only while the (non-virtualized) File view is actually showing and
  // Find is closed, so the document `selectionchange` listener is scoped to it.
  const fileSelHl = useSelectionHighlight(
    fileLineModel,
    fileViewScrollRef,
    !findOpen && centerViewMode === 'file' && !blameFilePath
  )
  const fileSelByLine = useMemo(() => {
    const map = new Map<number, HighlightRange[]>()
    for (const r of fileSelHl) {
      const arr = map.get(r.lineIndex) ?? []
      arr.push({ ...r, className: 'selectionHighlight' })
      map.set(r.lineIndex, arr)
    }
    return map
  }, [fileSelHl])

  useEffect(() => {
    if (!workingTreeFile) {
      setWorkingTreeDiff(null)
      setWorkingTreeDiffError(null)
      return
    }
    let cancelled = false
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== diffIdentityRef.current,
      hasCurrentContent: workingTreeDiffRef.current !== null
    })
    if (showSpinner) setWorkingTreeDiffLoading(true)
    setWorkingTreeDiffError(null)

    // Untracked files aren't tracked by git yet, so `git diff` returns nothing.
    // Synthesize a "new file" unified diff from disk content so every view
    // (Diff / Full / File) can render every line as added.
    const loader: Promise<{ success: boolean; data?: unknown; error?: string }> =
      workingTreeFile.isUntracked
        ? window.electronAPI.file.read(`${repoPath}/${workingTreeFile.path}`).then((r) => {
            if (!r.success || typeof r.data !== 'string') return r
            return { success: true, data: synthesizeNewFileDiff(workingTreeFile.path, r.data) }
          })
        : window.electronAPI.git.diff(repoPath, workingTreeFile.path, { staged: workingTreeFile.staged })

    loader
      .then((result) => {
        if (cancelled) return
        if (result.success && typeof result.data === 'string' && result.data.length > 0) {
          setWorkingTreeDiff(result.data as string)
        } else if (result.success) {
          setWorkingTreeDiff('(No changes to display)')
        } else {
          setWorkingTreeDiffError(result.error || 'Failed to load diff')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setWorkingTreeDiffError(err instanceof Error ? err.message : 'Failed to load diff')
      })
      .finally(() => {
        if (!cancelled) {
          setWorkingTreeDiffLoading(false)
          diffIdentityRef.current = workingTreeIdentity
        }
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

    // Two-commit comparison mode: diffCommitHash is "comparison:hashFrom..hashTo"
    const compMatch = diffCommitHash.match(/^comparison:([a-f0-9]+)\.\.([a-f0-9]+)$/)
    const diffPromise = compMatch
      ? window.electronAPI.git.diffTwoCommitsFile(repoPath, compMatch[1], compMatch[2], diffFile)
      : (() => {
          const isMerge = selectedCommit?.commit?.parentHashes && selectedCommit.commit.parentHashes.length > 1
          return window.electronAPI.git.showCommitFileDiff(repoPath, diffCommitHash, diffFile, { isMerge: !!isMerge })
        })()

    diffPromise
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

    // For comparison mode, show file at the "to" commit
    const compMatch = diffCommitHash.match(/^comparison:([a-f0-9]+)\.\.([a-f0-9]+)$/)
    const effectiveHash = compMatch ? compMatch[2] : diffCommitHash

    window.electronAPI.git.showFileAtCommit(repoPath, effectiveHash, diffFile)
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

    // For comparison mode, use the from/to commits directly
    const compMatch = diffCommitHash.match(/^comparison:([a-f0-9]+)\.\.([a-f0-9]+)$/)
    const oldPromise = compMatch
      ? window.electronAPI.git.showFileAtCommit(repoPath, compMatch[1], diffFile)
      : window.electronAPI.git.showFileAtParent(repoPath, diffCommitHash, diffFile)
    const newPromise = compMatch
      ? window.electronAPI.git.showFileAtCommit(repoPath, compMatch[2], diffFile)
      : window.electronAPI.git.showFileAtCommit(repoPath, diffCommitHash, diffFile)

    Promise.all([oldPromise, newPromise])
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
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== fileIdentityRef.current,
      hasCurrentContent: fileContentRef.current !== null
    })
    if (showSpinner) setFileLoading(true)
    else pendingFileScrollRef.current = fileViewScrollRef.current?.scrollTop ?? null
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
        if (!cancelled) {
          setFileLoading(false)
          fileIdentityRef.current = workingTreeIdentity
        }
      })
    return () => { cancelled = true }
  }, [centerViewMode, workingTreeFile, repoPath, workingTreeRefreshKey])

  // Safety net: after a silent File-view swap, restore the captured scroll offset
  // (clamped to the new content height). No-op for first loads (pending == null).
  useLayoutEffect(() => {
    const el = fileViewScrollRef.current
    const target = pendingFileScrollRef.current
    if (el && target != null) {
      el.scrollTop = clampRestoreScrollTop(target, el.scrollHeight - el.clientHeight)
    }
    pendingFileScrollRef.current = null
  }, [fileContent])

  // ─── Working-Tree Full Diff Loader ──────────────────────────────────────
  // Loads old + new file contents for side-by-side highlighted view:
  //   staged    → old = HEAD,  new = index
  //   unstaged  → old = index, new = working tree (disk)
  //   untracked → old = '',    new = working tree (disk)
  useEffect(() => {
    if (centerViewMode !== 'full' || !workingTreeFile) return
    let cancelled = false
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== fullIdentityRef.current,
      hasCurrentContent: fullReadyRef.current
    })
    if (showSpinner) {
      setFullLoading(true)
      setFullOldContent(null)
      setFullNewContent(null)
    }
    setFullError(null)

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
        if (!cancelled) {
          setFullLoading(false)
          fullIdentityRef.current = workingTreeIdentity
        }
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

  useEffect(() => {
    const cleanup = window.electronAPI.onRepoChanged?.((changedPaths) => {
      window.electronAPI.git.getConflictedFiles(repoPath).then((result) => {
        if (result.success && Array.isArray(result.data)) {
          const nowHasConflicts = result.data.length > 0
          setHasConflicts(nowHasConflicts)
          if (!nowHasConflicts) setShowConflictResolver(false)
        }
      })
      // Path-aware center refresh: only re-run the working-tree loaders when the
      // file open in the center view actually changed (or scope is unknown).
      const open = workingTreeFileRef.current
      if (open && isOpenFileAffected(open.path, open.staged, changedPaths)) {
        setWorkingTreeRefreshKey((k) => k + 1)
      }
    })
    return () => { cleanup?.() }
  }, [repoPath])

  // Handlers for hunk-level staging from the center DiffViewer. Each receives
  // a ready-to-apply git patch built by DiffViewer itself.
  const handleStageHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.stageHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    } else {
      alert(`Stage failed: ${result.error}`)
    }
  }, [repoPath, workingTreeFile, loadRepoData])

  const handleUnstageHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    } else {
      alert(`Unstage failed: ${result.error}`)
    }
  }, [repoPath, workingTreeFile, loadRepoData])

  const handleDiscardHunk = useCallback(async (patch: string) => {
    if (!workingTreeFile) return
    const result = await window.electronAPI.git.discardHunk(repoPath, patch)
    if (result.success) {
      setWorkingTreeRefreshKey((k) => k + 1)
      loadRepoData()
    } else {
      alert(`Discard failed: ${result.error}`)
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

          {/* Commit Graph — always mounted so scroll position, selection, and
              other view state are preserved when the user opens a diff and
              clicks back. Hidden via display:none (not unmounted) whenever a
              diff view is active. */}
          <div
            className={styles.graphBranch}
            style={{
              display:
                workingTreeFile || (viewingDiff && diffFile && diffCommitHash)
                  ? 'none'
                  : undefined
            }}
          >
            <CommitFilterBar
              filters={commitFilters}
              onFiltersChange={setCommitFilters}
              filePath={fileHistoryPath}
            />
            <CommitGraph repoPath={repoPath} onRefresh={loadRepoData} onCommitSelect={onCommitSelect} onTwoCommitSelect={onTwoCommitSelect} onLoadComplete={onRepoLoaded} filters={graphFilters} showBranchLabels={showBranchLabels} maxCommits={commitHistoryDepth} onNotify={onNotify} />
          </div>

          {/* Center-Stage Diff View OR Working-Tree Diff */}
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
                {editingWorkingTree ? (
                  <button
                    className={styles.editFileBtn}
                    onClick={exitEditMode}
                    title={editorDirty ? 'Unsaved changes — confirm before leaving' : 'Return to diff view'}
                  >
                    <ArrowLeft size={13} />
                    {editorDirty ? 'Back to Diff •' : 'Back to Diff'}
                  </button>
                ) : (
                  <>
                    <button
                      className={styles.editFileBtn}
                      onClick={enterEditMode}
                      title="Edit this file in GitSlop"
                    >
                      <Pencil size={13} />
                      Edit this file
                    </button>
                    <div className={styles.viewModeToggle}>
                      <button
                        className={`${styles.viewModeBtn} ${centerViewMode === 'diff' ? styles.viewModeBtnActive : ''}`}
                        onClick={() => setCenterViewMode('diff')}
                        title="View diff"
                      >
                        <GitCompare size={13} />
                        Diff
                      </button>
                      <button
                        className={`${styles.viewModeBtn} ${centerViewMode === 'full' ? styles.viewModeBtnActive : ''}`}
                        onClick={() => setCenterViewMode('full')}
                        title="View full files side-by-side with diff highlights"
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
                  </>
                )}
              </div>

              {/* Inline editor (working-tree only) */}
              {editingWorkingTree && (
                <div className={styles.centerDiffContainer}>
                  <CodeEditor
                    repoPath={repoPath}
                    onFileSaved={handleEditorFileSaved}
                    onDirtyChange={setEditorDirty}
                  />
                </div>
              )}

              {/* Diff view */}
              {!editingWorkingTree && centerViewMode === 'diff' && (
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
                      findOpen={findOpen}
                      onCloseFind={() => setFindOpen(false)}
                    />
                  )}
                </div>
              )}

              {/* Full diff view (old + new side-by-side with highlights) */}
              {!editingWorkingTree && centerViewMode === 'full' && (
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
                      findOpen={findOpen}
                      onCloseFind={() => setFindOpen(false)}
                    />
                  )}
                </div>
              )}

              {/* Full file content */}
              {!editingWorkingTree && centerViewMode === 'file' && (
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
                    <div className={styles.fullFileViewer} ref={fileViewScrollRef}>
                      {findOpen && !blameFilePath && (
                        <FindWidget
                          query={fileViewFindQuery}
                          onQueryChange={setFileViewFindQuery}
                          caseSensitive={fileViewFindCase}
                          wholeWord={fileViewFindWord}
                          onToggleCase={() => setFileViewFindCase((v) => !v)}
                          onToggleWholeWord={() => setFileViewFindWord((v) => !v)}
                          count={fileFind.count}
                          currentIndex={fileFind.currentIndex}
                          onNext={fileFind.next}
                          onPrev={fileFind.prev}
                          onClose={() => setFindOpen(false)}
                        />
                      )}
                      <FullFileEditableView
                        fileContent={fileContent}
                        language={workingTreeFileLanguage}
                        absPath={`${repoPath}/${workingTreeFile.path}`}
                        editable={!workingTreeFile.staged}
                        onSaved={handleEditorFileSaved}
                        findOpen={findOpen}
                        rangesByLine={fileRangesByLine}
                        selByLine={fileSelByLine}
                      />
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
                  <code className={styles.diffBackHash}>{
                    diffCommitHash.startsWith('comparison:')
                      ? diffCommitHash.replace(/^comparison:/, '').replace(/([a-f0-9]{7})[a-f0-9]*\.\.([a-f0-9]{7})[a-f0-9]*/, '$1..$2')
                      : diffCommitHash.substring(0, 7)
                  }</code>
                  {' / '}
                  {diffFile}
                </span>
                <div className={styles.viewModeToggle}>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'diff' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('diff')}
                    title="View diff"
                  >
                    <GitCompare size={13} />
                    Diff
                  </button>
                  <button
                    className={`${styles.viewModeBtn} ${centerViewMode === 'full' ? styles.viewModeBtnActive : ''}`}
                    onClick={() => setCenterViewMode('full')}
                    title="View full files side-by-side with diff highlights"
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
                        findOpen={findOpen}
                        onCloseFind={() => setFindOpen(false)}
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
                        findOpen={findOpen}
                        onCloseFind={() => setFindOpen(false)}
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
                    <div className={styles.fullFileViewer} ref={fileViewScrollRef}>
                      {findOpen && !blameFilePath && (
                        <FindWidget
                          query={fileViewFindQuery}
                          onQueryChange={setFileViewFindQuery}
                          caseSensitive={fileViewFindCase}
                          wholeWord={fileViewFindWord}
                          onToggleCase={() => setFileViewFindCase((v) => !v)}
                          onToggleWholeWord={() => setFileViewFindWord((v) => !v)}
                          count={fileFind.count}
                          currentIndex={fileFind.currentIndex}
                          onNext={fileFind.next}
                          onPrev={fileFind.prev}
                          onClose={() => setFindOpen(false)}
                        />
                      )}
                      <pre className={styles.fullFilePre}>
                        <code>{fileContent.split('\n').map((line, i) => (
                          <div key={i} data-find-line={i} className={styles.fullFileLine}>
                            <span className={styles.fullFileLineNum}>{i + 1}</span>
                            <span className={styles.fullFileLineContent}>
                              <RangeHighlightedContent text={line} language={diffFileLanguage} ranges={findOpen ? (fileRangesByLine.get(i) ?? []) : (fileSelByLine.get(i) ?? [])} baseClass={findOpen ? 'findMatch' : 'selectionHighlight'} />
                            </span>
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
          ) : null}

          {/* Blame View */}
          {blameFilePath && (
            <div className={blameStyles.viewPanel}>
              <BlameView
                repoPath={repoPath}
                filePath={blameFilePath}
                onClose={() => setBlameFilePath(null)}
                findOpen={findOpen}
                onCloseFind={() => setFindOpen(false)}
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
