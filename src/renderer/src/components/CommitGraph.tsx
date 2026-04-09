import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, useListCallbackRef } from 'react-window'
import { ShieldCheck, ShieldAlert, ShieldQuestion, CircleDot, Cherry, Undo2, SkipBack, GitBranch, GitMerge, Tag, Clipboard, X, RefreshCw, Loader2, Check, AlertTriangle, HelpCircle, FileText, FileCode, FileJson, Palette, Globe, FileType, File, LogOut, Pencil, Trash2, ArrowUpFromLine, ArrowUp, ArrowDown, CheckCircle2 } from 'lucide-react'
import { DiffViewer } from './DiffViewer'
import { ResetDialog } from './ResetDialog'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { CommitGraphSkeleton } from './Skeleton'
import { assignLanes, LANE_COLORS, type ParsedRef, type ParentConnection } from './laneAssignment'
import styles from './CommitGraph.module.css'

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

/** Full graph node: lane assignment result extended with the full GitCommit */
interface GraphNode {
  commit: GitCommit
  lane: number
  color: string
  parentConnections: ParentConnection[]
  isMerge: boolean
  refs: ParsedRef[]
}

export interface CommitFileDetail {
  path: string
  status: string // M, A, D, R, C
  insertions: number
  deletions: number
  oldPath?: string
}

export interface CommitDetail {
  commit: GitCommit
  files: string[]
  fileDetails: CommitFileDetail[]
  totalInsertions: number
  totalDeletions: number
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

interface BranchContextMenuState {
  x: number
  y: number
  ref: ParsedRef
  commitHash: string
}

interface TooltipState {
  x: number
  y: number
  message: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ROW_HEIGHT = 34
const GRAPH_COL_WIDTH = 16
const GRAPH_LEFT_PAD = 12
const NODE_RADIUS = 4
const GRAPH_MIN_WIDTH = 40
const CANVAS_THRESHOLD = 50000 // Switch from SVG to Canvas above this commit count

// ─── Graph Layout: uses assignLanes from laneAssignment.ts ───────────────────

function computeGraphLayout(commits: GitCommit[]): GraphNode[] {
  if (commits.length === 0) return []

  // Map full GitCommit to minimal LaneCommit for algorithm
  const laneCommits = commits.map((c) => ({
    hash: c.hash,
    parentHashes: c.parentHashes,
    refs: c.refs
  }))

  const laneResults = assignLanes(laneCommits)

  // Join results back with full GitCommit data
  return laneResults.map((result, i) => ({
    commit: commits[i],
    lane: result.lane,
    color: result.color,
    parentConnections: result.parentConnections,
    isMerge: result.isMerge,
    refs: result.refs
  }))
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

// ─── SVG Graph Renderer ───────────────────────────────────────────────────────

const HEAD_NODE_RADIUS = 6
const HEAD_RING_RADIUS = 9

interface GraphSVGProps {
  nodes: GraphNode[]
  maxColumns: number
  height: number
  scrollOffset: number
  visibleStartIndex: number
  visibleStopIndex: number
}

/** Build a hash→index lookup for fast parent resolution */
function buildHashIndex(nodes: GraphNode[]): Map<string, number> {
  const map = new Map<string, number>()
  for (let i = 0; i < nodes.length; i++) {
    map.set(nodes[i].commit.hash, i)
  }
  return map
}

const GraphSVG = React.memo(function GraphSVG({
  nodes,
  maxColumns,
  height,
  scrollOffset,
  visibleStartIndex,
  visibleStopIndex
}: GraphSVGProps): React.JSX.Element {
  const width = Math.max(GRAPH_MIN_WIDTH, GRAPH_LEFT_PAD + maxColumns * GRAPH_COL_WIDTH + GRAPH_LEFT_PAD)

  const hashIndex = useMemo(() => buildHashIndex(nodes), [nodes])

  // Build lane→color map for merge line coloring (source branch color)
  const laneColorMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const n of nodes) {
      if (!map.has(n.lane)) map.set(n.lane, n.color)
    }
    return map
  }, [nodes])

  // Collect all active lane indices for background stripes
  const activeLanes = useMemo(() => {
    const lanes = new Set<number>()
    for (const n of nodes) lanes.add(n.lane)
    return lanes
  }, [nodes])

  // Render a buffer around visible range — generous buffer prevents gaps during fast scrolling
  const renderStart = Math.max(0, visibleStartIndex - 15)
  const renderStop = Math.min(nodes.length - 1, visibleStopIndex + 15)

  const stripes: React.JSX.Element[] = []
  const lines: React.JSX.Element[] = []
  const circles: React.JSX.Element[] = []

  // Draw subtle vertical lane background stripes (2-3% opacity)
  activeLanes.forEach((lane) => {
    const lx = GRAPH_LEFT_PAD + lane * GRAPH_COL_WIDTH
    const color = laneColorMap.get(lane) || LANE_COLORS[0]
    stripes.push(
      <line
        key={`stripe-${lane}`}
        x1={lx} y1={0} x2={lx} y2={height}
        stroke={color}
        strokeWidth={GRAPH_COL_WIDTH - 2}
        opacity={0.03}
      />
    )
  })

