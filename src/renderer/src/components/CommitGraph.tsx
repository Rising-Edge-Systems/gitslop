import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, useListCallbackRef } from 'react-window'
import { DiffViewer } from './DiffViewer'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GitCommit {
  hash: string
  shortHash: string
  parentHashes: string[]
  authorName: string
  authorEmail: string
  authorDate: string
  committerName: string
  committerEmail: string
  commitDate: string
  subject: string
  body: string
  refs: string
}

interface GraphNode {
  commit: GitCommit
  column: number
  parents: { hash: string; fromCol: number; toCol: number }[]
  isMerge: boolean
  refs: ParsedRef[]
}

interface ParsedRef {
  name: string
  type: 'head' | 'branch' | 'remote' | 'tag'
}

export interface CommitDetail {
  commit: GitCommit
  files: string[]
  refs: ParsedRef[]
}

interface CommitGraphProps {
  repoPath: string
  onRefresh?: () => void
  onCommitSelect?: (detail: CommitDetail | null) => void
}

interface ContextMenuState {
  x: number
  y: number
  commit: GitCommit
  refs: ParsedRef[]
}

// ─── Colors for branch lanes ──────────────────────────────────────────────────

const LANE_COLORS = [
  '#89b4fa', // blue
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#fab387', // peach
  '#cba6f7', // mauve
  '#f38ba8', // red
  '#94e2d5', // teal
  '#f5c2e7', // pink
  '#74c7ec', // sapphire
  '#eba0ac', // maroon
]

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 34
const GRAPH_COL_WIDTH = 16
const GRAPH_LEFT_PAD = 12
const NODE_RADIUS = 4
const GRAPH_MIN_WIDTH = 40

// ─── Graph Layout Algorithm ───────────────────────────────────────────────────

function computeGraphLayout(commits: GitCommit[]): GraphNode[] {
  if (commits.length === 0) return []

  const nodes: GraphNode[] = []
  // Track which columns are "active" (have a branch line running through them)
  const activeLanes: (string | null)[] = []

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const refs = parseRefs(commit.refs)

    // Find the column for this commit (it should already be reserved by a parent)
    let column = activeLanes.indexOf(commit.hash)
    if (column === -1) {
      // New branch head — find first empty lane
      column = activeLanes.indexOf(null)
      if (column === -1) {
        column = activeLanes.length
        activeLanes.push(commit.hash)
      } else {
        activeLanes[column] = commit.hash
      }
    }

    const parentLinks: GraphNode['parents'] = []
    const isMerge = commit.parentHashes.length > 1

    if (commit.parentHashes.length === 0) {
      // Root commit — free this lane
      activeLanes[column] = null
    } else {
      // First parent continues in the same column
      const firstParent = commit.parentHashes[0]
      activeLanes[column] = firstParent

      parentLinks.push({
        hash: firstParent,
        fromCol: column,
        toCol: column
      })

      // Additional parents (merge commits) get their own lanes
      for (let p = 1; p < commit.parentHashes.length; p++) {
        const parentHash = commit.parentHashes[p]
        let parentCol = activeLanes.indexOf(parentHash)

        if (parentCol === -1) {
          // Assign to first empty lane, or create new
          parentCol = activeLanes.indexOf(null)
          if (parentCol === -1) {
            parentCol = activeLanes.length
            activeLanes.push(parentHash)
          } else {
            activeLanes[parentCol] = parentHash
          }
        }

        parentLinks.push({
          hash: parentHash,
          fromCol: column,
          toCol: parentCol
        })
      }
    }

    // Trim trailing null lanes
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }

    nodes.push({
      commit,
      column,
      parents: parentLinks,
      isMerge,
      refs
    })
  }

  return nodes
}

function parseRefs(refString: string): ParsedRef[] {
  if (!refString.trim()) return []

  return refString.split(',').map((r) => r.trim()).filter(Boolean).map((ref) => {
    if (ref.startsWith('HEAD -> ')) {
      return { name: ref.replace('HEAD -> ', ''), type: 'head' as const }
    }
    if (ref === 'HEAD') {
      return { name: 'HEAD', type: 'head' as const }
    }
    if (ref.startsWith('tag: ')) {
      return { name: ref.replace('tag: ', ''), type: 'tag' as const }
    }
    if (ref.includes('/')) {
      return { name: ref, type: 'remote' as const }
    }
    return { name: ref, type: 'branch' as const }
  })
}

