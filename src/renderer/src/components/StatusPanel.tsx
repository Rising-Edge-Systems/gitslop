import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilePlus, FileEdit, FileMinus, ArrowRightLeft, HelpCircle, X, Pencil, Clock, Plus, Minus, RefreshCw, Check, AlertTriangle, ChevronRight, ChevronDown, Trash2, Folder, FolderOpen, Copy } from 'lucide-react'
import { DiffViewer } from './DiffViewer'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { openFileInEditor } from './CodeEditor'
import { DEFAULT_SETTINGS, type AppSettings } from '../hooks/useSettings'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'
import type { FileListView } from '../hooks/useLayoutState'
import styles from './StatusPanel.module.css'

interface FileStatus {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored'
  staged: boolean
  indexStatus: string
  workTreeStatus: string
}

interface RepoStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: FileStatus[]
  unstaged: FileStatus[]
  untracked: FileStatus[]
}

export interface WorkingTreeFileSelection {
  path: string
  staged: boolean
  isUntracked: boolean
}

interface StatusPanelProps {
  repoPath: string
  onRefresh?: () => void
  stagingInternalSplit: number
  onStagingInternalSplitChange: (split: number) => void
  /**
   * When provided, StatusPanel delegates diff display to a parent component
   * (the main center diff viewer) instead of rendering its own embedded diff.
   * Called on single-click of a staged/unstaged/untracked file.
   */
  onFileSelect?: (selection: WorkingTreeFileSelection | null) => void
  /**
   * Externally-controlled selection used to highlight the active row when
   * selection state lives in a parent. When set, takes precedence over the
   * panel's internal selectedFile for row-highlight purposes.
   */
  externallySelectedFile?: WorkingTreeFileSelection | null
  /**
   * Called after a successful commit so the parent can clear any active
   * working-tree diff view and return to the commit graph.
   */
  onCommitSuccess?: () => void
  /** Current file list view mode (path or tree) */
  fileListView?: FileListView
}

// ─── CSS Module Lookup Maps ──────────────────────────────────────────────────

const hunkLineTypeClass: Record<string, string> = {
  added: styles.hunkLineAdded,
  removed: styles.hunkLineRemoved,
  context: styles.hunkLineContext
}

const STATUS_LABELS: Record<string, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  ignored: 'Ignored'
}

const iconClassMap: Record<string, string> = {
  added: styles.iconAdded,
  modified: styles.iconModified,
  deleted: styles.iconDeleted,
  renamed: styles.iconRenamed,
  copied: styles.iconCopied,
  untracked: styles.iconUntracked
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  added: <FilePlus size={14} />,
  modified: <FileEdit size={14} />,
  deleted: <FileMinus size={14} />,
  renamed: <ArrowRightLeft size={14} />,
  copied: <Copy size={14} />,
  untracked: <HelpCircle size={14} />
}

/** Lucide icon status indicator for a changed file */
function FileStatusBadge({ status }: { status: string }): React.JSX.Element {
  const icon = STATUS_ICONS[status] || '?'
  const cls = iconClassMap[status] || ''
  return (
    <span className={`${styles.fileIcon} ${cls}`} title={STATUS_LABELS[status] || status}>
      {icon}
    </span>
  )
}

/** Insertion/deletion stats display */
function FileStatsBadge({ insertions, deletions }: { insertions: number; deletions: number }): React.JSX.Element | null {
  if (insertions === 0 && deletions === 0) return null
  return (
    <span className={styles.fileStats}>
      {insertions > 0 && <span className={styles.statsAdded}>+{insertions}</span>}
      {deletions > 0 && <span className={styles.statsRemoved}>-{deletions}</span>}
    </span>
  )
}

function getAppSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('gitslop-settings')
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function fileDir(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

/** Per-file insertion/deletion counts from git diff --numstat */
interface NumstatMap {
  [path: string]: { insertions: number; deletions: number }
}

/** Per-status file counts for a directory */
interface DirStatusCounts {
  added: number
  modified: number
  deleted: number
  renamed: number
  untracked: number
}

/** Tree node for directory tree view of staging files */
interface StatusTreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children: StatusTreeNode[]
  file?: FileStatus
  /** Per-status file counts in this directory (recursively) — set after build */
  statusCounts?: DirStatusCounts
}

/** Build a directory tree from a flat list of FileStatus */
function buildStatusFileTree(files: FileStatus[]): StatusTreeNode[] {
  const root: StatusTreeNode = { name: '', fullPath: '', isDir: true, children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const partPath = parts.slice(0, i + 1).join('/')

      if (isLast) {
        current.children.push({
          name: part,
          fullPath: file.path,
          isDir: false,
          children: [],
          file
        })
      } else {
        let dirNode = current.children.find((c) => c.isDir && c.name === part)
        if (!dirNode) {
          dirNode = { name: part, fullPath: partPath, isDir: true, children: [] }
          current.children.push(dirNode)
        }
        current = dirNode
      }
    }
  }

  // Sort: directories first, then alphabetical
  const sortTree = (nodes: StatusTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDir) sortTree(node.children)
    }
  }
  sortTree(root.children)

  // Count files per directory, grouped by status
  const countFiles = (nodes: StatusTreeNode[]): DirStatusCounts => {
    const counts: DirStatusCounts = { added: 0, modified: 0, deleted: 0, renamed: 0, untracked: 0 }
    for (const node of nodes) {
      if (node.isDir) {
        const childCounts = countFiles(node.children)
        node.statusCounts = childCounts
        counts.added += childCounts.added
        counts.modified += childCounts.modified
        counts.deleted += childCounts.deleted
        counts.renamed += childCounts.renamed
        counts.untracked += childCounts.untracked
      } else if (node.file) {
        const s = node.file.status
        if (s === 'added') counts.added++
        else if (s === 'deleted') counts.deleted++
        else if (s === 'renamed' || s === 'copied') counts.renamed++
        else if (s === 'untracked') counts.untracked++
        else counts.modified++
      }
    }
    return counts
  }
  countFiles(root.children)

  return root.children
}

const SUBJECT_WARN_LENGTH = 72