  for (let i = renderStart; i <= renderStop; i++) {
    const node = nodes[i]
    const y = i * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset
    const x = GRAPH_LEFT_PAD + node.lane * GRAPH_COL_WIDTH
    const hasHead = node.refs.some((r) => r.type === 'head')

    // Draw lines to parents
    for (let p = 0; p < node.parentConnections.length; p++) {
      const conn = node.parentConnections[p]
      const fromX = GRAPH_LEFT_PAD + conn.fromLane * GRAPH_COL_WIDTH
      const toX = GRAPH_LEFT_PAD + conn.toLane * GRAPH_COL_WIDTH
      const parentIdx = hashIndex.get(conn.parentHash)
      // For merge connections (p > 0), use the source branch color (parent's lane color)
      const lineColor = p > 0 ? (laneColorMap.get(conn.toLane) || node.color) : node.color

      if (parentIdx === undefined) {
        // Parent not in data — draw line going down off screen
        const endY = height + ROW_HEIGHT - scrollOffset
        if (fromX === toX) {
          lines.push(
            <line
              key={`l-${i}-${p}`}
              x1={fromX} y1={y} x2={toX} y2={endY}
              stroke={lineColor} strokeWidth={2} fill="none"
            />
          )
        } else {
          lines.push(
            <path
              key={`l-${i}-${p}`}
              d={`M ${fromX} ${y} C ${fromX} ${y + ROW_HEIGHT * 0.5}, ${toX} ${y + ROW_HEIGHT * 0.5}, ${toX} ${y + ROW_HEIGHT} L ${toX} ${endY}`}
              stroke={lineColor} strokeWidth={2} fill="none"
            />
          )
        }
      } else {
        const parentY = parentIdx * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset
        if (fromX === toX) {
          lines.push(
            <line
              key={`l-${i}-${p}`}
              x1={fromX} y1={y} x2={toX} y2={parentY}
              stroke={lineColor} strokeWidth={2} fill="none"
            />
          )
        } else {
          const midY = y + ROW_HEIGHT * 0.7
          lines.push(
            <path
              key={`l-${i}-${p}`}
              d={`M ${fromX} ${y} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${parentY}`}
              stroke={lineColor} strokeWidth={2} fill="none"
            />
          )
        }
      }
    }

    // Draw node circle
    if (hasHead) {
      // HEAD: larger node with highlighted glow ring
      circles.push(
        <React.Fragment key={`n-${i}`}>
          <circle
            cx={x} cy={y} r={HEAD_RING_RADIUS}
            fill="none"
            stroke={node.color}
            strokeWidth={2}
            opacity={0.35}
          />
          <circle
            cx={x} cy={y} r={HEAD_NODE_RADIUS}
            fill={node.color}
            stroke="#cdd6f4"
            strokeWidth={2}
          />
        </React.Fragment>
      )
    } else if (node.isMerge) {
      // Merge: hollow node
      circles.push(
        <circle
          key={`n-${i}`}
          cx={x} cy={y} r={NODE_RADIUS}
          fill="var(--bg-primary, #1e1e2e)"
          stroke={node.color}
          strokeWidth={2}
        />
      )
    } else {
      // Normal node: filled
      circles.push(
        <circle
          key={`n-${i}`}
          cx={x} cy={y} r={NODE_RADIUS}
          fill={node.color}
        />
      )
    }
  }

  return (
    <svg
      width={width}
      height={height}
      className={styles.svgGraph}
      style={{ width, height, position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }}
    >
      {/* Lane background stripes (lowest layer) */}
      {stripes}
      {/* Lines rendered above stripes */}
      {lines}
      {/* Nodes rendered on top */}
      {circles}
    </svg>
  )
})

// ─── Canvas Graph Renderer (fallback for large repos) ────────────────────────

interface GraphCanvasProps {
  nodes: GraphNode[]
  maxColumns: number
  height: number
  scrollOffset: number
  visibleStartIndex: number
  visibleStopIndex: number
  onNodeHover?: (index: number | null) => void
  onNodeClick?: (index: number) => void
}

/**
 * Canvas-based commit graph renderer for repos with 50,000+ commits.
 * Produces visually identical output to GraphSVG but uses Canvas 2D for performance.
 * Uses offscreen rendering for visible viewport + buffer only.
 */
