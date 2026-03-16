import React, { useCallback, useEffect, useMemo, useState } from 'react'

// ─── Types ─────────────────────────────────────────────────────────────────

export interface BlameLine {
  hash: string
  shortHash: string
  author: string
  authorEmail: string
  authorDate: string
  summary: string
  lineNumber: number
  content: string
}

interface BlameViewProps {
  repoPath: string
  filePath: string
  onClose: () => void
  onCommitClick?: (hash: string) => void
}

// ─── Age color helper ──────────────────────────────────────────────────────

function getAgeColor(dateStr: string, now: number): string {
  if (!dateStr) return 'var(--text-muted)'
  const ageMs = now - new Date(dateStr).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  // Color gradient from recent (bright accent) to old (muted)
  if (ageDays < 7) return '#a6e3a1' // green — very recent
  if (ageDays < 30) return '#94e2d5' // teal
  if (ageDays < 90) return '#89b4fa' // blue
  if (ageDays < 180) return '#b4befe' // lavender
  if (ageDays < 365) return '#a6adc8' // subtext
  return '#585b70' // muted — old
}

function formatRelativeDate(dateStr: string): string {
  if (!dateStr) return ''
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) return 'today'
  if (diffDays === 1) return '1 day ago'
  if (diffDays < 30) return `${diffDays} days ago`
  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `${diffMonths}mo ago`
  const diffYears = Math.floor(diffDays / 365)
  return `${diffYears}y ago`
}

// ─── Component ─────────────────────────────────────────────────────────────