function getRelativeTime(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffSec = Math.floor(diffMs / 1000)
    const diffMin = Math.floor(diffSec / 60)
    const diffHour = Math.floor(diffMin / 60)
    const diffDay = Math.floor(diffHour / 24)
    const diffWeek = Math.floor(diffDay / 7)
    const diffMonth = Math.floor(diffDay / 30)
    const diffYear = Math.floor(diffDay / 365)

    if (diffSec < 60) return 'just now'
    if (diffMin < 60) return `${diffMin}m ago`
    if (diffHour < 24) return `${diffHour}h ago`
    if (diffDay < 7) return `${diffDay}d ago`
    if (diffWeek < 5) return `${diffWeek}w ago`
    if (diffMonth < 12) return `${diffMonth}mo ago`
    return `${diffYear}y ago`
  } catch {
    return ''
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return dateStr
  }
}

// ─── Graph Canvas Renderer ────────────────────────────────────────────────────

interface GraphCanvasProps {
  nodes: GraphNode[]
  maxColumns: number
  height: number
  scrollOffset: number
  visibleStartIndex: number
  visibleStopIndex: number
}

function GraphCanvas({
  nodes,
  maxColumns,
  height,
  scrollOffset,
  visibleStartIndex,
  visibleStopIndex
}: GraphCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = Math.max(GRAPH_MIN_WIDTH, GRAPH_LEFT_PAD + maxColumns * GRAPH_COL_WIDTH + GRAPH_LEFT_PAD)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Render a buffer around visible range
    const renderStart = Math.max(0, visibleStartIndex - 5)
    const renderStop = Math.min(nodes.length - 1, visibleStopIndex + 5)

    for (let i = renderStart; i <= renderStop; i++) {
      const node = nodes[i]
      const y = i * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset
      const x = GRAPH_LEFT_PAD + node.column * GRAPH_COL_WIDTH

      // Draw lines to parents
      for (const parent of node.parents) {
        const parentIdx = nodes.findIndex((n) => n.commit.hash === parent.hash)
        const fromX = GRAPH_LEFT_PAD + parent.fromCol * GRAPH_COL_WIDTH
        const toX = GRAPH_LEFT_PAD + parent.toCol * GRAPH_COL_WIDTH

        ctx.beginPath()
        ctx.strokeStyle = LANE_COLORS[parent.toCol % LANE_COLORS.length]
        ctx.lineWidth = 2

        if (parentIdx === -1) {
          // Parent not in visible data — draw line going down off screen
          const endY = height + ROW_HEIGHT - scrollOffset

          if (fromX === toX) {
            ctx.moveTo(fromX, y)
            ctx.lineTo(toX, endY)
          } else {
            ctx.moveTo(fromX, y)
            ctx.bezierCurveTo(fromX, y + ROW_HEIGHT * 0.5, toX, y + ROW_HEIGHT * 0.5, toX, y + ROW_HEIGHT)
            ctx.moveTo(toX, y + ROW_HEIGHT)
            ctx.lineTo(toX, endY)
          }
        } else {
          const parentY = parentIdx * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset

          if (fromX === toX) {
            ctx.moveTo(fromX, y)
            ctx.lineTo(toX, parentY)
          } else {
            const midY = y + ROW_HEIGHT * 0.7
            ctx.moveTo(fromX, y)
            ctx.bezierCurveTo(fromX, midY, toX, midY, toX, parentY)
          }
        }
        ctx.stroke()
      }

      // Draw node circle
      ctx.beginPath()
      ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)

      const hasHead = node.refs.some((r) => r.type === 'head')

      if (hasHead) {
        ctx.fillStyle = LANE_COLORS[node.column % LANE_COLORS.length]
        ctx.fill()
        ctx.strokeStyle = '#cdd6f4'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (node.isMerge) {
        ctx.fillStyle = '#1e1e2e'
        ctx.fill()
        ctx.strokeStyle = LANE_COLORS[node.column % LANE_COLORS.length]
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        ctx.fillStyle = LANE_COLORS[node.column % LANE_COLORS.length]
        ctx.fill()
      }
    }
  }, [nodes, maxColumns, height, scrollOffset, visibleStartIndex, visibleStopIndex, width])

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="commit-graph-canvas"
      style={{ width, height, position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    />
  )
}

// ─── Commit Row Component (for react-window v2 rowComponent API) ──────────────

