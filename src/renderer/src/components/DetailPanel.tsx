import React, { useCallback, useEffect, useRef, useState } from 'react'
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

  return root.children
}

/** Recursive component to render a tree node */
function FileTreeNodeComponent({
  node,
  depth,
  onFileClick,
  selectedFilePath
}: {
  node: FileTreeNode
  depth: number
  onFileClick: (file: CommitFileDetail) => void
  selectedFilePath?: string | null
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true)

  if (node.isDir) {
    return (
      <li>
        <button
          className={styles.treeDir}
          style={{ paddingLeft: depth * 16 + 8 }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {expanded ? <FolderOpen size={12} className={styles.treeDirIcon} /> : <Folder size={12} className={styles.treeDirIcon} />}
          <span className={styles.treeDirName}>{node.name}</span>
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
  return (
    <li>
      <button
        className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''}`}
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
  onFileClick?: (file: CommitFileDetail, commitHash: string) => void
  /** Path of the currently selected file (whose diff is open in center panel) */
  selectedFilePath?: string | null
  /** Current file list view mode */
  fileListView?: FileListView
  /** Callback to change file list view mode */
  onFileListViewChange?: (view: FileListView) => void
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

export function DetailPanel({ detail, repoPath, onFileClick, selectedFilePath, fileListView = 'path', onFileListViewChange, detailInternalSplit = 40, onDetailInternalSplitChange, collapsed = false, onToggleCollapse }: DetailPanelProps): React.JSX.Element {
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

  // Handle file click — delegate to parent via onFileClick callback
  const handleFileClick = useCallback((file: CommitFileDetail) => {
    if (!commit) return
    onFileClick?.(file, commit.hash)
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

              {filesExpanded && fileListView === 'path' && (
                <ul className={styles.fileList}>
                  {fileDetails.map((file) => {
                    const { dir, name } = splitPath(file.path)
                    const isSelected = selectedFilePath === file.path
                    return (
                      <li key={file.path}>
                        <button
                          className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''}`}
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
                  {buildFileTree(fileDetails).map((node) => (
                    <FileTreeNodeComponent
                      key={node.fullPath}
                      node={node}
                      depth={0}
                      onFileClick={handleFileClick}
                      selectedFilePath={selectedFilePath}
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
