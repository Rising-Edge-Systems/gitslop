import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  GitCommit,
  GitBranch,
  Globe,
  User,
  Calendar,
  FileText,
  ShieldCheck,
  ShieldAlert,
  FilePlus,
  FileMinus,
  FileEdit,
  FileSymlink,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  List,
  FolderTree,
  Folder,
  FolderOpen,
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2
} from 'lucide-react'
import styles from './DetailPanel.module.css'
import type { CommitDetail, CommitFileDetail } from './CommitGraph'
import type { FileListView } from '../hooks/useLayoutState'

/** Tree node for directory tree view of changed files */
interface FileTreeNode {
  name: string
  fullPath: string
  isDir: boolean
  children: FileTreeNode[]
  file?: CommitFileDetail
  /** True if this directory (or any descendant) contains at least one changed file */
  containsChanges?: boolean
}

/** Build a directory tree from a flat list of file details */
function buildFileTree(files: CommitFileDetail[]): FileTreeNode[] {
  const root: FileTreeNode = { name: '', fullPath: '', isDir: true, children: [] }

  for (const file of files) {
    const parts = file.path.split('/')
    let current = root

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      const partPath = parts.slice(0, i + 1).join('/')

      if (isLast) {
        // Leaf file node
        current.children.push({
          name: part,
          fullPath: file.path,
          isDir: false,
          children: [],
          file
        })
      } else {
        // Directory node — find or create
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
  const sortTree = (nodes: FileTreeNode[]): void => {
    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    for (const node of nodes) {
      if (node.isDir) sortTree(node.children)
    }
  }
  sortTree(root.children)

  // Propagate "contains a changed file" up the tree so directories containing
  // any changed descendant can be visually highlighted (bold / accent color).
  const markChanges = (nodes: FileTreeNode[]): boolean => {
    let anyChanged = false
    for (const node of nodes) {
      if (node.isDir) {
        const childHasChange = markChanges(node.children)
        node.containsChanges = childHasChange
        if (childHasChange) anyChanged = true
      } else if (node.file && node.file.status !== 'unchanged') {
        anyChanged = true
      }
    }
    return anyChanged
  }
  markChanges(root.children)

  return root.children
}

/** Collect all directory paths in the tree — used to populate the
 *  collapsedDirs set for the "Collapse all" button. */
function collectAllDirPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: FileTreeNode[]): void => {
    for (const n of list) {
      if (n.isDir) {
        out.push(n.fullPath)
        walk(n.children)
      }
    }
  }
  walk(nodes)
  return out
}

/** Collect directory paths that contain NO changed descendants. Used by the
 *  "All files" mode to auto-collapse irrelevant parts of the tree on large
 *  projects while keeping the paths leading to changed files expanded. */
function collectUnchangedDirPaths(nodes: FileTreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: FileTreeNode[]): void => {
    for (const n of list) {
      if (n.isDir) {
        if (!n.containsChanges) {
          // Collapse this dir — no need to walk its children since they'd
          // also be hidden when the parent is collapsed.
          out.push(n.fullPath)
        } else {
          // Recurse — a changed child's siblings may still be unchanged dirs
          // that should be collapsed.
          walk(n.children)
        }
      }
    }
  }
  walk(nodes)
  return out
}