const GraphCanvas = React.memo(function GraphCanvas({
  nodes,
  maxColumns,
  height,
  scrollOffset,
  visibleStartIndex,
  visibleStopIndex,
  onNodeHover,
  onNodeClick
}: GraphCanvasProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const width = Math.max(GRAPH_MIN_WIDTH, GRAPH_LEFT_PAD + maxColumns * GRAPH_COL_WIDTH + GRAPH_LEFT_PAD)

  const hashIndex = useMemo(() => buildHashIndex(nodes), [nodes])

  // Render a buffer around visible range — generous buffer prevents gaps during fast scrolling
  const renderStart = Math.max(0, visibleStartIndex - 15)
  const renderStop = Math.min(nodes.length - 1, visibleStopIndex + 15)

  // Build lane→color map for merge line coloring (source branch color)
  // Resolve CSS variables (e.g., var(--accent)) to actual colors for Canvas rendering
  const laneColorMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const n of nodes) {
      if (!map.has(n.lane)) {
        let color = n.color
        if (color.startsWith('var(')) {
          const varName = color.replace(/^var\(/, '').replace(/\)$/, '')
          const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
          if (resolved) color = resolved
        }
        map.set(n.lane, color)
      }
    }
    return map
  }, [nodes])

  // Draw on canvas whenever visible range or data changes
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Handle high-DPI displays
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, width, height)

    // Draw subtle lane background stripes (2-3% opacity)
    ctx.globalAlpha = 0.03
    const activeLanesSet = new Set<number>()
    for (const n of nodes) activeLanesSet.add(n.lane)
    activeLanesSet.forEach((lane) => {
      const lx = GRAPH_LEFT_PAD + lane * GRAPH_COL_WIDTH
      const color = laneColorMap.get(lane) || LANE_COLORS[0]
      ctx.strokeStyle = color
      ctx.lineWidth = GRAPH_COL_WIDTH - 2
      ctx.beginPath()
      ctx.moveTo(lx, 0)
      ctx.lineTo(lx, height)
      ctx.stroke()
    })
    ctx.globalAlpha = 1.0

    // Draw lines first (below nodes)
    for (let i = renderStart; i <= renderStop; i++) {
      const node = nodes[i]
      if (!node) continue
      const y = i * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset

      for (let p = 0; p < node.parentConnections.length; p++) {
        const conn = node.parentConnections[p]
        const fromX = GRAPH_LEFT_PAD + conn.fromLane * GRAPH_COL_WIDTH
        const toX = GRAPH_LEFT_PAD + conn.toLane * GRAPH_COL_WIDTH
        const parentIdx = hashIndex.get(conn.parentHash)
        // For merge connections (p > 0), use the source branch color
        const lineColor = p > 0 ? (laneColorMap.get(conn.toLane) || node.color) : node.color

        ctx.strokeStyle = lineColor
        ctx.lineWidth = 2
        ctx.beginPath()

        if (parentIdx === undefined) {
          // Parent not in data — draw line going down off screen
          const endY = height + ROW_HEIGHT - scrollOffset
          if (fromX === toX) {
            ctx.moveTo(fromX, y)
            ctx.lineTo(toX, endY)
          } else {
            ctx.moveTo(fromX, y)
            ctx.bezierCurveTo(
              fromX, y + ROW_HEIGHT * 0.5,
              toX, y + ROW_HEIGHT * 0.5,
              toX, y + ROW_HEIGHT
            )
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
    }

    // Draw nodes on top
    for (let i = renderStart; i <= renderStop; i++) {
      const node = nodes[i]
      if (!node) continue
      const y = i * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset
      const x = GRAPH_LEFT_PAD + node.lane * GRAPH_COL_WIDTH
      const hasHead = node.refs.some((r) => r.type === 'head')
      // Resolve CSS variables for Canvas (which can't use var())
      const nodeColor = laneColorMap.get(node.lane) || node.color

      if (hasHead) {
        // HEAD: glow ring
        ctx.beginPath()
        ctx.arc(x, y, HEAD_RING_RADIUS, 0, Math.PI * 2)
        ctx.strokeStyle = nodeColor
        ctx.lineWidth = 2
        ctx.globalAlpha = 0.35
        ctx.stroke()
        ctx.globalAlpha = 1.0

        // HEAD: filled node with border
        ctx.beginPath()
        ctx.arc(x, y, HEAD_NODE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = nodeColor
        ctx.fill()
        ctx.strokeStyle = '#cdd6f4'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (node.isMerge) {
        // Merge: hollow node
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
        // Use a CSS-like fallback for bg-primary
        ctx.fillStyle = '#1e1e2e'
        ctx.fill()
        ctx.strokeStyle = nodeColor
        ctx.lineWidth = 2
        ctx.stroke()
      } else {
        // Normal node: filled
        ctx.beginPath()
        ctx.arc(x, y, NODE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = nodeColor
        ctx.fill()
      }
    }
  }, [nodes, hashIndex, laneColorMap, width, height, scrollOffset, renderStart, renderStop])

  // Hit-testing: map canvas coordinates to commit node indices
  const hitTest = useCallback((clientX: number, clientY: number): number | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = clientX - rect.left
    const y = clientY - rect.top

    // Check nodes in visible range (reverse order so top-most wins)
    for (let i = renderStop; i >= renderStart; i--) {
      const node = nodes[i]
      if (!node) continue
      const nodeX = GRAPH_LEFT_PAD + node.lane * GRAPH_COL_WIDTH
      const nodeY = i * ROW_HEIGHT + ROW_HEIGHT / 2 - scrollOffset
      const hasHead = node.refs.some((r) => r.type === 'head')
      const hitRadius = hasHead ? HEAD_RING_RADIUS + 2 : NODE_RADIUS + 4 // Generous hit area

      const dx = x - nodeX
      const dy = y - nodeY
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return i
      }
    }
    return null
  }, [nodes, scrollOffset, renderStart, renderStop])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!onNodeHover) return
    const idx = hitTest(e.clientX, e.clientY)
    onNodeHover(idx)
  }, [hitTest, onNodeHover])

  const handleMouseLeave = useCallback(() => {
    onNodeHover?.(null)
  }, [onNodeHover])

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!onNodeClick) return
    const idx = hitTest(e.clientX, e.clientY)
    if (idx !== null) {
      onNodeClick(idx)
    }
  }, [hitTest, onNodeClick])

  return (
    <canvas
      ref={canvasRef}
      className={styles.svgGraph}
      style={{
        width,
        height,
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: 'auto'
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
    />
  )
})

// ─── Lookup Maps for Dynamic CSS Module Classes ──────────────────────────────

const refTypeClass: Record<string, string> = {
  head: styles.refHead,
  branch: styles.refBranch,
  remote: styles.refRemote,
  tag: styles.refTag
}