export function BlameView({
  repoPath,
  filePath,
  onClose,
  onCommitClick
}: BlameViewProps): React.JSX.Element {
  const [blameLines, setBlameLines] = useState<BlameLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredHash, setHoveredHash] = useState<string | null>(null)
  const [tooltipInfo, setTooltipInfo] = useState<{
    line: BlameLine
    x: number
    y: number
  } | null>(null)
  const [colorMode, setColorMode] = useState<'age' | 'author'>('age')

  const fileName = useMemo(() => {
    const parts = filePath.replace(/\\/g, '/').split('/')
    return parts[parts.length - 1] || filePath
  }, [filePath])

  // ─── Load blame data ──────────────────────────────────────────────────────

  const loadBlame = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.git.blame(repoPath, filePath)
      if (result.success && result.data) {
        setBlameLines(result.data.lines || [])
      } else {
        setError(result.error || 'Failed to load blame data')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load blame data')
    } finally {
      setLoading(false)
    }
  }, [repoPath, filePath])

  useEffect(() => {
    loadBlame()
  }, [loadBlame])

  // ─── Author color map ────────────────────────────────────────────────────

  const authorColorMap = useMemo(() => {
    const authors = [...new Set(blameLines.map((l) => l.author))]
    const colors = [
      '#f38ba8', '#a6e3a1', '#89b4fa', '#f9e2af', '#cba6f7',
      '#94e2d5', '#fab387', '#74c7ec', '#eba0ac', '#b4befe'
    ]
    const map = new Map<string, string>()
    authors.forEach((author, i) => {
      map.set(author, colors[i % colors.length])
    })
    return map
  }, [blameLines])

  // ─── Group consecutive lines with same hash ──────────────────────────────

  const now = Date.now()

  const groupedLines = useMemo(() => {
    const groups: { startLine: number; hash: string; isFirstInGroup: boolean }[] = []
    let prevHash = ''
    for (let i = 0; i < blameLines.length; i++) {
      const isFirst = blameLines[i].hash !== prevHash
      groups.push({
        startLine: blameLines[i].lineNumber,
        hash: blameLines[i].hash,
        isFirstInGroup: isFirst
      })
      prevHash = blameLines[i].hash
    }
    return groups
  }, [blameLines])

  // ─── Tooltip handler ─────────────────────────────────────────────────────

  const handleBlameHover = useCallback(
    (line: BlameLine, e: React.MouseEvent) => {
      setTooltipInfo({
        line,
        x: e.clientX,
        y: e.clientY
      })
    },
    []
  )

  const handleBlameLeave = useCallback(() => {
    setTooltipInfo(null)
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="blame-view">
        <div className="blame-view-header">
          <span className="blame-view-title">Blame: {fileName}</span>
          <button className="blame-view-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="blame-view-loading">Loading blame data...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="blame-view">
        <div className="blame-view-header">
          <span className="blame-view-title">Blame: {fileName}</span>
          <button className="blame-view-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="blame-view-error">
          <span>&#9888; {error}</span>
          <button onClick={loadBlame}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="blame-view">
      <div className="blame-view-header">
        <span className="blame-view-title">Blame: {fileName}</span>
        <span className="blame-view-path" title={filePath}>{filePath}</span>
        <div className="blame-view-actions">
          <button
            className={`blame-color-toggle ${colorMode === 'age' ? 'active' : ''}`}
            onClick={() => setColorMode('age')}
            title="Color by age"
          >
            Age
          </button>
          <button
            className={`blame-color-toggle ${colorMode === 'author' ? 'active' : ''}`}
            onClick={() => setColorMode('author')}
            title="Color by author"
          >
            Author
          </button>
          <button className="blame-view-close" onClick={onClose} title="Close blame">
            &#10005;
          </button>
        </div>
      </div>

      <div className="blame-view-content">
        <div className="blame-view-lines">
          {blameLines.map((line, idx) => {
            const group = groupedLines[idx]
            const isFirstInGroup = group.isFirstInGroup
            const isHovered = hoveredHash === line.hash
            const isUncommitted = line.hash === '0000000000000000000000000000000000000000'

            const gutterColor =
              colorMode === 'age'
                ? getAgeColor(line.authorDate, now)
                : authorColorMap.get(line.author) || 'var(--text-muted)'

            return (
              <div
                key={`${line.lineNumber}-${idx}`}
                className={`blame-line ${isHovered ? 'hovered' : ''} ${isFirstInGroup ? 'group-start' : ''}`}
                onMouseEnter={() => setHoveredHash(line.hash)}
                onMouseLeave={() => setHoveredHash(null)}
              >
                {/* Blame gutter */}
                <div
                  className="blame-gutter"
                  style={{ borderLeftColor: gutterColor }}
                  onMouseEnter={(e) => handleBlameHover(line, e)}
                  onMouseLeave={handleBlameLeave}
                  onClick={() => !isUncommitted && onCommitClick?.(line.hash)}
                >
                  {isFirstInGroup ? (
                    <>
                      <span className="blame-gutter-hash" title={`Click to view commit ${line.shortHash}`}>
                        {isUncommitted ? 'uncommitted' : line.shortHash}
                      </span>
                      <span className="blame-gutter-author">
                        {line.author.length > 16 ? line.author.slice(0, 15) + '\u2026' : line.author}
                      </span>
                      <span className="blame-gutter-date">
                        {formatRelativeDate(line.authorDate)}
                      </span>
                    </>
                  ) : (
                    <span className="blame-gutter-spacer" />
                  )}
                </div>

                {/* Line number */}
                <span className="blame-line-number">{line.lineNumber}</span>

                {/* Content */}
                <pre className="blame-line-content">{line.content || ' '}</pre>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltipInfo && (
        <div
          className="blame-tooltip"
          style={{
            left: Math.min(tooltipInfo.x + 12, window.innerWidth - 340),
            top: Math.min(tooltipInfo.y + 12, window.innerHeight - 120)
          }}
        >
          <div className="blame-tooltip-hash">{tooltipInfo.line.shortHash}</div>
          <div className="blame-tooltip-summary">{tooltipInfo.line.summary}</div>
          <div className="blame-tooltip-meta">
            <span>{tooltipInfo.line.author}</span>
            <span>{tooltipInfo.line.authorDate ? new Date(tooltipInfo.line.authorDate).toLocaleString() : ''}</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Helper to open blame from other components ────────────────────────────

export function openBlameView(filePath: string): void {
  window.dispatchEvent(
    new CustomEvent('blame:open', { detail: { filePath } })
  )
}