/** Recursive component to render a tree node */
function FileTreeNodeComponent({
  node,
  depth,
  onFileClick,
  selectedFilePath,
  collapsedDirs,
  onToggleDir
}: {
  node: FileTreeNode
  depth: number
  onFileClick: (file: CommitFileDetail) => void
  selectedFilePath?: string | null
  collapsedDirs: Set<string>
  onToggleDir: (fullPath: string) => void
}): React.JSX.Element {
  if (node.isDir) {
    const expanded = !collapsedDirs.has(node.fullPath)
    const hasChanges = !!node.containsChanges
    return (
      <li>
        <button
          className={`${styles.treeDir} ${hasChanges ? styles.treeDirChanged : ''}`}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => onToggleDir(node.fullPath)}
          title={hasChanges ? `${node.name} (contains changes)` : node.name}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? <FolderOpen size={12} className={styles.treeDirIcon} /> : <Folder size={12} className={styles.treeDirIcon} />}
          <span className={styles.treeDirName}>{node.name}</span>
          {hasChanges && <span className={styles.treeDirChangeDot} aria-hidden="true" />}
        </button>
        {expanded && (
          <ul className={styles.treeChildren}>
            {node.children.map((child) => (
              <FileTreeNodeComponent
                key={child.fullPath}
                node={child}
                depth={depth + 1}
                onFileClick={onFileClick}
                selectedFilePath={selectedFilePath}
                collapsedDirs={collapsedDirs}
                onToggleDir={onToggleDir}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  // File leaf node
  const file = node.file!
  const isSelected = selectedFilePath === file.path
  const isUnchanged = file.status === 'unchanged'
  return (
    <li>
      <button
        className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''} ${isUnchanged ? styles.fileItemUnchanged : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => onFileClick(file)}
        title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
      >
        <FileStatusIcon status={file.status} />
        <span className={styles.fileName}>{node.name}</span>
        {(file.insertions > 0 || file.deletions > 0) && (
          <span className={styles.fileStats}>
            {file.insertions > 0 && <span className={styles.statsAdded}>+{file.insertions}</span>}
            {file.deletions > 0 && <span className={styles.statsRemoved}>-{file.deletions}</span>}
          </span>
        )}
      </button>
    </li>
  )
}

interface DetailPanelProps {
  detail: CommitDetail | null
  repoPath: string | null
  /** Callback when a file is clicked in the changed files list */
  onFileClick?: (file: CommitFileDetail, commitHash: string, opts?: { forceFileView?: boolean }) => void
  /** Path of the currently selected file (whose diff is open in center panel) */
  selectedFilePath?: string | null
  /** Current file list view mode */
  fileListView?: FileListView
  /** Callback to change file list view mode */
  onFileListViewChange?: (view: FileListView) => void
  /** Whether to show every file in the tree at this commit (not just changed) */
  showAllFiles?: boolean
  /** Callback to toggle showAllFiles */
  onShowAllFilesChange?: (show: boolean) => void
  /** Internal split: percent for metadata share (top) vs files (bottom) */
  detailInternalSplit?: number
  /** Callback to change internal split */
  onDetailInternalSplitChange?: (split: number) => void
  /** Whether the detail panel is collapsed to just its header */
  collapsed?: boolean
  /** Callback to toggle collapse */
  onToggleCollapse?: () => void
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Returns the appropriate Lucide icon for a file status */
function FileStatusIcon({ status, size = 12 }: { status: string; size?: number }): React.JSX.Element {
  switch (status) {
    case 'A':
      return <FilePlus size={size} className={styles.fileAdded} />
    case 'D':
      return <FileMinus size={size} className={styles.fileDeleted} />
    case 'R':
    case 'C':
      return <FileSymlink size={size} className={styles.fileRenamed} />
    case 'unchanged':
      return <FileText size={size} className={styles.fileUnchanged} />
    case 'M':
    default:
      return <FileEdit size={size} className={styles.fileModified} />
  }
}

/** Extracts just the filename from a full path */
function splitPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash === -1) return { dir: '', name: filePath }
  return { dir: filePath.substring(0, lastSlash + 1), name: filePath.substring(lastSlash + 1) }
}

export function DetailPanel({ detail, repoPath, onFileClick, selectedFilePath, fileListView = 'path', onFileListViewChange, showAllFiles = false, onShowAllFilesChange, detailInternalSplit = 40, onDetailInternalSplitChange, collapsed = false, onToggleCollapse }: DetailPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const splitContainerRef = useRef<HTMLDivElement>(null)
  const isDraggingInternalSplitRef = useRef(false)
  const [isDraggingInternalSplit, setIsDraggingInternalSplit] = useState(false)
  const [copiedSha, setCopiedSha] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(true)
  const [branchesExpanded, setBranchesExpanded] = useState(true)
  const [branchesContaining, setBranchesContaining] = useState<{ local: string[]; remote: string[] } | null>(null)
  const [branchesLoading, setBranchesLoading] = useState(false)

  // Internal split drag handlers
  const handleInternalSplitDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingInternalSplitRef.current = true
    setIsDraggingInternalSplit(true)
    document.body.classList.add('sidebar-dragging')
    const startY = e.clientY
    const startSplit = detailInternalSplit

    const handleMouseMove = (ev: MouseEvent): void => {
      if (!isDraggingInternalSplitRef.current || !splitContainerRef.current) return
      const containerHeight = splitContainerRef.current.getBoundingClientRect().height
      if (containerHeight <= 0) return
      const deltaY = ev.clientY - startY
      const deltaPct = (deltaY / containerHeight) * 100
      const newSplit = startSplit + deltaPct
      onDetailInternalSplitChange?.(newSplit)
    }

    const handleMouseUp = (): void => {
      isDraggingInternalSplitRef.current = false
      setIsDraggingInternalSplit(false)
      document.body.classList.remove('sidebar-dragging')
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }, [detailInternalSplit, onDetailInternalSplitChange])

  const handleInternalSplitDoubleClick = useCallback(() => {
    onDetailInternalSplitChange?.(40)
  }, [onDetailInternalSplitChange])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      document.body.classList.remove('sidebar-dragging')
    }
  }, [])

  // Fetch branches containing the selected commit
  useEffect(() => {
    const commitHash = detail?.commit?.hash
    if (!commitHash || !repoPath) {
      setBranchesContaining(null)
      return
    }

    let cancelled = false
    setBranchesLoading(true)

    window.electronAPI.git
      .getBranchesContaining(repoPath, commitHash)
      .then((result) => {
        if (cancelled) return
        if (result.success && result.data) {
          setBranchesContaining(result.data as { local: string[]; remote: string[] })
        } else {
          setBranchesContaining({ local: [], remote: [] })
        }
      })
      .catch(() => {
        if (!cancelled) setBranchesContaining({ local: [], remote: [] })
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [detail?.commit?.hash, repoPath])

  // ALL hooks must be above the early return to avoid React error #310
  // ("Rendered more hooks than during the previous render")
  const commit = detail?.commit
  const fileDetails = detail?.fileDetails ?? []
  const totalInsertions = detail?.totalInsertions ?? 0
  const totalDeletions = detail?.totalDeletions ?? 0
  const refs = detail?.refs ?? []

  // ─── All-files-at-commit fetch ────────────────────────────────────────────
  // When showAllFiles is toggled on, fetch `git ls-tree -r <hash>` to get every
  // path that exists at this commit, then merge with the changed files list.
  // Unchanged files become placeholder entries (no stats, no status) that are
  // visually browsable but not clickable-for-diff.
  const [allFilePaths, setAllFilePaths] = useState<string[] | null>(null)
  const [allFilesLoading, setAllFilesLoading] = useState(false)
  const [allFilesError, setAllFilesError] = useState<string | null>(null)

  useEffect(() => {
    if (!showAllFiles || !repoPath || !commit?.hash) {
      setAllFilePaths(null)
      setAllFilesError(null)
      return
    }
    let cancelled = false
    setAllFilesLoading(true)
    setAllFilesError(null)
    window.electronAPI.git
      .listFilesAtCommit(repoPath, commit.hash)
      .then((result) => {
        if (cancelled) return
        if (result.success && Array.isArray(result.data)) {
          setAllFilePaths(result.data as string[])
        } else {
          setAllFilesError(result.error || 'Failed to list files at commit')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setAllFilesError(err instanceof Error ? err.message : 'Failed to list files at commit')
      })
      .finally(() => {
        if (!cancelled) setAllFilesLoading(false)
      })
    return () => { cancelled = true }
  }, [showAllFiles, repoPath, commit?.hash])

  // ─── Tree view expansion state ───────────────────────────────────────────
  // Set of directory fullPaths that are currently collapsed. Default:
  //   - "changed files only" mode: all expanded (empty set) — the tree is
  //     already small because it only contains dirs that changed.
  //   - "all files" mode: auto-collapse every dir that contains NO changed
  //     descendants, so big repos stay navigable. The paths leading from the
  //     repo root down to each changed file stay expanded automatically.
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  useEffect(() => {
    setCollapsedDirs(new Set())
  }, [commit?.hash])

  const toggleDir = useCallback((fullPath: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(fullPath)) next.delete(fullPath)
      else next.add(fullPath)
      return next
    })
  }, [])

  // Merged file list used when "show all files" is active. Changed files keep
  // their full metadata (status + stats); unchanged files are emitted as
  // placeholder entries with status='unchanged' so the renderer can style them
  // differently and skip the diff click handler.
  const mergedFileList: CommitFileDetail[] = useMemo(() => {
    if (!showAllFiles || !allFilePaths) return fileDetails
    const changedByPath = new Map<string, CommitFileDetail>()
    for (const f of fileDetails) changedByPath.set(f.path, f)
    // Also index by oldPath for renames so the source path shows the rename row
    const merged: CommitFileDetail[] = []
    const seenChanged = new Set<string>()
    for (const path of allFilePaths) {
      const changed = changedByPath.get(path)
      if (changed) {
        merged.push(changed)
        seenChanged.add(path)
      } else {
        merged.push({
          path,
          oldPath: undefined,
          status: 'unchanged',
          insertions: 0,
          deletions: 0
        } as CommitFileDetail)
      }
    }
    // Deleted files are in fileDetails but NOT in ls-tree (they no longer exist
    // at this commit). Append them so the user still sees the full picture.
    for (const f of fileDetails) {
      if (!seenChanged.has(f.path)) merged.push(f)
    }
    return merged
  }, [showAllFiles, allFilePaths, fileDetails])

  // Memoized file tree shared by the renderer, Expand/Collapse All buttons,
  // and the auto-collapse-unchanged-dirs effect below.
  const mergedFileTree = useMemo(() => buildFileTree(mergedFileList), [mergedFileList])

  // Auto-collapse effect: when "All files" mode activates AND the full file
  // list has finished loading, collapse every dir that contains no changed
  // descendants. Preserves the paths leading down to changed files so users
  // can still find what actually changed on a large project.
  useEffect(() => {
    if (!showAllFiles || !allFilePaths) return
    setCollapsedDirs(new Set(collectUnchangedDirPaths(mergedFileTree)))
  }, [showAllFiles, allFilePaths, mergedFileTree])

  const sigOk = commit?.signatureStatus === 'good'
  const sigBad = commit?.signatureStatus === 'bad' || commit?.signatureStatus === 'error'
  const hasSig = commit?.signatureStatus !== 'none' && commit?.signatureStatus !== undefined

  // Copy SHA to clipboard
  const handleCopySha = useCallback(async () => {
    if (!commit) return
    try {
      await navigator.clipboard.writeText(commit.hash)
      setCopiedSha(true)
      setTimeout(() => setCopiedSha(false), 2000)
    } catch {
      // Fallback: select all text
    }
  }, [commit?.hash])

  // Handle file click — delegate to parent via onFileClick callback.
  // Unchanged files (from "All files" mode) have no diff, so force the
  // center pane into File view when one is clicked.
  const handleFileClick = useCallback((file: CommitFileDetail) => {
    if (!commit) return
    const forceFileView = file.status === 'unchanged'
    onFileClick?.(file, commit.hash, forceFileView ? { forceFileView: true } : undefined)
  }, [onFileClick, commit?.hash])

  const fileCount = fileDetails.length

  // Show empty state when no commit is selected
  if (!detail || !commit) {
    return (
      <div ref={panelRef} className={styles.detailPanel}>
        <button className={styles.header} onClick={onToggleCollapse}>
          <span className={styles.headerLeft}>
            <span className={styles.headerChevron}>
              {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
            </span>
            <span className={styles.headerTitle}>Commit Details</span>
          </span>
        </button>
        {!collapsed && (
          <div className={styles.emptyState}>
            <GitCommit size={48} className={styles.emptyStateIcon} />
            <span className={styles.emptyStateText}>Select a commit to view details</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className={styles.detailPanel}
    >
      <button className={styles.header} onClick={onToggleCollapse} style={{ cursor: onToggleCollapse ? 'pointer' : 'default', width: '100%', border: 'none', textAlign: 'left' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-xs)' }}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          <span className={styles.headerTitle}>Commit Details</span>
        </span>
      </button>

      {collapsed ? null : <div ref={splitContainerRef} style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
        {/* Metadata section (top) */}
        <div style={{
          height: `calc(${detailInternalSplit}% - 2px)`,
          minHeight: 100,
          overflow: 'hidden',
          transition: isDraggingInternalSplit ? 'none' : undefined
        }}>
          <div className={styles.content}>
            {/* Commit subject */}
            <h3 className={styles.subject}>{commit.subject}</h3>

            {/* Refs (branches, tags) */}
            {refs.length > 0 && (
              <div className={styles.refs}>
                {refs.map((ref) => (
                  <span key={ref.name} className={`${styles.refBadge} ${styles[`ref${ref.type.charAt(0).toUpperCase()}${ref.type.slice(1)}`] || ''}`}>
                    {ref.name}
                  </span>
                ))}
              </div>
            )}

            {/* Metadata */}
            <div className={styles.meta}>
              <div className={styles.metaRow}>
                <GitCommit size={14} className={styles.metaIcon} />
                <code
                  className={styles.sha}
                  onClick={handleCopySha}
                  title="Click to copy full SHA"
                >
                  {commit.hash}
                </code>
                <button className={styles.copyBtn} onClick={handleCopySha} title="Copy SHA">
                  {copiedSha ? (
                    <>
                      <Check size={12} className={styles.copySuccess} />
                      <span className={styles.copiedText}>Copied!</span>
                    </>
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
              <div className={styles.metaRow}>
                <User size={14} className={styles.metaIcon} />
                <span>{commit.authorName} &lt;{commit.authorEmail}&gt;</span>
              </div>
              <div className={styles.metaRow}>
                <Calendar size={14} className={styles.metaIcon} />
                <span className={styles.dateAbsolute}>{formatAbsoluteDate(commit.authorDate)}</span>
                <span className={styles.dateRelative}>({formatRelativeDate(commit.authorDate)})</span>
              </div>
              {hasSig && (
                <div className={styles.metaRow}>
                  {sigOk ? <ShieldCheck size={14} className={styles.sigGood} /> : sigBad ? <ShieldAlert size={14} className={styles.sigBad} /> : <ShieldAlert size={14} className={styles.metaIcon} />}
                  <span>{sigOk ? 'Verified' : sigBad ? 'Bad signature' : commit.signatureStatus}</span>
                </div>
              )}
            </div>

            {/* Body */}
            {commit.body && (
              <pre className={styles.body}>{commit.body}</pre>
            )}

            {/* Branches containing this commit */}
            <div className={styles.branchesSection}>
              <button
                className={styles.branchesHeader}
                onClick={() => setBranchesExpanded(!branchesExpanded)}
              >
                {branchesExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <GitBranch size={12} />
                <span>Branches</span>
                {branchesLoading && <Loader2 size={12} className={styles.branchesSpinner} />}
              </button>
              {branchesExpanded && (
                <div className={styles.branchesList}>
                  {branchesLoading ? (
                    <span className={styles.branchesLoading}>Loading branches…</span>
                  ) : !branchesContaining ||
                    (branchesContaining.local.length === 0 &&
                      branchesContaining.remote.length === 0) ? (
                    <span className={styles.branchesEmpty}>No branches</span>
                  ) : (
                    <>
                      {branchesContaining.local.map((b) => (
                        <span key={`local:${b}`} className={styles.branchItem}>
                          <GitBranch size={11} className={styles.branchItemIcon} />
                          <span className={styles.branchItemName}>{b}</span>
                        </span>
                      ))}
                      {branchesContaining.remote.map((b) => (
                        <span key={`remote:${b}`} className={`${styles.branchItem} ${styles.branchItemRemote}`}>
                          <Globe size={11} className={styles.branchItemIcon} />
                          <span className={styles.branchItemName}>{b}</span>
                        </span>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Drag handle */}
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

        {/* Files section (bottom) */}
        <div style={{
          height: `calc(${100 - detailInternalSplit}% - 3px)`,
          minHeight: 80,
          overflow: 'hidden',
          transition: isDraggingInternalSplit ? 'none' : undefined
        }}>
          <div className={styles.filesWrapper}>
            <div className={styles.filesSection} style={{ borderTop: 'none' }}>
              <div className={styles.filesHeaderRow}>
                <button
                  className={styles.filesHeader}
                  onClick={() => setFilesExpanded(!filesExpanded)}
                >
                  {filesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <FileText size={14} />
                  <span className={styles.filesTitle}>
                    {fileCount} file{fileCount !== 1 ? 's' : ''} changed
                  </span>
                  {(totalInsertions > 0 || totalDeletions > 0) && (
                    <span className={styles.statsSummary}>
                      {totalInsertions > 0 && <span className={styles.statsAdded}>+{totalInsertions}</span>}
                      {totalInsertions > 0 && totalDeletions > 0 && ' '}
                      {totalDeletions > 0 && <span className={styles.statsRemoved}>-{totalDeletions}</span>}
                    </span>
                  )}
                </button>
                {filesExpanded && (
                  <div className={styles.viewToggle}>
                    <label
                      className={styles.showAllFilesToggle}
                      title="Also show every unchanged file in the tree at this commit"
                    >
                      <input
                        type="checkbox"
                        checked={showAllFiles}
                        onChange={(e) => onShowAllFilesChange?.(e.target.checked)}
                      />
                      <span>All files</span>
                    </label>
                    {fileListView === 'tree' && (
                      <>
                        <button
                          className={styles.viewToggleBtn}
                          onClick={() => setCollapsedDirs(new Set())}
                          title="Expand all directories"
                        >
                          <ChevronsUpDown size={14} />
                        </button>
                        <button
                          className={styles.viewToggleBtn}
                          onClick={() => setCollapsedDirs(new Set(collectAllDirPaths(mergedFileTree)))}
                          title="Collapse all directories"
                        >
                          <ChevronsDownUp size={14} />
                        </button>
                      </>
                    )}
                    <button
                      className={`${styles.viewToggleBtn} ${fileListView === 'path' ? styles.viewToggleBtnActive : ''}`}
                      onClick={() => onFileListViewChange?.('path')}
                      title="Flat list view"
                    >
                      <List size={14} />
                    </button>
                    <button
                      className={`${styles.viewToggleBtn} ${fileListView === 'tree' ? styles.viewToggleBtnActive : ''}`}
                      onClick={() => onFileListViewChange?.('tree')}
                      title="Directory tree view"
                    >
                      <FolderTree size={14} />
                    </button>
                  </div>
                )}
              </div>

              {filesExpanded && showAllFiles && allFilesLoading && (
                <div className={styles.filesLoadingState}>
                  <Loader2 size={14} className={styles.spinnerIcon} /> Loading file tree…
                </div>
              )}
              {filesExpanded && showAllFiles && allFilesError && (
                <div className={styles.filesErrorState}>{allFilesError}</div>
              )}

              {filesExpanded && fileListView === 'path' && (
                <ul className={styles.fileList}>
                  {mergedFileList.map((file) => {
                    const { dir, name } = splitPath(file.path)
                    const isSelected = selectedFilePath === file.path
                    const isUnchanged = file.status === 'unchanged'
                    return (
                      <li key={file.path}>
                        <button
                          className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''} ${isUnchanged ? styles.fileItemUnchanged : ''}`}
                          onClick={() => handleFileClick(file)}
                          title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                        >
                          <FileStatusIcon status={file.status} />
                          <span className={styles.fileName}>
                            {dir && <span className={styles.fileDir}>{dir}</span>}
                            {name}
                          </span>
                          {(file.insertions > 0 || file.deletions > 0) && (
                            <span className={styles.fileStats}>
                              {file.insertions > 0 && <span className={styles.statsAdded}>+{file.insertions}</span>}
                              {file.deletions > 0 && <span className={styles.statsRemoved}>-{file.deletions}</span>}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {filesExpanded && fileListView === 'tree' && (
                <ul className={styles.fileList}>
                  {mergedFileTree.map((node) => (
                    <FileTreeNodeComponent
                      key={node.fullPath}
                      node={node}
                      depth={0}
                      onFileClick={handleFileClick}
                      selectedFilePath={selectedFilePath}
                      collapsedDirs={collapsedDirs}
                      onToggleDir={toggleDir}
                    />
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>}
    </div>
  )
}