const signatureClass: Record<string, string> = {
  good: styles.signatureGood,
  bad: styles.signatureBad,
  untrusted: styles.signatureUntrusted,
  expired: styles.signatureExpired,
  'expired-key': styles.signatureExpiredKey,
  revoked: styles.signatureRevoked,
  error: styles.signatureError
}

const cherryPickStatusClass: Record<string, string> = {
  picking: styles.cherryPickPicking,
  success: styles.cherryPickSuccess,
  conflict: styles.cherryPickConflict
}

const revertStatusClass: Record<string, string> = {
  reverting: styles.revertReverting,
  success: styles.revertSuccess,
  conflict: styles.revertConflict,
  'merge-prompt': styles.revertMergePrompt
}

// ─── Commit Row Component (for react-window v2 rowComponent API) ──────────────

interface CommitRowProps {
  nodes: GraphNode[]
  graphWidth: number
  selectedHash: string | null
  selectedHashes: Set<string>
  onRowClick: (index: number, event: React.MouseEvent) => void
  onRowContextMenu: (index: number, event: React.MouseEvent) => void
  onRefContextMenu: (ref: ParsedRef, commitHash: string, event: React.MouseEvent) => void
  onRowMouseEnter: (index: number, event: React.MouseEvent) => void
  onRowMouseLeave: () => void
}

function CommitRowComponent(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & CommitRowProps): React.ReactElement {
  const { index, style, nodes, graphWidth, selectedHash, selectedHashes, onRowClick, onRowContextMenu, onRefContextMenu, onRowMouseEnter, onRowMouseLeave } = props
  const node = nodes[index]
  const { commit, refs } = node
  const isSelected = commit.hash === selectedHash || selectedHashes.has(commit.hash)

  const handleClick = useCallback((e: React.MouseEvent) => {
    onRowClick(index, e)
  }, [index, onRowClick])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    onRowContextMenu(index, e)
  }, [index, onRowContextMenu])

  const handleRefContextMenu = useCallback((ref: ParsedRef, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onRefContextMenu(ref, commit.hash, e)
  }, [commit.hash, onRefContextMenu])

  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    onRowMouseEnter(index, e)
  }, [index, onRowMouseEnter])

  return (
    <div
      className={`${styles.row}${isSelected ? ` ${styles.rowSelected}` : ''}`}
      style={style}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onRowMouseLeave}
      data-index={index}
    >
      {/* Graph space (transparent — SVG draws underneath) */}
      <div className={styles.lane} style={{ minWidth: graphWidth, width: graphWidth }} />

      {/* Commit info */}
      <div className={styles.info}>
        <span className={styles.hash} title={commit.hash}>{commit.shortHash}</span>

        {refs.length > 0 && (
          <span className={styles.refs}>
            {refs.map((ref, idx) => {
              // Branch and head refs use lane color to match their graph lane
              const useLaneColor = ref.type === 'head' || ref.type === 'branch'
              const laneColorStyle = useLaneColor ? {
                backgroundColor: `color-mix(in srgb, ${node.color} 18%, transparent)`,
                borderColor: `color-mix(in srgb, ${node.color} 30%, transparent)`,
                color: node.color
              } : undefined
              return (
                <span
                  key={idx}
                  className={`${styles.ref} ${refTypeClass[ref.type] || ''}`}
                  style={laneColorStyle}
                  title={ref.name}
                  onContextMenu={(e) => handleRefContextMenu(ref, e)}
                >
                  {ref.type === 'head' && <span className={styles.refHeadIcon}><CircleDot size={12} /> </span>}
                  {ref.name}
                </span>
              )
            })}
          </span>
        )}

        {commit.signatureStatus && commit.signatureStatus !== 'none' && (
          <span
            className={`${styles.signature} ${signatureClass[commit.signatureStatus] || ''}`}
            title={`GPG: ${commit.signatureStatus}${commit.signer ? ` by ${commit.signer}` : ''}`}
          >
            {commit.signatureStatus === 'good' ? <ShieldCheck size={14} /> :
             commit.signatureStatus === 'bad' ? <ShieldAlert size={14} /> :
             commit.signatureStatus === 'untrusted' ? <ShieldQuestion size={14} /> :
             <ShieldQuestion size={14} />}
          </span>
        )}

        <span className={styles.message} title={commit.subject}>
          {commit.subject}
        </span>
      </div>

      <span className={styles.author} title={commit.authorEmail}>
        {commit.authorName}
      </span>

      <span className={styles.date} title={commit.authorDate}>
        {getRelativeTime(commit.authorDate)}
      </span>
    </div>
  )
}

// ─── Context Menu Component ──────────────────────────────────────────────────