/** Recursive tree node renderer for staging area tree view */
function StatusTreeNodeComponent({
  node,
  depth,
  section,
  collapsedDirs,
  onToggleDir,
  selectedFiles,
  activeSelection,
  onFileClick,
  onDragStart,
  onDragEnd,
  onContextMenu,
  stageFiles,
  unstageFiles,
  discardFile,
  operationInProgress,
  numstat
}: {
  node: StatusTreeNode
  depth: number
  section: 'unstaged' | 'staged'
  collapsedDirs: Set<string>
  onToggleDir: (fullPath: string) => void
  selectedFiles: Set<string>
  activeSelection: { path: string; staged: boolean } | null
  onFileClick: (file: FileStatus, isUntracked: boolean, section: string, e: React.MouseEvent) => void
  onDragStart: (file: FileStatus, source: 'staged' | 'unstaged' | 'untracked', e: React.DragEvent) => void
  onDragEnd: () => void
  onContextMenu: (file: FileStatus, x: number, y: number) => void
  stageFiles?: (paths: string[]) => void
  unstageFiles?: (paths: string[]) => void
  discardFile?: (file: FileStatus) => void
  operationInProgress: boolean
  numstat: NumstatMap
}): React.JSX.Element {
  if (node.isDir) {
    const expanded = !collapsedDirs.has(node.fullPath)
    return (
      <li>
        <button
          className={styles.treeDir}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onToggleDir(node.fullPath)}
          title={node.name}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? <FolderOpen size={12} className={styles.treeDirIcon} /> : <Folder size={12} className={styles.treeDirIcon} />}
          <span className={styles.treeDirName}>{node.name}</span>
          {node.statusCounts && (
            // Show counts when collapsed, or when this is a leaf directory (no subdirs)
            !expanded || !node.children.some((c) => c.isDir)
          ) && (
            <span className={styles.folderStats}>
              {node.statusCounts.modified > 0 && <span className={styles.folderStatsModified}>~{node.statusCounts.modified}</span>}
              {node.statusCounts.added > 0 && <span className={styles.folderStatsAdded}>+{node.statusCounts.added}</span>}
              {node.statusCounts.deleted > 0 && <span className={styles.folderStatsDeleted}>&minus;{node.statusCounts.deleted}</span>}
              {node.statusCounts.untracked > 0 && <span className={styles.folderStatsUntracked}>?{node.statusCounts.untracked}</span>}
              {node.statusCounts.renamed > 0 && <span className={styles.folderStatsRenamed}>R{node.statusCounts.renamed}</span>}
            </span>
          )}
        </button>
        {expanded && (
          <ul className={styles.treeChildren}>
            {node.children.map((child) => (
              <StatusTreeNodeComponent
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                section={section}
                collapsedDirs={collapsedDirs}
                onToggleDir={onToggleDir}
                selectedFiles={selectedFiles}
                activeSelection={activeSelection}
                onFileClick={onFileClick}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onContextMenu={onContextMenu}
                stageFiles={stageFiles}
                unstageFiles={unstageFiles}
                discardFile={discardFile}
                operationInProgress={operationInProgress}
                numstat={numstat}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  // File leaf node
  const file = node.file!
  const isUntracked = file.status === 'untracked'
  const fileSection = isUntracked ? 'untracked' : section
  const fileKey = `${fileSection}:${file.path}`
  const isSelected =
    selectedFiles.has(fileKey) ||
    (selectedFiles.size === 0 &&
      activeSelection?.path === file.path &&
      (section === 'staged' ? activeSelection?.staged === true : !activeSelection?.staged))
  const stats = numstat[file.path]

  return (
    <li>
      <div
        className={`${styles.treeFileItem} ${isSelected ? styles.treeFileItemSelected : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        draggable
        onDragStart={(e) => onDragStart(file, fileSection as 'staged' | 'unstaged' | 'untracked', e)}
        onDragEnd={onDragEnd}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onContextMenu(file, e.clientX, e.clientY)
        }}
      >
        <button
          className={styles.treeFileInfo}
          onClick={(e) => onFileClick(file, isUntracked, fileSection, e)}
          title={`${file.path} (${STATUS_LABELS[file.status] || file.status})`}
        >
          <FileStatusBadge status={file.status} />
          <span className={styles.fileName}>{node.name}</span>
          {stats && <FileStatsBadge insertions={stats.insertions} deletions={stats.deletions} />}
        </button>
        <div className={styles.treeFileActions}>
          {section === 'unstaged' && stageFiles && (
            <>
              <button
                className={`${styles.stageBtn} ${styles.stage}`}
                onClick={(e) => {
                  e.stopPropagation()
                  stageFiles([file.path])
                }}
                disabled={operationInProgress}
                title={`Stage ${file.path}`}
              >
                <Plus size={14} />
              </button>
              {discardFile && (
                <button
                  className={`${styles.stageBtn} ${styles.discardBtn}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    discardFile(file)
                  }}
                  disabled={operationInProgress}
                  title={`Discard changes to ${file.path}`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </>
          )}
          {section === 'staged' && unstageFiles && (
            <button
              className={`${styles.stageBtn} ${styles.unstage}`}
              onClick={(e) => {
                e.stopPropagation()
                unstageFiles([file.path])
              }}
              disabled={operationInProgress}
              title={`Unstage ${file.path}`}
            >
              <Minus size={14} />
            </button>
          )}
        </div>
      </div>
    </li>
  )
}

export function StatusPanel({ repoPath, onRefresh, stagingInternalSplit, onStagingInternalSplitChange, onFileSelect, externallySelectedFile, onCommitSuccess, fileListView = 'path' }: StatusPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean; isUntracked: boolean } | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [operationInProgress, setOperationInProgress] = useState(false)
  const [dragSource, setDragSource] = useState<'staged' | 'unstaged' | 'untracked' | null>(null)
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number
    y: number
    file: FileStatus
  } | null>(null)

  // Numstat data for insertion/deletion counts per file
  const [unstagedNumstat, setUnstagedNumstat] = useState<NumstatMap>({})
  const [stagedNumstat, setStagedNumstat] = useState<NumstatMap>({})

  // Sync internal selection with parent when an external selection is provided
  useEffect(() => {
    if (externallySelectedFile !== undefined) {
      setSelectedFile(externallySelectedFile)
    }
  }, [externallySelectedFile])
  // Commit form state — synced with WIP row input via custom events
  const [commitSubject, setCommitSubject] = useState('')
  const wipSyncRef = useRef(false)
  useEffect(() => {
    const handler = (e: Event): void => {
      const value = (e as CustomEvent<{ value: string }>).detail?.value ?? ''
      wipSyncRef.current = true
      setCommitSubject(value)
    }
    window.addEventListener('wip:subject-change', handler)
    return () => window.removeEventListener('wip:subject-change', handler)
  }, [])
  const [commitBody, setCommitBody] = useState('')
  const [commitBodyExpanded, setCommitBodyExpanded] = useState(false)
  const [amend, setAmend] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [gpgSign, setGpgSign] = useState(() => getAppSettings().signCommits)
  const [committing, setCommitting] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [commitSuccess, setCommitSuccess] = useState<string | null>(null)

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const panelRef = useRef<HTMLDivElement>(null)
  const statusLoadInFlightRef = useRef(false)
  const subjectRef = useRef<HTMLInputElement>(null)
  const isDraggingInternalSplitRef = useRef(false)
  const internalSplitContainerRef = useRef<HTMLDivElement>(null)
  const [isDraggingInternalSplit, setIsDraggingInternalSplit] = useState(false)

  // Per-section collapse state (independent of the overall panel collapse)
  const [unstagedCollapsed, setUnstagedCollapsed] = useState(false)
  const [stagedCollapsed, setStagedCollapsed] = useState(false)

  const loadStatus = useCallback(async () => {
    if (!mountedRef.current) return
    // Prevent overlapping requests
    if (statusLoadInFlightRef.current) return
    statusLoadInFlightRef.current = true
    try {
      const result = await window.electronAPI.git.getStatus(repoPath)
      if (!mountedRef.current) return
      if (result.success && result.data) {
        setStatus(result.data as RepoStatus)
        setError(null)
      } else {
        setError(result.error || 'Failed to load status')
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load status')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
      statusLoadInFlightRef.current = false
    }
  }, [repoPath])

  // Load numstat data when status changes (parallel to avoid blocking)
  useEffect(() => {
    if (!status) return
    // Guard: diffNumstat may not exist if preload hasn't been rebuilt
    if (typeof window.electronAPI.git.diffNumstat !== 'function') return
    let cancelled = false
    // Fetch unstaged + staged numstat in parallel
    Promise.all([
      window.electronAPI.git.diffNumstat(repoPath, { staged: false }),
      window.electronAPI.git.diffNumstat(repoPath, { staged: true })
    ]).then(([unstaged, staged]) => {
      if (cancelled) return
      if (unstaged.success && unstaged.data) setUnstagedNumstat(unstaged.data as NumstatMap)
      if (staged.success && staged.data) setStagedNumstat(staged.data as NumstatMap)
    }).catch((err) => {
      console.warn('Failed to load numstat:', err)
    })
    return () => { cancelled = true }
  }, [status, repoPath])

  // Initial load
  useEffect(() => {
    mountedRef.current = true
    loadStatus()

    return () => {
      mountedRef.current = false
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [loadStatus])

  // Listen for file-watcher refresh events — debounced to avoid cascading updates
  useEffect(() => {
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = setTimeout(() => {
        loadStatus()
      }, 500)
    })

    return () => {
      cleanup?.()
    }
  }, [loadStatus])

  // Refresh status on graph:force-refresh (after push/fetch/pull)
  useEffect(() => {
    const handler = (): void => {
      loadStatus()
    }
    window.addEventListener('graph:force-refresh', handler)
    return () => window.removeEventListener('graph:force-refresh', handler)
  }, [loadStatus])

  // Pre-fill message when amend is checked
  useEffect(() => {
    if (amend) {
      window.electronAPI.git.getLastCommitMessage(repoPath).then((result) => {
        if (result.success && result.data) {
          const msg = result.data as string
          const lines = msg.split('\n')
          setCommitSubject(lines[0] || '')
          const bodyLines = lines.slice(1)
          if (bodyLines.length > 0 && bodyLines[0].trim() === '') {
            bodyLines.shift()
          }
          const bodyText = bodyLines.join('\n').trim()
          setCommitBody(bodyText)
          if (bodyText) setCommitBodyExpanded(true)
        }
      })
    }
  }, [amend, repoPath])

  // Clear commit success message after 3 seconds
  useEffect(() => {
    if (commitSuccess) {
      const timer = setTimeout(() => setCommitSuccess(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [commitSuccess])

  // Keyboard shortcuts for stage/unstage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== panelRef.current) return
      if (operationInProgress) return

      // S key to stage selected file(s)
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedFiles.size > 0 || selectedFile) {
          e.preventDefault()
          handleStageSelected()
        }
      }

      // U key to unstage selected file(s)
      if (e.key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedFiles.size > 0 || selectedFile) {
          e.preventDefault()
          handleUnstageSelected()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, selectedFiles, operationInProgress, status])

  // Internal split drag handlers (file lists vs commit form)
  const handleInternalSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingInternalSplitRef.current = true
    setIsDraggingInternalSplit(true)
    document.body.classList.add('sidebar-dragging')
    const startY = e.clientY
    const startSplit = stagingInternalSplit

    const onMouseMove = (ev: MouseEvent): void => {
      if (!isDraggingInternalSplitRef.current || !internalSplitContainerRef.current) return
      const containerHeight = internalSplitContainerRef.current.getBoundingClientRect().height
      if (containerHeight <= 0) return
      const deltaY = ev.clientY - startY
      const deltaPct = (deltaY / containerHeight) * 100
      onStagingInternalSplitChange(startSplit + deltaPct)
    }

    const onMouseUp = (): void => {
      isDraggingInternalSplitRef.current = false
      setIsDraggingInternalSplit(false)
      document.body.classList.remove('sidebar-dragging')
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
    }

    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [stagingInternalSplit, onStagingInternalSplitChange])

  const handleInternalSplitDoubleClick = useCallback(() => {
    onStagingInternalSplitChange(65) // reset to default
  }, [onStagingInternalSplitChange])

  // ─── Stage/Unstage Operations ─────────────────────────────────────────────

  const stageFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0 || operationInProgress) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.stageFiles(repoPath, filePaths)
        if (result.success) {
          await loadStatus()
          onRefresh?.()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [repoPath, loadStatus, onRefresh, operationInProgress]
  )

  const unstageFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0 || operationInProgress) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.unstageFiles(repoPath, filePaths)
        if (result.success) {
          await loadStatus()
          onRefresh?.()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [repoPath, loadStatus, onRefresh, operationInProgress]
  )

  const stageAll = useCallback(async () => {
    if (operationInProgress) return
    setOperationInProgress(true)
    try {
      const result = await window.electronAPI.git.stageAll(repoPath)
      if (result.success) {
        await loadStatus()
        onRefresh?.()
      }
    } finally {
      setOperationInProgress(false)
    }
  }, [repoPath, loadStatus, onRefresh, operationInProgress])

  const unstageAll = useCallback(async () => {
    if (operationInProgress) return
    setOperationInProgress(true)
    try {
      const result = await window.electronAPI.git.unstageAll(repoPath)
      if (result.success) {
        await loadStatus()
        onRefresh?.()
      }
    } finally {
      setOperationInProgress(false)
    }
  }, [repoPath, loadStatus, onRefresh, operationInProgress])

  // ─── Discard changes ────────────────────────────────────────────────────────
  const discardFile = useCallback(
    async (file: FileStatus) => {
      if (operationInProgress) return
      const isUntracked = file.status === 'untracked'
      const confirmed = window.confirm(
        `Discard changes to "${file.path}"?\n\nThis action is irreversible${isUntracked ? ' — the file will be deleted' : ''}.`
      )
      if (!confirmed) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.discardFiles(
          repoPath,
          [file.path],
          { untracked: isUntracked }
        )
        if (result.success) {
          await loadStatus()
          onRefresh?.()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [repoPath, loadStatus, onRefresh, operationInProgress]
  )

  // ─── Discard All Changes ──────────────────────────────────────────────────
  const discardAllChanges = useCallback(async () => {
    if (operationInProgress || !status) return
    const totalFiles = status.unstaged.length + status.untracked.length
    if (totalFiles === 0) return
    const confirmed = window.confirm(
      `Discard ALL changes to ${totalFiles} file(s)?\n\nThis action is irreversible — all unstaged modifications will be lost and untracked files will be deleted.`
    )
    if (!confirmed) return
    setOperationInProgress(true)
    try {
      const trackedPaths = status.unstaged.map((f) => f.path)
      if (trackedPaths.length > 0) {
        await window.electronAPI.git.discardFiles(repoPath, trackedPaths)
      }
      const untrackedPaths = status.untracked.map((f) => f.path)
      if (untrackedPaths.length > 0) {
        await window.electronAPI.git.discardFiles(repoPath, untrackedPaths, { untracked: true })
      }
      await loadStatus()
      onRefresh?.()
    } finally {
      setOperationInProgress(false)
    }
  }, [operationInProgress, status, repoPath, loadStatus, onRefresh])

  // ─── File Context Menu ──────────────────────────────────────────────────────
  const handleFileContextMenu = useCallback(
    (file: FileStatus, x: number, y: number) => {
      setFileContextMenu({ x, y, file })
    },
    []
  )

  const buildFileContextMenuItems = useCallback(
    (file: FileStatus): ContextMenuEntry[] => {
      const isStaged = file.staged
      const isUntracked = file.status === 'untracked'
      const items: ContextMenuEntry[] = []

      if (isStaged) {
        items.push({
          key: 'unstage',
          label: 'Unstage',
          icon: <Minus size={14} />,
          shortcut: 'U',
          onClick: () => unstageFiles([file.path])
        })
      } else {
        items.push({
          key: 'stage',
          label: 'Stage',
          icon: <Plus size={14} />,
          shortcut: 'S',
          onClick: () => stageFiles([file.path])
        })
      }

      items.push({ key: 'sep1', separator: true })

      if (!isStaged) {
        items.push({
          key: 'discard',
          label: isUntracked ? 'Delete File' : 'Discard Changes',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => discardFile(file)
        })
        items.push({ key: 'sep2', separator: true })
      }

      items.push({
        key: 'openInEditor',
        label: 'Open in Editor',
        icon: <Pencil size={14} />,
        onClick: () => {
          const fullPath = repoPath + '/' + file.path
          openFileInEditor(fullPath)
        }
      })

      items.push({
        key: 'copyPath',
        label: 'Copy Path',
        icon: <Copy size={14} />,
        onClick: () => {
          navigator.clipboard.writeText(file.path)
        }
      })

      if (!isUntracked) {
        items.push({
          key: 'showHistory',
          label: 'Show History',
          icon: <Clock size={14} />,
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent('commit-filter:file-history', { detail: { path: file.path } })
            )
          }
        })
      }

      return items
    },
    [repoPath, stageFiles, unstageFiles, discardFile]
  )

  // Handle stage/unstage from keyboard shortcut based on selected files
  const handleStageSelected = useCallback(() => {
    if (!status) return
    const unstaged = [...status.unstaged, ...status.untracked]
    const filesToStage: string[] = []

    if (selectedFiles.size > 0) {
      for (const key of selectedFiles) {
        const file = unstaged.find((f) => `unstaged:${f.path}` === key || `untracked:${f.path}` === key)
        if (file) filesToStage.push(file.path)
      }
    } else if (selectedFile && !selectedFile.staged) {
      filesToStage.push(selectedFile.path)
    }

    if (filesToStage.length > 0) {
      stageFiles(filesToStage)
    }
  }, [status, selectedFiles, selectedFile, stageFiles])

  const handleUnstageSelected = useCallback(() => {
    if (!status) return
    const filesToUnstage: string[] = []

    if (selectedFiles.size > 0) {
      for (const key of selectedFiles) {
        const file = status.staged.find((f) => `staged:${f.path}` === key)
        if (file) filesToUnstage.push(file.path)
      }
    } else if (selectedFile && selectedFile.staged) {
      filesToUnstage.push(selectedFile.path)
    }

    if (filesToUnstage.length > 0) {
      unstageFiles(filesToUnstage)
    }
  }, [status, selectedFiles, selectedFile, unstageFiles])

  // ─── File Selection ───────────────────────────────────────────────────────

  const handleFileClick = useCallback(
    async (file: FileStatus, isUntracked: boolean, section: string, e: React.MouseEvent) => {
      const fileKey = `${section}:${file.path}`

      // Multi-select with Ctrl/Cmd or Shift
      if (e.ctrlKey || e.metaKey) {
        setSelectedFiles((prev) => {
          const next = new Set(prev)
          if (next.has(fileKey)) {
            next.delete(fileKey)
          } else {
            next.add(fileKey)
          }
          return next
        })
        return
      }

      if (e.shiftKey && selectedFile) {
        const allFiles =
          section === 'staged'
            ? status?.staged ?? []
            : section === 'unstaged'
              ? status?.unstaged ?? []
              : status?.untracked ?? []
        const currentIdx = allFiles.findIndex((f) => f.path === file.path)
        const prevIdx = allFiles.findIndex((f) => f.path === selectedFile.path)
        if (currentIdx >= 0 && prevIdx >= 0) {
          const start = Math.min(currentIdx, prevIdx)
          const end = Math.max(currentIdx, prevIdx)
          const newSelection = new Set<string>()
          for (let i = start; i <= end; i++) {
            newSelection.add(`${section}:${allFiles[i].path}`)
          }
          setSelectedFiles(newSelection)
          return
        }
      }

      // Regular click - clear multi-select and show diff
      setSelectedFiles(new Set())
      const fileInfo = { path: file.path, staged: file.staged, isUntracked }
      setSelectedFile(fileInfo)

      // If a parent handler is supplied, delegate diff display to the main
      // center viewer rather than the embedded panel.
      if (onFileSelect) {
        onFileSelect(fileInfo)
        return
      }

      setDiffLoading(true)
      setDiffContent(null)

      try {
        if (isUntracked) {
          const result = await window.electronAPI.git.diff(repoPath, file.path, { staged: false })
          if (result.success && result.data) {
            setDiffContent(result.data as string)
          } else {
            setDiffContent(`(New untracked file: ${file.path})`)
          }
        } else {
          const result = await window.electronAPI.git.diff(repoPath, file.path, { staged: file.staged })
          if (result.success && result.data) {
            setDiffContent(result.data as string)
          } else {
            setDiffContent('(No diff available)')
          }
        }
      } catch {
        setDiffContent('(Failed to load diff)')
      } finally {
        setDiffLoading(false)
      }
    },
    [repoPath, selectedFile, status, onFileSelect]
  )

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (file: FileStatus, section: 'staged' | 'unstaged' | 'untracked', e: React.DragEvent) => {
      setDragSource(section)
      const filePaths: string[] = []
      if (selectedFiles.size > 0 && selectedFiles.has(`${section}:${file.path}`)) {
        for (const key of selectedFiles) {
          const parts = key.split(':')
          if (parts[0] === section || (section === 'untracked' && parts[0] === 'untracked') || (section === 'unstaged' && parts[0] === 'unstaged')) {
            filePaths.push(parts.slice(1).join(':'))
          }
        }
      } else {
        filePaths.push(file.path)
      }
      e.dataTransfer.setData('text/plain', JSON.stringify({ section, filePaths }))
      e.dataTransfer.effectAllowed = 'move'
    },
    [selectedFiles]
  )

  const handleDragOver = useCallback(
    (targetSection: 'staged' | 'unstaged', e: React.DragEvent) => {
      if (
        (dragSource === 'unstaged' || dragSource === 'untracked') &&
        targetSection === 'staged'
      ) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      } else if (dragSource === 'staged' && targetSection === 'unstaged') {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
    },
    [dragSource]
  )

  const handleDrop = useCallback(
    async (targetSection: 'staged' | 'unstaged', e: React.DragEvent) => {
      e.preventDefault()
      setDragSource(null)
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain')) as {
          section: string
          filePaths: string[]
        }
        if (
          (data.section === 'unstaged' || data.section === 'untracked') &&
          targetSection === 'staged'
        ) {
          await stageFiles(data.filePaths)
        } else if (data.section === 'staged' && targetSection === 'unstaged') {
          await unstageFiles(data.filePaths)
        }
      } catch {
        // Ignore invalid drop data
      }
    },
    [stageFiles, unstageFiles]
  )

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
  }, [])

  // ─── Commit Logic ────────────────────────────────────────────────────────

  const stagedCount = status?.staged.length ?? 0

  const buildMessage = useCallback((): string => {
    if (commitBody.trim()) {
      return commitSubject + '\n\n' + commitBody.trim()
    }
    return commitSubject
  }, [commitSubject, commitBody])

  const canCommit = (stagedCount > 0 || amend) && commitSubject.trim().length > 0 && !committing

  const handleCommit = useCallback(async (andPush: boolean = false) => {
    if (!canCommit) return
    setCommitting(true)
    setCommitError(null)
    setCommitSuccess(null)

    try {
      const message = buildMessage()
      const appSettings = getAppSettings()
      const result = await window.electronAPI.git.commit(repoPath, message, {
        amend,
        signoff,
        gpgSign,
        gpgKeyId: gpgSign && appSettings.gpgKeyId ? appSettings.gpgKeyId : undefined
      })

      if (result.success) {
        setCommitSubject('')
        setCommitBody('')
        setCommitBodyExpanded(false)
        setAmend(false)
        setCommitError(null)

        if (andPush) {
          const pushResult = await window.electronAPI.git.push(repoPath)
          if (pushResult.success) {
            setCommitSuccess('Committed and pushed successfully')
          } else {
            setCommitSuccess('Committed successfully, but push failed: ' + (pushResult.error || 'Unknown error'))
          }
        } else {
          setCommitSuccess('Committed successfully')
        }

        await loadStatus()
        onRefresh?.()
        onCommitSuccess?.()
      } else {
        setCommitError(result.error || 'Commit failed')
      }
    } catch (err) {
      setCommitError(err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }, [canCommit, buildMessage, repoPath, amend, signoff, gpgSign, loadStatus, onRefresh, onCommitSuccess])

  // Ctrl+Enter shortcut for commit
  const stableCommit = useShortcutHandler(() => {
    const active = document.activeElement
    if (panelRef.current?.contains(active) && canCommit) {
      handleCommit(false)
    }
  })

  const commitShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'commit',
        'Commit Staged Changes',
        'Git',
        'Ctrl+Enter',
        { ctrl: true, key: 'Enter' },
        stableCommit
      )
    ],
    [stableCommit]
  )

  useKeyboardShortcuts(commitShortcuts)

  // ─── Computed values ──────────────────────────────────────────────────────

  const isClean =
    status &&
    status.staged.length === 0 &&
    status.unstaged.length === 0 &&
    status.untracked.length === 0

  const unstagedFiles = useMemo(() => {
    if (!status) return []
    return [...status.unstaged, ...status.untracked]
  }, [status])

  const unstagedCount = unstagedFiles.length
  const stagedFiles = status?.staged ?? []

  // Tree view state
  const unstagedTree = useMemo(() => buildStatusFileTree(unstagedFiles), [unstagedFiles])
  const stagedTree = useMemo(() => buildStatusFileTree(stagedFiles), [stagedFiles])
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())

  const toggleDir = useCallback((fullPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }, [])

  const subjectLength = commitSubject.length
  const subjectOverLimit = subjectLength > SUBJECT_WARN_LENGTH

  const isDropTargetStaged = dragSource === 'unstaged' || dragSource === 'untracked'
  const isDropTargetUnstaged = dragSource === 'staged'

  if (loading && !status) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelLoading}>Loading status...</div>
      </div>
    )
  }

  if (error && !status) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelError}>
          <span><AlertTriangle size={14} /></span> {error}
          <button onClick={loadStatus}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.panel} ref={panelRef} tabIndex={-1}>
      {/* Panel header (non-collapsible — sections collapse individually) */}
      <div className={styles.panelHeader}>
        <span className={styles.panelHeaderLeft}>
          <h3 className={styles.panelTitle}>Staging Area</h3>
          {isClean && <span className={styles.cleanBadge}><Check size={12} /> Clean</span>}
          {!isClean && (
            <span className={styles.changeBadge}>
              {unstagedCount + stagedCount} file{(unstagedCount + stagedCount) !== 1 ? 's' : ''}
            </span>
          )}
        </span>
        <span className={styles.panelHeaderRight}>
          <button className={styles.panelRefresh} onClick={loadStatus} title="Refresh status">
            <RefreshCw size={14} />
          </button>
        </span>
      </div>

        <div ref={internalSplitContainerRef} style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <div style={{
            height: `calc(${stagingInternalSplit}% - 2px)`,
            minHeight: 80,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transition: isDraggingInternalSplit ? 'none' : undefined
          }}>
          {isClean ? (
            <div className={styles.panelClean}>
              <span className={styles.panelCleanIcon}><Check size={16} /></span>
              <span>Working directory clean — nothing to commit</span>
            </div>
          ) : (
            <div className={styles.twoColumnLayout}>
              {/* ─── Left Column: Unstaged Changes ─── */}
              <div
                className={`${styles.column} ${styles.columnUnstaged} ${isDropTargetUnstaged ? styles.dropTarget : ''}`}
                onDragOver={(e) => handleDragOver('unstaged', e)}
                onDrop={(e) => handleDrop('unstaged', e)}
              >
                <div
                  className={`${styles.columnHeader} ${styles.columnHeaderClickable}`}
                  onClick={() => setUnstagedCollapsed(prev => !prev)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setUnstagedCollapsed(prev => !prev) } }}
                >
                  <span className={styles.columnTitle}>
                    <span className={styles.sectionChevron}>
                      {unstagedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                    Unstaged Changes
                    <span className={styles.columnCount}>{unstagedCount}</span>
                  </span>
                  <div className={styles.columnActions} onClick={(e) => e.stopPropagation()}>
                    {unstagedCount > 0 && (
                      <>
                        <button
                          className={`${styles.actionBtn} ${styles.actionStageAll}`}
                          onClick={stageAll}
                          disabled={operationInProgress}
                          title="Stage All Changes"
                        >
                          <Plus size={14} />
                        </button>
                        <button
                          className={`${styles.actionBtn} ${styles.actionDiscardAll}`}
                          onClick={discardAllChanges}
                          disabled={operationInProgress}
                          title="Discard All Changes (irreversible)"
                        >
                          <Trash2 size={12} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {!unstagedCollapsed && <div className={styles.columnFiles}>
                  {unstagedCount === 0 ? (
                    <div className={styles.columnEmpty}>No unstaged changes</div>
                  ) : fileListView === 'tree' ? (
                    <ul className={styles.treeChildren}>
                      {unstagedTree.map((node) => (
                        <StatusTreeNodeComponent
                          key={node.fullPath}
                          node={node}
                          depth={0}
                          section="unstaged"
                          collapsedDirs={collapsedDirs}
                          onToggleDir={toggleDir}
                          selectedFiles={selectedFiles}
                          activeSelection={externallySelectedFile ?? selectedFile}
                          onFileClick={handleFileClick}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onContextMenu={handleFileContextMenu}
                          stageFiles={stageFiles}
                          discardFile={discardFile}
                          operationInProgress={operationInProgress}
                          numstat={unstagedNumstat}
                        />
                      ))}
                    </ul>
                  ) : (
                    unstagedFiles.map((file) => {
                      const isUntracked = file.status === 'untracked'
                      const section = isUntracked ? 'untracked' : 'unstaged'
                      const fileKey = `${section}:${file.path}`
                      const activeSelection = externallySelectedFile ?? selectedFile
                      const isSelected =
                        selectedFiles.has(fileKey) ||
                        (selectedFiles.size === 0 &&
                          activeSelection?.path === file.path &&
                          !activeSelection?.staged)
                      return (
                        <div
                          key={`${section}-${file.path}`}
                          className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''}`}
                          draggable
                          onDragStart={(e) => handleDragStart(file, section as 'unstaged' | 'untracked', e)}
                          onDragEnd={handleDragEnd}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleFileContextMenu(file, e.clientX, e.clientY)
                          }}
                        >
                          <button
                            className={styles.fileInfo}
                            onClick={(e) => handleFileClick(file, isUntracked, section, e)}
                            title={`${file.path} (${STATUS_LABELS[file.status] || file.status})`}
                          >
                            <FileStatusBadge status={file.status} />
                            <span className={styles.fileName}>
                              {fileDir(file.path) && <span className={styles.fileDir}>{fileDir(file.path)}/</span>}
                              {fileName(file.path)}
                            </span>
                            {unstagedNumstat[file.path] && (
                              <FileStatsBadge insertions={unstagedNumstat[file.path].insertions} deletions={unstagedNumstat[file.path].deletions} />
                            )}
                          </button>
                          <div className={styles.fileActions}>
                            <button
                              className={`${styles.stageBtn} ${styles.stage}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                stageFiles([file.path])
                              }}
                              disabled={operationInProgress}
                              title={`Stage ${file.path}`}
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              className={`${styles.stageBtn} ${styles.discardBtn}`}
                              onClick={(e) => {
                                e.stopPropagation()
                                discardFile(file)
                              }}
                              disabled={operationInProgress}
                              title={`Discard changes to ${file.path}`}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>}
              </div>

              {/* ─── Right Column: Staged Changes ─── */}
              <div
                className={`${styles.column} ${styles.columnStaged} ${isDropTargetStaged ? styles.dropTarget : ''}`}
                onDragOver={(e) => handleDragOver('staged', e)}
                onDrop={(e) => handleDrop('staged', e)}
              >
                <div
                  className={`${styles.columnHeader} ${styles.columnHeaderClickable}`}
                  onClick={() => setStagedCollapsed(prev => !prev)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setStagedCollapsed(prev => !prev) } }}
                >
                  <span className={styles.columnTitle}>
                    <span className={styles.sectionChevron}>
                      {stagedCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    </span>
                    Staged Changes
                    <span className={`${styles.columnCount} ${styles.columnCountStaged}`}>{stagedCount}</span>
                  </span>
                  <div className={styles.columnActions} onClick={(e) => e.stopPropagation()}>
                    {stagedCount > 0 && (
                      <button
                        className={`${styles.actionBtn} ${styles.actionUnstageAll}`}
                        onClick={unstageAll}
                        disabled={operationInProgress}
                        title="Unstage All"
                      >
                        <Minus size={14} />
                      </button>
                    )}
                  </div>
                </div>
                {!stagedCollapsed && <div className={styles.columnFiles}>
                  {stagedCount === 0 ? (
                    <div className={styles.columnEmpty}>No staged changes</div>
                  ) : fileListView === 'tree' ? (
                    <ul className={styles.treeChildren}>
                      {stagedTree.map((node) => (
                        <StatusTreeNodeComponent
                          key={node.fullPath}
                          node={node}
                          depth={0}
                          section="staged"
                          collapsedDirs={collapsedDirs}
                          onToggleDir={toggleDir}
                          selectedFiles={selectedFiles}
                          activeSelection={externallySelectedFile ?? selectedFile}
                          onFileClick={handleFileClick}
                          onDragStart={handleDragStart}
                          onDragEnd={handleDragEnd}
                          onContextMenu={handleFileContextMenu}
                          unstageFiles={unstageFiles}
                          operationInProgress={operationInProgress}
                          numstat={stagedNumstat}
                        />
                      ))}
                    </ul>
                  ) : (
                    stagedFiles.map((file) => {
                      const fileKey = `staged:${file.path}`
                      const activeSelection = externallySelectedFile ?? selectedFile
                      const isSelected =
                        selectedFiles.has(fileKey) ||
                        (selectedFiles.size === 0 &&
                          activeSelection?.path === file.path &&
                          activeSelection?.staged === true)
                      return (
                        <div
                          key={`staged-${file.path}`}
                          className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''}`}
                          draggable
                          onDragStart={(e) => handleDragStart(file, 'staged', e)}
                          onDragEnd={handleDragEnd}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleFileContextMenu(file, e.clientX, e.clientY)
                          }}
                        >
                          <button
                            className={styles.fileInfo}
                            onClick={(e) => handleFileClick(file, false, 'staged', e)}
                            title={`${file.path} (${STATUS_LABELS[file.status] || file.status})`}
                          >
                            <FileStatusBadge status={file.status} />
                            <span className={styles.fileName}>
                              {fileDir(file.path) && <span className={styles.fileDir}>{fileDir(file.path)}/</span>}
                              {fileName(file.path)}
                            </span>
                            {stagedNumstat[file.path] && (
                              <FileStatsBadge insertions={stagedNumstat[file.path].insertions} deletions={stagedNumstat[file.path].deletions} />
                            )}
                          </button>
                          <button
                            className={`${styles.stageBtn} ${styles.unstage}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              unstageFiles([file.path])
                            }}
                            disabled={operationInProgress}
                            title={`Unstage ${file.path}`}
                          >
                            <Minus size={14} />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>}
              </div>
            </div>
          )}

          {/* Diff Viewer with Hunk/Line Staging — hidden when parent handles diff display */}
          {selectedFile && !onFileSelect && (
            <div className={styles.diffViewer}>
              <div className={styles.diffHeader}>
                <span className={styles.diffFilename}>
                  {selectedFile.staged ? '(Staged) ' : ''}
                  {selectedFile.path}
                </span>
                <button
                  className={styles.diffClose}
                  onClick={() => {
                    setSelectedFile(null)
                    setDiffContent(null)
                  }}
                  title="Close diff"
                >
                  <X size={14} />
                </button>
              </div>
              <div className={styles.diffContent}>
                {diffLoading ? (
                  <div className={styles.diffLoading}>Loading diff...</div>
                ) : diffContent ? (
                  <DiffViewerWithStaging
                    diffContent={diffContent}
                    filePath={selectedFile.path}
                    staged={selectedFile.staged}
                    isUntracked={selectedFile.isUntracked}
                    repoPath={repoPath}
                    onOperationDone={() => {
                      loadStatus()
                      onRefresh?.()
                    }}
                    operationInProgress={operationInProgress}
                    setOperationInProgress={setOperationInProgress}
                  />
                ) : (
                  <div className={styles.diffEmpty}>No changes to display</div>
                )}
              </div>
            </div>
          )}
          </div>
          {/* ─── Internal Split Drag Handle ─── */}
          <div
            style={{
              height: 5,
              flexShrink: 0,
              cursor: 'row-resize',
              background: isDraggingInternalSplit ? 'var(--border)' : 'transparent',
              borderTop: '1px solid var(--border)',
              transition: 'background 0.15s ease'
            }}
            onMouseDown={handleInternalSplitDragStart}
            onDoubleClick={handleInternalSplitDoubleClick}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'var(--border)' }}
            onMouseLeave={(e) => { if (!isDraggingInternalSplit) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          />
          {/* ─── Commit Form ─── */}
          <div style={{
            height: `calc(${100 - stagingInternalSplit}% - 3px)`,
            minHeight: 120,
            overflow: 'auto',
            transition: isDraggingInternalSplit ? 'none' : undefined
          }}>
      <div className={styles.commitForm} style={{ borderTop: 'none' }}>
        {commitError && (
          <div className={styles.commitError}>{commitError}</div>
        )}
        {commitSuccess && (
          <div className={styles.commitSuccess}>{commitSuccess}</div>
        )}
        <div className={styles.commitSubjectRow}>
          <input
            ref={subjectRef}
            className={`${styles.commitSubject} ${subjectOverLimit ? styles.commitSubjectOverLimit : ''}`}
            type="text"
            value={commitSubject}
            onChange={(e) => {
              setCommitSubject(e.target.value)
              window.dispatchEvent(new CustomEvent('wip:subject-sync', { detail: { value: e.target.value } }))
            }}
            placeholder="Commit message..."
            disabled={committing}
          />
          <span className={`${styles.charCount} ${subjectOverLimit ? styles.charCountOver : ''}`}>
            {subjectLength}/{SUBJECT_WARN_LENGTH}
          </span>
        </div>
        {!commitBodyExpanded ? (
          <button
            className={styles.expandBody}
            onClick={() => setCommitBodyExpanded(true)}
            disabled={committing}
          >
            + Description
          </button>
        ) : (
          <textarea
            className={styles.commitBody}
            value={commitBody}
            onChange={(e) => setCommitBody(e.target.value)}
            placeholder="Extended description (optional)..."
            rows={3}
            disabled={committing}
          />
        )}
        <div className={styles.commitOptions}>
          <label className={styles.commitOption}>
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
              disabled={committing}
            />
            Amend
          </label>
          <label className={styles.commitOption}>
            <input
              type="checkbox"
              checked={signoff}
              onChange={(e) => setSignoff(e.target.checked)}
              disabled={committing}
            />
            Sign-off
          </label>
          <label className={styles.commitOption} title="Sign with GPG key">
            <input
              type="checkbox"
              checked={gpgSign}
              onChange={(e) => setGpgSign(e.target.checked)}
              disabled={committing}
            />
            GPG
          </label>
        </div>
        <div className={styles.commitActions}>
          <button
            className={`${styles.commitBtn} ${styles.commitBtnPrimary}`}
            onClick={() => handleCommit(false)}
            disabled={!canCommit}
            title="Commit (Ctrl+Enter)"
          >
            {committing ? 'Committing...' : amend ? 'Amend' : 'Commit'}
          </button>
          <button
            className={`${styles.commitBtn} ${styles.commitBtnSecondary}`}
            onClick={() => handleCommit(true)}
            disabled={!canCommit}
            title="Commit and push to remote"
          >
            {committing ? '...' : 'Commit & Push'}
          </button>
        </div>
        {stagedCount === 0 && !amend && (
          <div className={styles.commitHint}>
            Stage files to commit.
          </div>
        )}
      </div>
          </div>
        </div>

      {/* File Context Menu */}
      {fileContextMenu && (
        <ContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          items={buildFileContextMenuItems(fileContextMenu.file)}
          onClose={() => setFileContextMenu(null)}
        />
      )}
    </div>
  )
}

// ─── Diff Hunk Parser & Viewer ───────────────────────────────────────────────

interface DiffHunk {
  header: string // e.g. "@@ -10,5 +10,7 @@"
  lines: DiffLine[]
}

interface DiffLine {
  type: 'context' | 'added' | 'removed'
  content: string // full line including +/-/space prefix
  oldLineNum: number | null
  newLineNum: number | null
}

interface FileHeader {
  lines: string[] // "diff --git ...", "index ...", "--- a/...", "+++ b/..."
}

function parseDiff(diffText: string): { fileHeader: FileHeader; hunks: DiffHunk[] } {
  const allLines = diffText.split('\n')
  const fileHeaderLines: string[] = []
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let inHeader = true

  for (const line of allLines) {
    if (line.startsWith('@@')) {
      inHeader = false
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLine = match ? parseInt(match[1], 10) : 1
      newLine = match ? parseInt(match[2], 10) : 1
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
    } else if (inHeader) {
      fileHeaderLines.push(line)
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'added', content: line, oldLineNum: null, newLineNum: newLine })
        newLine++
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'removed', content: line, oldLineNum: oldLine, newLineNum: null })
        oldLine++
      } else if (line.startsWith('\\')) {
        currentHunk.lines.push({ type: 'context', content: line, oldLineNum: null, newLineNum: null })
      } else {
        currentHunk.lines.push({ type: 'context', content: line, oldLineNum: oldLine, newLineNum: newLine })
        oldLine++
        newLine++
      }
    }
  }

  return { fileHeader: { lines: fileHeaderLines }, hunks }
}

