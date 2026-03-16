import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, useListCallbackRef } from 'react-window'
import { DiffViewer } from './DiffViewer'
import { ResetDialog } from './ResetDialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type SignatureStatus = 'good' | 'bad' | 'untrusted' | 'expired' | 'expired-key' | 'revoked' | 'error' | 'none'

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
  signatureStatus: SignatureStatus
  signer: string
  signingKey: string
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

interface CherryPickState {
  status: 'idle' | 'picking' | 'success' | 'conflict'
  message: string
  newHash?: string
  conflicts?: string[]
}

interface RevertState {
  status: 'idle' | 'reverting' | 'success' | 'conflict' | 'merge-prompt'
  message: string
  newHash?: string
  conflicts?: string[]
  commitHash?: string
  parentCount?: number
}

export interface CommitLogFilters {
  author?: string
  since?: string
  until?: string
  grep?: string
  path?: string
}

interface CommitGraphProps {
  repoPath: string
  onRefresh?: () => void
  onCommitSelect?: (detail: CommitDetail | null) => void
  filters?: CommitLogFilters
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
  selectedHashes: Set<string>
  onRowClick: (index: number, event: React.MouseEvent) => void
  onRowContextMenu: (index: number, event: React.MouseEvent) => void
}

function CommitRowComponent(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & CommitRowProps): React.ReactElement {
  const { index, style, nodes, graphWidth, selectedHash, selectedHashes, onRowClick, onRowContextMenu } = props
  const node = nodes[index]
  const { commit, refs } = node
  const isSelected = commit.hash === selectedHash || selectedHashes.has(commit.hash)

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

        {commit.signatureStatus && commit.signatureStatus !== 'none' && (
          <span
            className={`commit-graph-signature commit-graph-signature-${commit.signatureStatus}`}
            title={`GPG: ${commit.signatureStatus}${commit.signer ? ` by ${commit.signer}` : ''}`}
          >
            {commit.signatureStatus === 'good' ? '\u2714' :
             commit.signatureStatus === 'bad' ? '\u2718' :
             commit.signatureStatus === 'untrusted' ? '\u26A0' :
             '\u26A0'}
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
  multiSelectCount: number
  onClose: () => void
  onAction: (action: string, commit: GitCommit) => void
}

function CommitContextMenu({ state, multiSelectCount, onClose, onAction }: CommitContextMenuProps): React.JSX.Element {
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
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: state.x,
    top: state.y,
    zIndex: 2000
  }

  const cherryPickLabel = multiSelectCount > 1
    ? `Cherry-pick ${multiSelectCount} commits`
    : 'Cherry-pick'

  const items = [
    { label: cherryPickLabel, action: 'cherry-pick', icon: '\u{1F352}', shortcut: '' },
    { label: 'Revert', action: 'revert', icon: '\u21A9', shortcut: '' },
    { label: 'Reset current branch to here', action: 'reset', icon: '\u23EA', shortcut: '' },
    { label: '---', action: '', icon: '', shortcut: '' },
    { label: 'Create branch here...', action: 'create-branch', icon: '\u{1F33F}', shortcut: '' },
    { label: 'Create tag here...', action: 'create-tag', icon: '\u{1F3F7}', shortcut: '' },
    { label: '---', action: '', icon: '', shortcut: '' },
    { label: 'Copy SHA', action: 'copy-sha', icon: '\u{1F4CB}', shortcut: 'Ctrl+C' },
  ]

  return (
    <div className="commit-ctx-menu" ref={menuRef} style={menuStyle}>
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
            {item.shortcut && (
              <span className="commit-ctx-menu-shortcut">{item.shortcut}</span>
            )}
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
          {commit.signatureStatus && commit.signatureStatus !== 'none' && (
            <div className="commit-detail-meta-row">
              <span className="commit-detail-meta-label">Signature</span>
              <span className={`commit-detail-meta-value commit-graph-signature-${commit.signatureStatus}`}>
                {commit.signatureStatus === 'good' ? '\u2714 Valid' :
                 commit.signatureStatus === 'bad' ? '\u2718 Invalid' :
                 commit.signatureStatus === 'untrusted' ? '\u26A0 Untrusted' :
                 commit.signatureStatus === 'expired' ? '\u26A0 Expired' :
                 commit.signatureStatus === 'expired-key' ? '\u26A0 Expired Key' :
                 commit.signatureStatus === 'revoked' ? '\u26A0 Revoked' :
                 '\u26A0 Error'}
                {commit.signer && ` \u2014 ${commit.signer}`}
              </span>
            </div>
          )}
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

export function CommitGraph({ repoPath, onRefresh, onCommitSelect, filters }: CommitGraphProps): React.JSX.Element {
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
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set())
  const [cherryPickState, setCherryPickState] = useState<CherryPickState>({ status: 'idle', message: '' })
  const [revertState, setRevertState] = useState<RevertState>({ status: 'idle', message: '' })
  const [resetTarget, setResetTarget] = useState<{ hash: string; subject: string } | null>(null)

  // Load commits
  const loadCommits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const logOpts: { all: boolean; author?: string; since?: string; until?: string; grep?: string; path?: string } = { all: true }
      if (filters?.author) logOpts.author = filters.author
      if (filters?.since) logOpts.since = filters.since
      if (filters?.until) logOpts.until = filters.until
      if (filters?.grep) logOpts.grep = filters.grep
      if (filters?.path) logOpts.path = filters.path

      const result = await window.electronAPI.git.log(repoPath, logOpts)
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
  }, [repoPath, filters])

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

  // Handle row click (select commit, Ctrl+click for multi-select)
  const handleRowClick = useCallback((index: number, event: React.MouseEvent) => {
    const node = nodes[index]
    if (!node) return

    if (event.ctrlKey || event.metaKey) {
      // Multi-select toggle
      setSelectedHashes((prev) => {
        const next = new Set(prev)
        if (next.has(node.commit.hash)) {
          next.delete(node.commit.hash)
        } else {
          next.add(node.commit.hash)
        }
        // Also include the primary selected hash if it's the first multi-select
        if (selectedHash && !next.has(selectedHash) && prev.size === 0) {
          next.add(selectedHash)
        }
        if (next.size > 0) {
          next.add(node.commit.hash)
        }
        return next
      })
      setSelectedIndex(index)
      setSelectedHash(node.commit.hash)
      loadCommitDetail(node.commit.hash, node.refs)
    } else if (event.shiftKey && selectedIndex >= 0) {
      // Range select
      const start = Math.min(selectedIndex, index)
      const end = Math.max(selectedIndex, index)
      const rangeHashes = new Set<string>()
      for (let i = start; i <= end; i++) {
        if (nodes[i]) rangeHashes.add(nodes[i].commit.hash)
      }
      setSelectedHashes(rangeHashes)
      loadCommitDetail(node.commit.hash, node.refs)
    } else {
      // Normal single click
      setSelectedHashes(new Set())
      if (selectedHash === node.commit.hash) {
        setSelectedIndex(-1)
        setSelectedHash(null)
        setCommitDetail(null)
        onCommitSelect?.(null)
      } else {
        setSelectedIndex(index)
        setSelectedHash(node.commit.hash)
        loadCommitDetail(node.commit.hash, node.refs)
      }
    }
  }, [nodes, selectedHash, selectedIndex, loadCommitDetail, onCommitSelect])

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

  // Cherry-pick handler
  const handleCherryPick = useCallback(async (hashes: string[]) => {
    if (hashes.length === 0) return
    setCherryPickState({ status: 'picking', message: `Cherry-picking ${hashes.length} commit${hashes.length > 1 ? 's' : ''}...` })

    try {
      const result = await window.electronAPI.git.cherryPick(repoPath, hashes)
      if (result.success && result.data?.success) {
        setCherryPickState({
          status: 'success',
          message: `Cherry-pick successful!`,
          newHash: result.data.newHash
        })
        setSelectedHashes(new Set())
        loadCommits()
      } else if (result.data?.conflicts && result.data.conflicts.length > 0) {
        setCherryPickState({
          status: 'conflict',
          message: result.data?.message || 'Cherry-pick resulted in conflicts.',
          conflicts: result.data.conflicts
        })
      } else {
        setCherryPickState({
          status: 'conflict',
          message: result.error || result.data?.message || 'Cherry-pick failed.',
          conflicts: result.data?.conflicts || []
        })
      }
    } catch (err) {
      setCherryPickState({
        status: 'conflict',
        message: err instanceof Error ? err.message : 'Cherry-pick failed.',
        conflicts: []
      })
    }
  }, [repoPath, loadCommits])

  const handleCherryPickAbort = useCallback(async () => {
    try {
      await window.electronAPI.git.cherryPickAbort(repoPath)
      setCherryPickState({ status: 'idle', message: '' })
      loadCommits()
    } catch {
      // Ignore abort errors
      setCherryPickState({ status: 'idle', message: '' })
    }
  }, [repoPath, loadCommits])

  const handleCherryPickContinue = useCallback(async () => {
    setCherryPickState((prev) => ({ ...prev, status: 'picking', message: 'Continuing cherry-pick...' }))
    try {
      const result = await window.electronAPI.git.cherryPickContinue(repoPath)
      if (result.success && result.data?.success) {
        setCherryPickState({
          status: 'success',
          message: 'Cherry-pick completed successfully!'
        })
        loadCommits()
      } else {
        setCherryPickState({
          status: 'conflict',
          message: result.data?.message || result.error || 'More conflicts.',
          conflicts: result.data?.conflicts || []
        })
      }
    } catch (err) {
      setCherryPickState({
        status: 'conflict',
        message: err instanceof Error ? err.message : 'Continue failed.'
      })
    }
  }, [repoPath, loadCommits])

  // Revert handler
  const handleRevert = useCallback(async (hash: string, parentHashes: string[], parentNumber?: number) => {
    // If merge commit and no parent specified, prompt
    if (parentHashes.length > 1 && !parentNumber) {
      setRevertState({
        status: 'merge-prompt',
        message: 'This is a merge commit. Select which parent to revert against.',
        commitHash: hash,
        parentCount: parentHashes.length
      })
      return
    }

    setRevertState({ status: 'reverting', message: 'Reverting commit...' })

    try {
      const result = await window.electronAPI.git.revert(repoPath, hash, {
        parentNumber
      })
      if (result.success && result.data?.success) {
        setRevertState({
          status: 'success',
          message: 'Revert successful!',
          newHash: result.data.newHash
        })
        loadCommits()
      } else if (result.data?.conflicts && result.data.conflicts.length > 0) {
        setRevertState({
          status: 'conflict',
          message: result.data?.message || 'Revert resulted in conflicts.',
          conflicts: result.data.conflicts,
          commitHash: hash
        })
      } else {
        setRevertState({
          status: 'conflict',
          message: result.error || result.data?.message || 'Revert failed.',
          conflicts: result.data?.conflicts || [],
          commitHash: hash
        })
      }
    } catch (err) {
      setRevertState({
        status: 'conflict',
        message: err instanceof Error ? err.message : 'Revert failed.',
        conflicts: [],
        commitHash: hash
      })
    }
  }, [repoPath, loadCommits])

  const handleRevertAbort = useCallback(async () => {
    try {
      await window.electronAPI.git.revertAbort(repoPath)
      setRevertState({ status: 'idle', message: '' })
      loadCommits()
    } catch {
      setRevertState({ status: 'idle', message: '' })
    }
  }, [repoPath, loadCommits])

  const handleRevertContinue = useCallback(async () => {
    setRevertState((prev) => ({ ...prev, status: 'reverting', message: 'Continuing revert...' }))
    try {
      const result = await window.electronAPI.git.revertContinue(repoPath)
      if (result.success && result.data?.success) {
        setRevertState({
          status: 'success',
          message: 'Revert completed successfully!',
          newHash: result.data.newHash
        })
        loadCommits()
      } else {
        setRevertState({
          status: 'conflict',
          message: result.data?.message || result.error || 'More conflicts.',
          conflicts: result.data?.conflicts || []
        })
      }
    } catch (err) {
      setRevertState({
        status: 'conflict',
        message: err instanceof Error ? err.message : 'Continue failed.'
      })
    }
  }, [repoPath, loadCommits])

  // Handle context menu actions
  const handleContextAction = useCallback((action: string, commit: GitCommit) => {
    switch (action) {
      case 'copy-sha':
        navigator.clipboard.writeText(commit.hash).catch(() => {
          // Clipboard write failed silently
        })
        break
      case 'cherry-pick': {
        // Use multi-selected hashes if any, otherwise just the right-clicked commit
        const hashes = selectedHashes.size > 0
          ? Array.from(selectedHashes)
          : [commit.hash]
        handleCherryPick(hashes)
        break
      }
      case 'reset':
        setResetTarget({ hash: commit.hash, subject: commit.subject })
        break
      case 'revert':
        handleRevert(commit.hash, commit.parentHashes)
        break
      case 'create-branch':
      case 'create-tag':
        // Placeholder — these will be implemented in future stories
        console.log(`Action: ${action} on commit ${commit.shortHash}`)
        break
    }
  }, [selectedHashes, handleCherryPick, handleRevert])

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
    selectedHashes,
    onRowClick: handleRowClick,
    onRowContextMenu: handleRowContextMenu
  }), [nodes, graphWidth, selectedHash, selectedHashes, handleRowClick, handleRowContextMenu])

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
            multiSelectCount={selectedHashes.size > 0 ? selectedHashes.size : 1}
            onClose={() => setContextMenu(null)}
            onAction={handleContextAction}
          />
        )}

        {/* Cherry-pick notification */}
        {cherryPickState.status !== 'idle' && (
          <div className={`cherry-pick-notification cherry-pick-${cherryPickState.status}`}>
            <div className="cherry-pick-notification-content">
              {cherryPickState.status === 'picking' && (
                <span className="repo-view-spinner">&#x21BB;</span>
              )}
              {cherryPickState.status === 'success' && <span>&#x2714;</span>}
              {cherryPickState.status === 'conflict' && <span>&#x26A0;</span>}
              <span className="cherry-pick-message">{cherryPickState.message}</span>
            </div>

            {cherryPickState.status === 'success' && cherryPickState.newHash && (
              <div className="cherry-pick-new-hash">
                New commit: <code>{cherryPickState.newHash.substring(0, 7)}</code>
              </div>
            )}

            {cherryPickState.status === 'conflict' && cherryPickState.conflicts && cherryPickState.conflicts.length > 0 && (
              <div className="cherry-pick-conflicts">
                <div className="cherry-pick-conflicts-title">Conflicted files:</div>
                {cherryPickState.conflicts.map((f, i) => (
                  <div key={i} className="cherry-pick-conflict-file">{f}</div>
                ))}
              </div>
            )}

            <div className="cherry-pick-actions">
              {cherryPickState.status === 'conflict' && (
                <>
                  <button className="cherry-pick-btn cherry-pick-btn-continue" onClick={handleCherryPickContinue}>
                    Continue
                  </button>
                  <button className="cherry-pick-btn cherry-pick-btn-abort" onClick={handleCherryPickAbort}>
                    Abort Cherry-pick
                  </button>
                </>
              )}
              {cherryPickState.status === 'success' && (
                <button
                  className="cherry-pick-btn cherry-pick-btn-dismiss"
                  onClick={() => setCherryPickState({ status: 'idle', message: '' })}
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Revert notification */}
      {revertState.status !== 'idle' && (
        <div className={`revert-notification revert-${revertState.status}`}>
          <div className="revert-notification-content">
            {revertState.status === 'reverting' && (
              <span className="repo-view-spinner">&#x21BB;</span>
            )}
            {revertState.status === 'success' && <span>&#x2714;</span>}
            {revertState.status === 'conflict' && <span>&#x26A0;</span>}
            {revertState.status === 'merge-prompt' && <span>&#x2753;</span>}
            <span className="revert-message">{revertState.message}</span>
          </div>

          {revertState.status === 'success' && revertState.newHash && (
            <div className="revert-new-hash">
              Revert commit: <code>{revertState.newHash.substring(0, 7)}</code>
            </div>
          )}

          {revertState.status === 'conflict' && revertState.conflicts && revertState.conflicts.length > 0 && (
            <div className="revert-conflicts">
              <div className="revert-conflicts-title">Conflicted files:</div>
              {revertState.conflicts.map((f, i) => (
                <div key={i} className="revert-conflict-file">{f}</div>
              ))}
            </div>
          )}

          {revertState.status === 'merge-prompt' && revertState.commitHash && (
            <div className="revert-parent-select">
              <div className="revert-parent-label">Select parent to revert against:</div>
              <div className="revert-parent-buttons">
                {Array.from({ length: revertState.parentCount || 2 }, (_, i) => (
                  <button
                    key={i}
                    className="revert-btn revert-btn-parent"
                    onClick={() => handleRevert(revertState.commitHash!, [], i + 1)}
                  >
                    Parent {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="revert-actions">
            {revertState.status === 'conflict' && (
              <>
                <button className="revert-btn revert-btn-continue" onClick={handleRevertContinue}>
                  Continue
                </button>
                <button className="revert-btn revert-btn-abort" onClick={handleRevertAbort}>
                  Abort Revert
                </button>
              </>
            )}
            {revertState.status === 'merge-prompt' && (
              <button
                className="revert-btn revert-btn-dismiss"
                onClick={() => setRevertState({ status: 'idle', message: '' })}
              >
                Cancel
              </button>
            )}
            {revertState.status === 'success' && (
              <button
                className="revert-btn revert-btn-dismiss"
                onClick={() => setRevertState({ status: 'idle', message: '' })}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* Reset dialog */}
      {resetTarget && (
        <ResetDialog
          repoPath={repoPath}
          targetHash={resetTarget.hash}
          targetSubject={resetTarget.subject}
          onClose={() => setResetTarget(null)}
          onResetComplete={() => {
            loadCommits()
            setResetTarget(null)
          }}
        />
      )}

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