function buildCommitContextMenuItems(
  commit: GitCommit,
  multiSelectCount: number,
  onAction: (action: string, commit: GitCommit) => void
): ContextMenuEntry[] {
  const cherryPickLabel = multiSelectCount > 1
    ? `Cherry-pick ${multiSelectCount} commits`
    : 'Cherry-pick'

  return [
    { key: 'checkout', label: 'Checkout', icon: <LogOut size={14} />, onClick: () => onAction('checkout', commit) },
    { key: 'sep1', separator: true as const },
    { key: 'cherry-pick', label: cherryPickLabel, icon: <Cherry size={14} />, onClick: () => onAction('cherry-pick', commit) },
    { key: 'revert', label: 'Revert', icon: <Undo2 size={14} />, onClick: () => onAction('revert', commit) },
    { key: 'reset', label: 'Reset current branch to here', icon: <SkipBack size={14} />, onClick: () => onAction('reset', commit) },
    { key: 'sep2', separator: true as const },
    { key: 'create-branch', label: 'Create branch here...', icon: <GitBranch size={14} />, onClick: () => onAction('create-branch', commit) },
    { key: 'create-tag', label: 'Create tag here...', icon: <Tag size={14} />, onClick: () => onAction('create-tag', commit) },
    { key: 'sep3', separator: true as const },
    { key: 'copy-sha', label: 'Copy SHA', icon: <Clipboard size={14} />, shortcut: 'Ctrl+C', onClick: () => onAction('copy-sha', commit) },
  ]
}

// ─── Branch/Ref Context Menu Items Builder ──────────────────────────────────

function buildBranchRefContextMenuItems(
  ref: ParsedRef,
  repoPath: string,
  onRefresh: () => void
): ContextMenuEntry[] {
  const isBranch = ref.type === 'branch' || ref.type === 'head'
  const isRemote = ref.type === 'remote'
  const isTag = ref.type === 'tag'

  const handleAction = async (action: string): Promise<void> => {
    try {
      switch (action) {
        case 'checkout':
          await window.electronAPI.git.checkout(repoPath, ref.name)
          onRefresh()
          break
        case 'merge':
          await window.electronAPI.git.merge(repoPath, ref.name)
          onRefresh()
          break
        case 'rebase':
          await window.electronAPI.git.rebase(repoPath, ref.name)
          onRefresh()
          break
        case 'delete':
          if (isTag) {
            await window.electronAPI.git.deleteTag(repoPath, ref.name)
          } else {
            await window.electronAPI.git.deleteBranch(repoPath, ref.name, { force: false })
          }
          onRefresh()
          break
        case 'push':
          await window.electronAPI.git.push(repoPath, {})
          onRefresh()
          break
        case 'copy-name':
          navigator.clipboard.writeText(ref.name).catch(() => {})
          break
      }
    } catch (err) {
      console.error(`Branch action ${action} failed:`, err)
    }
  }

  const items: ContextMenuEntry[] = []

  if (isBranch || isRemote) {
    items.push({ key: 'checkout', label: 'Checkout', icon: <LogOut size={14} />, onClick: () => handleAction('checkout') })
    items.push({ key: 'merge', label: 'Merge into current', icon: <GitMerge size={14} />, onClick: () => handleAction('merge') })
    items.push({ key: 'rebase', label: 'Rebase onto', icon: <GitBranch size={14} />, onClick: () => handleAction('rebase') })
    items.push({ key: 'sep1', separator: true })
    if (isBranch) {
      items.push({ key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => handleAction('delete') })
      items.push({ key: 'push', label: 'Push', icon: <ArrowUpFromLine size={14} />, onClick: () => handleAction('push') })
    }
  }

  if (isTag) {
    items.push({ key: 'checkout', label: 'Checkout', icon: <LogOut size={14} />, onClick: () => handleAction('checkout') })
    items.push({ key: 'sep1', separator: true })
    items.push({ key: 'delete', label: 'Delete tag', icon: <Trash2 size={14} />, danger: true, onClick: () => handleAction('delete') })
    items.push({ key: 'push', label: 'Push tag', icon: <ArrowUpFromLine size={14} />, onClick: () => handleAction('push') })
  }

  items.push({ key: 'sep-end', separator: true })
  items.push({ key: 'copy-name', label: 'Copy name', icon: <Clipboard size={14} />, onClick: () => handleAction('copy-name') })

  return items
}

// ─── Commit Tooltip Component ────────────────────────────────────────────────

function CommitTooltip({ tooltip }: { tooltip: TooltipState }): React.JSX.Element {
  return (
    <div
      className={styles.tooltip}
      style={{
        position: 'fixed',
        left: tooltip.x,
        top: tooltip.y,
        zIndex: 3000
      }}
    >
      {tooltip.message}
    </div>
  )
}

// CommitDetailPanel removed — details shown in permanent right panel (DetailPanel in AppLayout)

function getFileIcon(filePath: string): React.ReactNode {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, React.ReactNode> = {
    ts: <FileCode size={14} />, tsx: <FileCode size={14} />,
    js: <FileCode size={14} />, jsx: <FileCode size={14} />,
    json: <FileJson size={14} />,
    css: <Palette size={14} />, scss: <Palette size={14} />, less: <Palette size={14} />,
    html: <Globe size={14} />,
    md: <FileText size={14} />,
    py: <FileCode size={14} />,
    rs: <FileCode size={14} />,
    go: <FileCode size={14} />,
  }
  return iconMap[ext] || <File size={14} />
}

// ─── Main CommitGraph Component ───────────────────────────────────────────────