function buildHunkPatch(fileHeader: FileHeader, hunk: DiffHunk): string {
  const headerStr = fileHeader.lines.join('\n')
  const hunkLines = [hunk.header, ...hunk.lines.map((l) => l.content)].join('\n')
  return headerStr + '\n' + hunkLines + '\n'
}

function buildLinesPatch(
  fileHeader: FileHeader,
  hunk: DiffHunk,
  selectedLineIndices: Set<number>,
  _forStaging: boolean
): string {
  const newHunkLines: string[] = []
  let oldCount = 0
  let newCount = 0

  const headerMatch = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
  const oldStart = headerMatch ? parseInt(headerMatch[1], 10) : 1
  const newStart = headerMatch ? parseInt(headerMatch[2], 10) : 1
  const headerSuffix = headerMatch ? headerMatch[3] : ''

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]
    const isSelected = selectedLineIndices.has(i)

    if (line.content.startsWith('\\')) {
      newHunkLines.push(line.content)
      continue
    }

    if (line.type === 'context') {
      newHunkLines.push(line.content)
      oldCount++
      newCount++
    } else if (line.type === 'added') {
      if (isSelected) {
        newHunkLines.push(line.content)
        newCount++
      }
    } else if (line.type === 'removed') {
      if (isSelected) {
        newHunkLines.push(line.content)
        oldCount++
      } else {
        newHunkLines.push(' ' + line.content.substring(1))
        oldCount++
        newCount++
      }
    }
  }

  if (newHunkLines.length === 0) return ''

  const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${headerSuffix}`
  const headerStr = fileHeader.lines.join('\n')
  return headerStr + '\n' + newHeader + '\n' + newHunkLines.join('\n') + '\n'
}

interface HunkDiffViewerProps {
  diffContent: string
  filePath: string
  staged: boolean
  isUntracked: boolean
  repoPath: string
  onOperationDone: () => void
  operationInProgress: boolean
  setOperationInProgress: (v: boolean) => void
}

function HunkDiffViewer({
  diffContent,
  filePath: _filePath,
  staged,
  isUntracked,
  repoPath,
  onOperationDone,
  operationInProgress,
  setOperationInProgress
}: HunkDiffViewerProps): React.JSX.Element {
  const [selectedLines, setSelectedLines] = useState<Map<number, Set<number>>>(new Map())

  const { fileHeader, hunks } = React.useMemo(() => parseDiff(diffContent), [diffContent])

  useEffect(() => {
    setSelectedLines(new Map())
  }, [diffContent])

  const hasValidHeader = fileHeader.lines.some((l) => l.startsWith('diff --git'))

  const toggleLineSelection = useCallback((hunkIdx: number, lineIdx: number, e: React.MouseEvent) => {
    setSelectedLines((prev) => {
      const next = new Map(prev)
      const hunkSet = new Set(next.get(hunkIdx) || [])

      if (e.shiftKey && hunkSet.size > 0) {
        const arr = Array.from(hunkSet).sort((a, b) => a - b)
        const lastSelected = arr[arr.length - 1]
        const start = Math.min(lastSelected, lineIdx)
        const end = Math.max(lastSelected, lineIdx)
        for (let i = start; i <= end; i++) {
          const line = hunks[hunkIdx].lines[i]
          if (line && line.type !== 'context' && !line.content.startsWith('\\')) {
            hunkSet.add(i)
          }
        }
      } else {
        if (hunkSet.has(lineIdx)) {
          hunkSet.delete(lineIdx)
        } else {
          hunkSet.add(lineIdx)
        }
      }

      if (hunkSet.size === 0) {
        next.delete(hunkIdx)
      } else {
        next.set(hunkIdx, hunkSet)
      }
      return next
    })
  }, [hunks])

  const handleStageHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.stageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleUnstageHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleStageSelectedLines = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const lineIndices = selectedLines.get(hunkIdx)
      if (!lineIndices || lineIndices.size === 0) return

      setOperationInProgress(true)
      try {
        const patch = buildLinesPatch(fileHeader, hunks[hunkIdx], lineIndices, true)
        if (!patch) return
        const result = await window.electronAPI.git.stageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
          setSelectedLines(new Map())
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, selectedLines, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleUnstageSelectedLines = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const lineIndices = selectedLines.get(hunkIdx)
      if (!lineIndices || lineIndices.size === 0) return

      setOperationInProgress(true)
      try {
        const patch = buildLinesPatch(fileHeader, hunks[hunkIdx], lineIndices, false)
        if (!patch) return
        const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
          setSelectedLines(new Map())
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, selectedLines, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleDiscardHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const confirmed = window.confirm(
        'Discard this hunk?\n\nThis action is irreversible — the changes will be permanently lost.'
      )
      if (!confirmed) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.discardHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  if (hunks.length === 0 || !hasValidHeader) {
    return <pre className={styles.diffPre}>{diffContent}</pre>
  }

  return (
    <div className={styles.hunkDiffViewer}>
      {hunks.map((hunk, hunkIdx) => {
        const hunkSelectedLines = selectedLines.get(hunkIdx)
        const hasSelection = hunkSelectedLines && hunkSelectedLines.size > 0
        return (
          <div key={hunkIdx} className={styles.hunkBlock}>
            <div className={styles.hunkHeader}>
              <span className={styles.hunkHeaderText}>{hunk.header}</span>
              <div className={styles.hunkActions}>
                {hasSelection && !staged && (
                  <button
                    className={`${styles.hunkActionBtn} ${styles.hunkStageLines}`}
                    onClick={() => handleStageSelectedLines(hunkIdx)}
                    disabled={operationInProgress}
                    title={`Stage ${hunkSelectedLines!.size} selected line(s)`}
                  >
                    + Stage Lines ({hunkSelectedLines!.size})
                  </button>
                )}
                {hasSelection && staged && (
                  <button
                    className={`${styles.hunkActionBtn} ${styles.hunkUnstageLines}`}
                    onClick={() => handleUnstageSelectedLines(hunkIdx)}
                    disabled={operationInProgress}
                    title={`Unstage ${hunkSelectedLines!.size} selected line(s)`}
                  >
                    <Minus size={14} /> Unstage Lines ({hunkSelectedLines!.size})
                  </button>
                )}
                {!staged && !isUntracked && (
                  <button
                    className={`${styles.hunkActionBtn} ${styles.hunkStage}`}
                    onClick={() => handleStageHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Stage this hunk"
                  >
                    + Stage Hunk
                  </button>
                )}
                {!staged && !isUntracked && (
                  <button
                    className={`${styles.hunkActionBtn} ${styles.hunkDiscard}`}
                    onClick={() => handleDiscardHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Discard this hunk (irreversible)"
                  >
                    <X size={14} /> Discard Hunk
                  </button>
                )}
                {staged && (
                  <button
                    className={`${styles.hunkActionBtn} ${styles.hunkUnstage}`}
                    onClick={() => handleUnstageHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Unstage this hunk"
                  >
                    <Minus size={14} /> Unstage Hunk
                  </button>
                )}
              </div>
            </div>
            <div className={styles.hunkLines}>
              {hunk.lines.map((line, lineIdx) => {
                const isSelectable = line.type !== 'context' && !line.content.startsWith('\\')
                const isSelected = hunkSelectedLines?.has(lineIdx) ?? false
                return (
                  <div
                    key={lineIdx}
                    className={[
                      styles.hunkLine,
                      hunkLineTypeClass[line.type] || '',
                      isSelected ? styles.hunkLineSelected : '',
                      isSelectable ? styles.hunkLineSelectable : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={isSelectable ? (e) => toggleLineSelection(hunkIdx, lineIdx, e) : undefined}
                  >
                    <span className={`${styles.hunkLineNum}`}>
                      {line.oldLineNum ?? ''}
                    </span>
                    <span className={`${styles.hunkLineNum} ${styles.hunkLineNumNew}`}>
                      {line.newLineNum ?? ''}
                    </span>
                    {isSelectable && (
                      <span className={`${styles.hunkLineCheckbox} ${isSelected ? styles.checked : ''}`}>
                        {isSelected ? <Check size={12} /> : <span />}
                      </span>
                    )}
                    {!isSelectable && <span className={styles.hunkLineCheckboxSpacer} />}
                    <span className={styles.hunkLineContent}>{line.content}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Diff Viewer with Staging Toggle ─────────────────────────────────────────

export interface DiffViewerWithStagingProps {
  diffContent: string
  filePath: string
  staged: boolean
  isUntracked: boolean
  repoPath: string
  onOperationDone: () => void
  operationInProgress: boolean
  setOperationInProgress: (v: boolean) => void
}

export function DiffViewerWithStaging(props: DiffViewerWithStagingProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'staging' | 'enhanced'>('staging')

  return (
    <div className={styles.diffViewerWithStaging}>
      <div className={styles.diffViewerTabBar}>
        <button
          className={`${styles.diffViewerTab} ${viewMode === 'staging' ? styles.active : ''}`}
          onClick={() => setViewMode('staging')}
          title="Staging view with hunk/line controls"
        >
          Staging
        </button>
        <button
          className={`${styles.diffViewerTab} ${viewMode === 'enhanced' ? styles.active : ''}`}
          onClick={() => setViewMode('enhanced')}
          title="Enhanced diff view with side-by-side mode and syntax highlighting"
        >
          Enhanced View
        </button>
      </div>
      {viewMode === 'staging' ? (
        <HunkDiffViewer
          diffContent={props.diffContent}
          filePath={props.filePath}
          staged={props.staged}
          isUntracked={props.isUntracked}
          repoPath={props.repoPath}
          onOperationDone={props.onOperationDone}
          operationInProgress={props.operationInProgress}
          setOperationInProgress={props.setOperationInProgress}
        />
      ) : (
        <DiffViewer
          diffContent={props.diffContent}
          filePath={props.filePath}
        />
      )}
    </div>
  )
}