interface CommitRowProps {
  nodes: GraphNode[]
  graphWidth: number
  selectedHash: string | null
  onRowClick: (index: number, event: React.MouseEvent) => void
  onRowContextMenu: (index: number, event: React.MouseEvent) => void
}

function CommitRowComponent(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & CommitRowProps): React.ReactElement {
  const { index, style, nodes, graphWidth, selectedHash, onRowClick, onRowContextMenu } = props
  const node = nodes[index]
  const { commit, refs } = node
  const isSelected = commit.hash === selectedHash

  const handleClick = useCallback((e: React.MouseEvent) => {
    onRowClick(index, e)
  }, [index, onRowClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onRowContextMenu(index, e)
  }, [index, onRowContextMenu])

  return (
    <div
      className={`commit-graph-row${isSelected ? ' commit-graph-row-selected' : ''}`}
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      data-index={index}
    >
      {/* Graph space (transparent — canvas draws underneath) */}
      <div className="commit-graph-lane" style={{ minWidth: graphWidth, width: graphWidth }} />

      {/* Commit info */}
      <div className="commit-graph-info">
        <span className="commit-graph-hash" title={commit.hash}>{commit.shortHash}</span>

        {refs.length > 0 && (
          <span className="commit-graph-refs">
            {refs.map((ref, idx) => (
              <span
                key={idx}
                className={`commit-graph-ref commit-graph-ref-${ref.type}`}
                title={ref.name}
              >
                {ref.type === 'head' && <span className="commit-graph-ref-head-icon">&#x25CF; </span>}
                {ref.name}
              </span>
            ))}
          </span>
        )}

        <span className="commit-graph-message" title={commit.subject}>
          {commit.subject}
        </span>
      </div>

      <span className="commit-graph-author" title={commit.authorEmail}>
        {commit.authorName}
      </span>

      <span className="commit-graph-date" title={commit.authorDate}>
        {getRelativeTime(commit.authorDate)}
      </span>
    </div>
  )
}

// ─── Context Menu Component ──────────────────────────────────────────────────

interface CommitContextMenuProps {
  state: ContextMenuState
  onClose: () => void
  onAction: (action: string, commit: GitCommit) => void
}

function CommitContextMenu({ state, onClose, onAction }: CommitContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position if near edge of window
  const style: React.CSSProperties = {
    position: 'fixed',
    left: state.x,
    top: state.y,
    zIndex: 2000
  }

  const items = [
    { label: 'Cherry-pick', action: 'cherry-pick', icon: '\u{1F352}' },
    { label: 'Revert', action: 'revert', icon: '\u21A9' },
    { label: 'Reset current branch to here', action: 'reset', icon: '\u23EA' },
    { label: '---', action: '', icon: '' },
    { label: 'Create branch here...', action: 'create-branch', icon: '\u{1F33F}' },
    { label: 'Create tag here...', action: 'create-tag', icon: '\u{1F3F7}' },
    { label: '---', action: '', icon: '' },
    { label: 'Copy SHA', action: 'copy-sha', icon: '\u{1F4CB}' },
  ]

  return (
    <div className="commit-ctx-menu" ref={menuRef} style={style}>
      {items.map((item, idx) => {
        if (item.label === '---') {
          return <div key={idx} className="commit-ctx-menu-separator" />
        }
        return (
          <button
            key={idx}
            className="commit-ctx-menu-item"
            onClick={() => {
              onAction(item.action, state.commit)
              onClose()
            }}
          >
            <span className="commit-ctx-menu-icon">{item.icon}</span>
            <span className="commit-ctx-menu-label">{item.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Commit Detail Panel ─────────────────────────────────────────────────────

interface CommitDetailPanelProps {
  detail: CommitDetail
  repoPath: string
  onClose: () => void
  onFileDoubleClick?: (filePath: string) => void
}

function CommitDetailPanel({ detail, repoPath, onClose, onFileDoubleClick }: CommitDetailPanelProps): React.JSX.Element {
  const { commit, files, refs } = detail
  const [fileDiff, setFileDiff] = useState<{ path: string; content: string } | null>(null)
  const [fileDiffLoading, setFileDiffLoading] = useState(false)

  // Reset file diff when detail changes
  useEffect(() => {
    setFileDiff(null)
    setFileDiffLoading(false)
  }, [detail])

  const handleFileDoubleClick = useCallback(async (filePath: string) => {
    onFileDoubleClick?.(filePath)
    // Load diff for this file in this commit
    setFileDiffLoading(true)
    setFileDiff(null)
    try {
      const result = await window.electronAPI.git.showCommitFileDiff(repoPath, commit.hash, filePath)
      if (result.success && result.data) {
        setFileDiff({ path: filePath, content: result.data as string })
      } else {
        setFileDiff({ path: filePath, content: '(Failed to load diff)' })
      }
    } catch {
      setFileDiff({ path: filePath, content: '(Failed to load diff)' })
    } finally {
      setFileDiffLoading(false)
    }
  }, [onFileDoubleClick, repoPath, commit.hash])

  return (
    <div className="commit-detail-panel">
      <div className="commit-detail-header">
        <h3 className="commit-detail-title">Commit Details</h3>
        <button className="commit-detail-close" onClick={onClose} title="Close">&#x2715;</button>
      </div>

      <div className="commit-detail-body">
        {/* Subject */}
        <div className="commit-detail-subject">{commit.subject}</div>

        {/* Body (full message beyond subject) */}
        {commit.body && commit.body.trim() && (
          <div className="commit-detail-body-text">{commit.body.trim()}</div>
        )}

        {/* Refs */}
        {refs.length > 0 && (
          <div className="commit-detail-refs">
            {refs.map((ref, idx) => (
              <span key={idx} className={`commit-graph-ref commit-graph-ref-${ref.type}`}>
                {ref.name}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className="commit-detail-meta">
          <div className="commit-detail-meta-row">
            <span className="commit-detail-meta-label">Hash</span>
            <span className="commit-detail-meta-value commit-detail-hash" title="Click to copy">
              <code>{commit.hash}</code>
            </span>
          </div>
          <div className="commit-detail-meta-row">
            <span className="commit-detail-meta-label">Author</span>
            <span className="commit-detail-meta-value">
              {commit.authorName} &lt;{commit.authorEmail}&gt;
            </span>
          </div>
          <div className="commit-detail-meta-row">
            <span className="commit-detail-meta-label">Date</span>
            <span className="commit-detail-meta-value">{formatDate(commit.authorDate)}</span>
          </div>
          {commit.committerName !== commit.authorName && (
            <div className="commit-detail-meta-row">
              <span className="commit-detail-meta-label">Committer</span>
              <span className="commit-detail-meta-value">
                {commit.committerName} &lt;{commit.committerEmail}&gt;
              </span>
            </div>
          )}
          <div className="commit-detail-meta-row">
            <span className="commit-detail-meta-label">Parents</span>
            <span className="commit-detail-meta-value">
              {commit.parentHashes.length > 0
                ? commit.parentHashes.map((h) => h.substring(0, 7)).join(', ')
                : 'None (root commit)'}
            </span>
          </div>
        </div>

        {/* Changed files */}
        <div className="commit-detail-files">
          <div className="commit-detail-files-header">
            Changed Files <span className="commit-detail-files-count">{files.length}</span>
          </div>
          <div className="commit-detail-files-list">
            {files.map((file, idx) => (
              <div
                key={idx}
                className="commit-detail-file-item"
                onDoubleClick={() => handleFileDoubleClick(file)}
                title={`Double-click to view diff: ${file}`}
              >
                <span className="commit-detail-file-icon">{getFileIcon(file)}</span>
                <span className="commit-detail-file-name">{file}</span>
              </div>
            ))}
            {files.length === 0 && (
              <div className="commit-detail-files-empty">No changed files</div>
            )}
          </div>
        </div>

        {/* File diff viewer */}
        {fileDiffLoading && (
          <div className="commit-detail-diff-loading">Loading diff...</div>
        )}
        {fileDiff && !fileDiffLoading && (
          <div className="commit-detail-diff">
            <div className="commit-detail-diff-header">
              <span>Diff: {fileDiff.path}</span>
              <button
                className="commit-detail-diff-close"
                onClick={() => setFileDiff(null)}
                title="Close diff"
              >
                ✕
              </button>
            </div>
            <DiffViewer
              diffContent={fileDiff.content}
              filePath={fileDiff.path}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function getFileIcon(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, string> = {
    ts: '\u{1F1F9}', tsx: '\u{1F1F9}',
    js: '\u{1F1EF}', jsx: '\u{1F1EF}',
    json: '{}',
    css: '\u{1F3A8}', scss: '\u{1F3A8}', less: '\u{1F3A8}',
    html: '\u{1F310}',
    md: '\u{1F4DD}',
    py: '\u{1F40D}',
    rs: '\u{1F980}',
    go: '\u{1F439}',
  }
  return iconMap[ext] || '\u{1F4C4}'
}

// ─── Main CommitGraph Component ───────────────────────────────────────────────

export function CommitGraph({ repoPath, onRefresh, onCommitSelect }: CommitGraphProps): React.JSX.Element {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [visibleRange, setVisibleRange] = useState({ start: 0, stop: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [listRef, setListRef] = useListCallbackRef()
  const [containerHeight, setContainerHeight] = useState(400)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Load commits
  const loadCommits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.git.log(repoPath, { all: true })
      if (result.success && Array.isArray(result.data)) {
        setCommits(result.data as GitCommit[])
      } else {
        setCommits([])
        if (result.error) {
          setError(result.error)
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commits')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    loadCommits()
  }, [loadCommits])

  // Auto-refresh via interval
  useEffect(() => {
    const interval = setInterval(() => {
      loadCommits()
    }, 5000)
    return () => clearInterval(interval)
  }, [loadCommits])

  // Observe container size
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Compute graph layout
  const nodes = useMemo(() => computeGraphLayout(commits), [commits])

  const maxColumns = useMemo(() => {
    if (nodes.length === 0) return 1
    return Math.max(1, ...nodes.map((n) => n.column + 1))
  }, [nodes])

  const graphWidth = Math.max(GRAPH_MIN_WIDTH, GRAPH_LEFT_PAD + maxColumns * GRAPH_COL_WIDTH + GRAPH_LEFT_PAD)

  // Load commit detail when selected
  const loadCommitDetail = useCallback(async (hash: string, refs: ParsedRef[]) => {
    setLoadingDetail(true)
    try {
      const result = await window.electronAPI.git.showCommit(repoPath, hash)
      if (result.success && result.data) {
        const detail: CommitDetail = {
          commit: result.data.commit as GitCommit,
          files: result.data.files as string[],
          refs
        }
        setCommitDetail(detail)
        onCommitSelect?.(detail)
      }
    } catch {
      // Silently fail — detail panel won't show
    } finally {
      setLoadingDetail(false)
    }
  }, [repoPath, onCommitSelect])

  // Handle row click (select commit)
  const handleRowClick = useCallback((index: number, _event: React.MouseEvent) => {
    const node = nodes[index]
    if (!node) return

    if (selectedHash === node.commit.hash) {
      // Clicking same commit deselects
      setSelectedIndex(-1)
      setSelectedHash(null)
      setCommitDetail(null)
      onCommitSelect?.(null)
    } else {
      setSelectedIndex(index)
      setSelectedHash(node.commit.hash)
      loadCommitDetail(node.commit.hash, node.refs)
    }
  }, [nodes, selectedHash, loadCommitDetail, onCommitSelect])

  // Handle right-click context menu
  const handleRowContextMenu = useCallback((index: number, event: React.MouseEvent) => {
    event.preventDefault()
    const node = nodes[index]
    if (!node) return

    // Also select the commit
    setSelectedIndex(index)
    setSelectedHash(node.commit.hash)
    loadCommitDetail(node.commit.hash, node.refs)

    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      commit: node.commit,
      refs: node.refs
    })
  }, [nodes, loadCommitDetail])

  // Handle context menu actions (placeholders)
  const handleContextAction = useCallback((action: string, commit: GitCommit) => {
    switch (action) {
      case 'copy-sha':
        navigator.clipboard.writeText(commit.hash).catch(() => {
          // Clipboard write failed silently
        })
        break
      case 'cherry-pick':
      case 'revert':
      case 'reset':
      case 'create-branch':
      case 'create-tag':
        // Placeholder — these will be implemented in future stories
        console.log(`Action: ${action} on commit ${commit.shortHash}`)
        break
    }
  }, [])

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (nodes.length === 0) return

      let newIndex = selectedIndex

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          newIndex = selectedIndex < 0 ? 0 : Math.min(selectedIndex + 1, nodes.length - 1)
          break
        case 'ArrowUp':
          e.preventDefault()
          newIndex = selectedIndex < 0 ? 0 : Math.max(selectedIndex - 1, 0)
          break
        case 'Escape':
          setSelectedIndex(-1)
          setSelectedHash(null)
          setCommitDetail(null)
          onCommitSelect?.(null)
          return
        default:
          return
      }

      if (newIndex !== selectedIndex && newIndex >= 0) {
        const node = nodes[newIndex]
        setSelectedIndex(newIndex)
        setSelectedHash(node.commit.hash)
        loadCommitDetail(node.commit.hash, node.refs)

        // Scroll into view if needed
        if (listRef) {
          listRef.scrollToRow({ index: newIndex, align: 'smart' })
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [nodes, selectedIndex, listRef, loadCommitDetail, onCommitSelect])

  const handleScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    setScrollOffset(target.scrollTop)
  }, [])

  const handleRowsRendered = useCallback((
    visibleRows: { startIndex: number; stopIndex: number }
  ) => {
    setVisibleRange({ start: visibleRows.startIndex, stop: visibleRows.stopIndex })
  }, [])

  const handleRefresh = useCallback(() => {
    loadCommits()
    onRefresh?.()
  }, [loadCommits, onRefresh])

  const handleCloseDetail = useCallback(() => {
    setSelectedIndex(-1)
    setSelectedHash(null)
    setCommitDetail(null)
    onCommitSelect?.(null)
  }, [onCommitSelect])

  const rowProps = useMemo(() => ({
    nodes,
    graphWidth,
    selectedHash,
    onRowClick: handleRowClick,
    onRowContextMenu: handleRowContextMenu
  }), [nodes, graphWidth, selectedHash, handleRowClick, handleRowContextMenu])

  if (loading && commits.length === 0) {
    return (
      <div className="commit-graph-container" ref={containerRef}>
        <div className="commit-graph-loading">
          <span className="repo-view-spinner">&#x21BB;</span>
          Loading commit history...
        </div>
      </div>
    )
  }

  if (error && commits.length === 0) {
    return (
      <div className="commit-graph-container" ref={containerRef}>
        <div className="commit-graph-error">
          <span>&#9888;</span> {error}
          <button onClick={handleRefresh}>Retry</button>
        </div>
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="commit-graph-container" ref={containerRef}>
        <div className="commit-graph-empty">
          No commits yet. Make your first commit to see the graph.
        </div>
      </div>
    )
  }

  const viewportHeight = Math.max(100, containerHeight - 40)

  return (
    <div className="commit-graph-wrapper">
      <div
        className="commit-graph-container"
        ref={containerRef}
        tabIndex={0}
        role="listbox"
        aria-label="Commit graph"
      >
        <div className="commit-graph-header">
          <h3 className="commit-graph-title">
            Commit Graph
            <span className="commit-graph-count">{commits.length.toLocaleString()} commits</span>
          </h3>
          <button className="commit-graph-refresh" onClick={handleRefresh} title="Refresh">
            &#x21BB;
          </button>
        </div>

        <div className="commit-graph-viewport" onScroll={handleScroll}>
          <GraphCanvas
            nodes={nodes}
            maxColumns={maxColumns}
            height={viewportHeight}
            scrollOffset={scrollOffset}
            visibleStartIndex={visibleRange.start}
            visibleStopIndex={visibleRange.stop}
          />

          <List<CommitRowProps>
            listRef={setListRef}
            rowComponent={CommitRowComponent}
            rowCount={nodes.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            overscanCount={10}
            onRowsRendered={handleRowsRendered}
            className="commit-graph-list"
            style={{ height: viewportHeight }}
          />
        </div>

        {/* Context menu */}
        {contextMenu && (
          <CommitContextMenu
            state={contextMenu}
            onClose={() => setContextMenu(null)}
            onAction={handleContextAction}
          />
        )}
      </div>

      {/* Commit detail panel */}
      {(commitDetail || loadingDetail) && (
        <div className="commit-detail-wrapper">
          {loadingDetail && !commitDetail ? (
            <div className="commit-detail-panel">
              <div className="commit-detail-header">
                <h3 className="commit-detail-title">Commit Details</h3>
                <button className="commit-detail-close" onClick={handleCloseDetail}>&#x2715;</button>
              </div>
              <div className="commit-detail-loading">
                <span className="repo-view-spinner">&#x21BB;</span>
                Loading...
              </div>
            </div>
          ) : commitDetail ? (
            <CommitDetailPanel
              detail={commitDetail}
              repoPath={repoPath}
              onClose={handleCloseDetail}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