export function CommitGraph({ repoPath, onRefresh, onCommitSelect, filters }: CommitGraphProps): React.JSX.Element {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [visibleRange, setVisibleRange] = useState({ start: 0, stop: 0 })
  // Derive scrollOffset from visibleRange to stay in sync with react-window's
  // internal scroll position. Previously, scrollOffset was tracked via a separate
  // onScroll handler on the viewport div (which has overflow:hidden and never
  // actually scrolls), causing it to desync from react-window's onRowsRendered.
  const scrollOffset = visibleRange.start * ROW_HEIGHT
  const containerRef = useRef<HTMLDivElement>(null)
  const [listRef, setListRef] = useListCallbackRef()
  const [containerHeight, setContainerHeight] = useState(400)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [commitDetail, setCommitDetail] = useState<CommitDetail | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [branchContextMenu, setBranchContextMenu] = useState<BranchContextMenuState | null>(null)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selectedHashes, setSelectedHashes] = useState<Set<string>>(new Set())
  const [cherryPickState, setCherryPickState] = useState<CherryPickState>({ status: 'idle', message: '' })
  const [revertState, setRevertState] = useState<RevertState>({ status: 'idle', message: '' })
  const [resetTarget, setResetTarget] = useState<{ hash: string; subject: string } | null>(null)
  const initialCommitLoadDone = useRef(false)
  const refreshInFlightRef = useRef(false)

  // Ahead/behind tracking state
  const [aheadCount, setAheadCount] = useState(0)
  const [behindCount, setBehindCount] = useState(0)
  const [hasUpstream, setHasUpstream] = useState<boolean | null>(null) // null = unknown/loading

  // Fetch ahead/behind counts
  const fetchAheadBehind = useCallback(async () => {
    try {
      const branchesResult = await window.electronAPI.git.getBranches(repoPath)
      if (branchesResult.success && Array.isArray(branchesResult.data)) {
        const current = branchesResult.data.find(
          (b: { isCurrent?: boolean; current?: boolean }) => b.isCurrent || b.current
        )
        if (current) {
          setAheadCount(current.ahead || 0)
          setBehindCount(current.behind || 0)
          setHasUpstream(!!current.upstream)
        } else {
          setHasUpstream(false)
        }
      }
    } catch {
      // Ignore errors
    }
  }, [repoPath])

  // Load commits — only shows loading on initial load, silent on refreshes
  const loadCommits = useCallback(async () => {
    // Prevent overlapping refresh calls
    if (refreshInFlightRef.current && initialCommitLoadDone.current) return
    refreshInFlightRef.current = true

    if (!initialCommitLoadDone.current) {
      setLoading(true)
    }
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
        setCommits((prev) => {
          const newData = result.data as GitCommit[]
          // Skip state update if commits haven't changed (compare by first+last hash and length)
          if (
            prev.length === newData.length &&
            prev.length > 0 &&
            prev[0].hash === newData[0].hash &&
            prev[prev.length - 1].hash === newData[newData.length - 1].hash
          ) {
            return prev
          }
          return newData
        })
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
      initialCommitLoadDone.current = true
      refreshInFlightRef.current = false
    }
  }, [repoPath, filters])

  useEffect(() => {
    // Reset initial load flag when repo/filters change
    initialCommitLoadDone.current = false
    loadCommits()
    fetchAheadBehind()
  }, [loadCommits, fetchAheadBehind])

  // Listen for file watcher events instead of polling
  useEffect(() => {
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      loadCommits()
      fetchAheadBehind()
    })
    return () => cleanup?.()
  }, [loadCommits, fetchAheadBehind])

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
    return Math.max(1, ...nodes.map((n) => n.lane + 1))
  }, [nodes])

  const graphWidth = Math.max(GRAPH_MIN_WIDTH, GRAPH_LEFT_PAD + maxColumns * GRAPH_COL_WIDTH + GRAPH_LEFT_PAD)

  // Use Canvas renderer for large repos (50,000+ commits)
  const useCanvas = nodes.length >= CANVAS_THRESHOLD

  // Canvas hit-testing: hover state for tooltip cursor
  const [canvasHoverIndex, setCanvasHoverIndex] = useState<number | null>(null)

  // Load commit detail when selected
  const loadCommitDetail = useCallback(async (hash: string, refs: ParsedRef[]) => {
    setLoadingDetail(true)
    try {
      const result = await window.electronAPI.git.showCommit(repoPath, hash)
      if (result.success && result.data) {
        const detail: CommitDetail = {
          commit: result.data.commit as GitCommit,
          files: result.data.files as string[],
          fileDetails: (result.data.fileDetails as CommitFileDetail[]) || [],
          totalInsertions: (result.data.totalInsertions as number) || 0,
          totalDeletions: (result.data.totalDeletions as number) || 0,
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

  // Handle right-click on branch/tag ref label
  const handleRefContextMenu = useCallback((ref: ParsedRef, commitHash: string, event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    // Close commit context menu if open
    setContextMenu(null)
    setBranchContextMenu({
      x: event.clientX,
      y: event.clientY,
      ref,
      commitHash
    })
  }, [])

  // Tooltip on row hover
  const handleRowMouseEnter = useCallback((index: number, event: React.MouseEvent) => {
    const node = nodes[index]
    if (!node) return
    // Clear any pending tooltip timer
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
    }
    // Show tooltip after a small delay
    tooltipTimerRef.current = setTimeout(() => {
      const fullMessage = node.commit.body
        ? `${node.commit.subject}\n\n${node.commit.body.trim()}`
        : node.commit.subject
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      setTooltip({
        x: Math.min(rect.left + 100, window.innerWidth - 420),
        y: rect.bottom + 4,
        message: fullMessage.length > 300 ? fullMessage.substring(0, 300) + '...' : fullMessage
      })
    }, 600)
  }, [nodes])

  const handleRowMouseLeave = useCallback(() => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current)
      tooltipTimerRef.current = null
    }
    setTooltip(null)
  }, [])

  // Clean up tooltip timer on unmount
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) {
        clearTimeout(tooltipTimerRef.current)
      }
    }
  }, [])

  // Canvas hit-testing callbacks
  const handleCanvasNodeHover = useCallback((index: number | null) => {
    setCanvasHoverIndex(index)
  }, [])

  const handleCanvasNodeClick = useCallback((index: number) => {
    // Delegate to the same row click handler (simulating a normal left click)
    const node = nodes[index]
    if (!node) return
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
  }, [nodes, selectedHash, loadCommitDetail, onCommitSelect])

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
  const handleContextAction = useCallback(async (action: string, commit: GitCommit) => {
    switch (action) {
      case 'checkout':
        try {
          await window.electronAPI.git.checkout(repoPath, commit.hash)
          loadCommits()
        } catch (err) {
          console.error('Checkout failed:', err)
        }
        break
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
  }, [repoPath, selectedHashes, handleCherryPick, handleRevert, loadCommits])

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
        case 'Enter':
          e.preventDefault()
          // Open commit details for currently selected commit
          if (selectedIndex >= 0 && nodes[selectedIndex]) {
            const node = nodes[selectedIndex]
            loadCommitDetail(node.commit.hash, node.refs)
          }
          return
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

  const handleScroll = useCallback(() => {
    // Close menus on scroll
    setContextMenu(null)
    setBranchContextMenu(null)
    setTooltip(null)
  }, [])

  const handleRowsRendered = useCallback((
    visibleRows: { startIndex: number; stopIndex: number }
  ) => {
    setVisibleRange({ start: visibleRows.startIndex, stop: visibleRows.stopIndex })
  }, [])

  const handleRefresh = useCallback(() => {
    loadCommits()
    fetchAheadBehind()
    onRefresh?.()
  }, [loadCommits, fetchAheadBehind, onRefresh])

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
    onRowContextMenu: handleRowContextMenu,
    onRefContextMenu: handleRefContextMenu,
    onRowMouseEnter: handleRowMouseEnter,
    onRowMouseLeave: handleRowMouseLeave
  }), [nodes, graphWidth, selectedHash, selectedHashes, handleRowClick, handleRowContextMenu, handleRefContextMenu, handleRowMouseEnter, handleRowMouseLeave])

  if (loading && commits.length === 0) {
    return (
      <div className={styles.container} ref={containerRef}>
        <CommitGraphSkeleton />
      </div>
    )
  }

  if (error && commits.length === 0) {
    return (
      <div className={styles.container} ref={containerRef}>
        <div className={styles.error}>
          <span><AlertTriangle size={14} /></span> {error}
          <button onClick={handleRefresh}>Retry</button>
        </div>
      </div>
    )
  }

  if (commits.length === 0) {
    return (
      <div className={styles.container} ref={containerRef}>
        <div className={styles.empty}>
          No commits yet. Make your first commit to see the graph.
        </div>
      </div>
    )
  }

  const viewportHeight = Math.max(100, containerHeight - 40)

  return (
    <div className={styles.wrapper}>
      <div
        className={styles.container}
        ref={containerRef}
        tabIndex={0}
        role="listbox"
        aria-label="Commit graph"
      >
        <div className={styles.header}>
          <h3 className={styles.title}>
            Commit Graph <span className={styles.count}>· {commits.length.toLocaleString()}</span>
          </h3>
          {hasUpstream !== null && (
            <div className={styles.syncIndicator}>
              {hasUpstream === false ? (
                <span className={styles.noUpstream} title="No upstream configured">No upstream</span>
              ) : aheadCount === 0 && behindCount === 0 ? (
                <span className={styles.upToDate} title="Up to date with remote">
                  <CheckCircle2 size={11} /> Up to date
                </span>
              ) : (
                <>
                  {aheadCount > 0 && (
                    <span className={styles.aheadBadge} title={`${aheadCount} commit${aheadCount > 1 ? 's' : ''} ahead of remote`}>
                      <ArrowUp size={11} />{aheadCount}
                    </span>
                  )}
                  {behindCount > 0 && (
                    <span className={styles.behindBadge} title={`${behindCount} commit${behindCount > 1 ? 's' : ''} behind remote`}>
                      <ArrowDown size={11} />{behindCount}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          <button className={styles.refresh} onClick={handleRefresh} title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>

        <div className={styles.viewport} onScroll={handleScroll} style={canvasHoverIndex !== null ? { cursor: 'pointer' } : undefined}>
          {useCanvas ? (
            <GraphCanvas
              nodes={nodes}
              maxColumns={maxColumns}
              height={viewportHeight}
              scrollOffset={scrollOffset}
              visibleStartIndex={visibleRange.start}
              visibleStopIndex={visibleRange.stop}
              onNodeHover={handleCanvasNodeHover}
              onNodeClick={handleCanvasNodeClick}
            />
          ) : (
            <GraphSVG
              nodes={nodes}
              maxColumns={maxColumns}
              height={viewportHeight}
              scrollOffset={scrollOffset}
              visibleStartIndex={visibleRange.start}
              visibleStopIndex={visibleRange.stop}
            />
          )}

          <List<CommitRowProps>
            listRef={setListRef}
            rowComponent={CommitRowComponent}
            rowCount={nodes.length}
            rowHeight={ROW_HEIGHT}
            rowProps={rowProps}
            overscanCount={10}
            onRowsRendered={handleRowsRendered}
            className={styles.list}
            style={{ height: viewportHeight }}
          />
        </div>

        {/* Context menu */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={buildCommitContextMenuItems(
              contextMenu.commit,
              selectedHashes.size > 0 ? selectedHashes.size : 1,
              handleContextAction
            )}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Branch/ref context menu */}
        {branchContextMenu && (
          <ContextMenu
            x={branchContextMenu.x}
            y={branchContextMenu.y}
            items={buildBranchRefContextMenuItems(
              branchContextMenu.ref,
              repoPath,
              handleRefresh
            )}
            onClose={() => setBranchContextMenu(null)}
          />
        )}

        {/* Hover tooltip */}
        {tooltip && <CommitTooltip tooltip={tooltip} />}

        {/* Cherry-pick notification */}
        {cherryPickState.status !== 'idle' && (
          <div className={`${styles.cherryPickNotification} ${cherryPickStatusClass[cherryPickState.status] || ''}`}>
            <div className={styles.cherryPickNotificationContent}>
              {cherryPickState.status === 'picking' && (
                <span className={styles.spinner}><Loader2 size={14} /></span>
              )}
              {cherryPickState.status === 'success' && <span><Check size={14} /></span>}
              {cherryPickState.status === 'conflict' && <span><AlertTriangle size={14} /></span>}
              <span className={styles.cherryPickMessage}>{cherryPickState.message}</span>
            </div>

            {cherryPickState.status === 'success' && cherryPickState.newHash && (
              <div className={styles.cherryPickNewHash}>
                New commit: <code>{cherryPickState.newHash.substring(0, 7)}</code>
              </div>
            )}

            {cherryPickState.status === 'conflict' && cherryPickState.conflicts && cherryPickState.conflicts.length > 0 && (
              <div className={styles.cherryPickConflicts}>
                <div className={styles.cherryPickConflictsTitle}>Conflicted files:</div>
                {cherryPickState.conflicts.map((f, i) => (
                  <div key={i} className={styles.cherryPickConflictFile}>{f}</div>
                ))}
              </div>
            )}

            <div className={styles.cherryPickActions}>
              {cherryPickState.status === 'conflict' && (
                <>
                  <button className={`${styles.cherryPickBtn} ${styles.cherryPickBtnContinue}`} onClick={handleCherryPickContinue}>
                    Continue
                  </button>
                  <button className={`${styles.cherryPickBtn} ${styles.cherryPickBtnAbort}`} onClick={handleCherryPickAbort}>
                    Abort Cherry-pick
                  </button>
                </>
              )}
              {cherryPickState.status === 'success' && (
                <button
                  className={`${styles.cherryPickBtn} ${styles.cherryPickBtnDismiss}`}
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
        <div className={`${styles.revertNotification} ${revertStatusClass[revertState.status] || ''}`}>
          <div className={styles.revertNotificationContent}>
            {revertState.status === 'reverting' && (
              <span className={styles.spinner}><Loader2 size={14} /></span>
            )}
            {revertState.status === 'success' && <span><Check size={14} /></span>}
            {revertState.status === 'conflict' && <span><AlertTriangle size={14} /></span>}
            {revertState.status === 'merge-prompt' && <span><HelpCircle size={14} /></span>}
            <span className={styles.revertMessage}>{revertState.message}</span>
          </div>

          {revertState.status === 'success' && revertState.newHash && (
            <div className={styles.revertNewHash}>
              Revert commit: <code>{revertState.newHash.substring(0, 7)}</code>
            </div>
          )}

          {revertState.status === 'conflict' && revertState.conflicts && revertState.conflicts.length > 0 && (
            <div className={styles.revertConflicts}>
              <div className={styles.revertConflictsTitle}>Conflicted files:</div>
              {revertState.conflicts.map((f, i) => (
                <div key={i} className={styles.revertConflictFile}>{f}</div>
              ))}
            </div>
          )}

          {revertState.status === 'merge-prompt' && revertState.commitHash && (
            <div className={styles.revertParentSelect}>
              <div className={styles.revertParentLabel}>Select parent to revert against:</div>
              <div className={styles.revertParentButtons}>
                {Array.from({ length: revertState.parentCount || 2 }, (_, i) => (
                  <button
                    key={i}
                    className={`${styles.revertBtn} ${styles.revertBtnParent}`}
                    onClick={() => handleRevert(revertState.commitHash!, [], i + 1)}
                  >
                    Parent {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={styles.revertActions}>
            {revertState.status === 'conflict' && (
              <>
                <button className={`${styles.revertBtn} ${styles.revertBtnContinue}`} onClick={handleRevertContinue}>
                  Continue
                </button>
                <button className={`${styles.revertBtn} ${styles.revertBtnAbort}`} onClick={handleRevertAbort}>
                  Abort Revert
                </button>
              </>
            )}
            {revertState.status === 'merge-prompt' && (
              <button
                className={`${styles.revertBtn} ${styles.revertBtnDismiss}`}
                onClick={() => setRevertState({ status: 'idle', message: '' })}
              >
                Cancel
              </button>
            )}
            {revertState.status === 'success' && (
              <button
                className={`${styles.revertBtn} ${styles.revertBtnDismiss}`}
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

      {/* Commit detail panel removed — details shown in the permanent right panel (DetailPanel in AppLayout) */}
    </div>
  )
}
