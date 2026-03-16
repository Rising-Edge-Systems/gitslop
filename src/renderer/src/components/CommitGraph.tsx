import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, useListCallbackRef } from 'react-window'

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

interface CommitGraphProps {
  repoPath: string
  onRefresh?: () => void
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
}

function CommitRowComponent(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & CommitRowProps): React.ReactElement {
  const { index, style, nodes, graphWidth } = props
  const node = nodes[index]
  const { commit, refs } = node

  return (
    <div className="commit-graph-row" style={style}>
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

// ─── Main CommitGraph Component ───────────────────────────────────────────────

export function CommitGraph({ repoPath, onRefresh }: CommitGraphProps): React.JSX.Element {
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [visibleRange, setVisibleRange] = useState({ start: 0, stop: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [listRef, setListRef] = useListCallbackRef()
  const [containerHeight, setContainerHeight] = useState(400)

  // Suppress unused variable warning for listRef imperative API
  void listRef

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

  const rowProps = useMemo(() => ({
    nodes,
    graphWidth
  }), [nodes, graphWidth])

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
    <div className="commit-graph-container" ref={containerRef}>
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
    </div>
  )
}
