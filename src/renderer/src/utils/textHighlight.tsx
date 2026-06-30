export interface HighlightRange {
  lineIndex: number
  start: number
  end: number
  /** Optional per-range override; renderWithHighlights falls back to baseClass. */
  className?: string
}

export interface FindOpts {
  caseSensitive: boolean
  wholeWord: boolean
}

const WORD_CHAR = /[A-Za-z0-9_]/

export function computeMatches(
  lines: { text: string }[],
  query: string,
  opts: FindOpts
): HighlightRange[] {
  const ranges: HighlightRange[] = []
  if (!query) return ranges
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex].text
    const hay = opts.caseSensitive ? raw : raw.toLowerCase()
    let from = 0
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from)
      if (idx === -1) break
      const end = idx + needle.length
      if (opts.wholeWord) {
        const before = idx > 0 ? raw[idx - 1] : ''
        const after = end < raw.length ? raw[end] : ''
        if ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after))) {
          from = idx + 1
          continue
        }
      }
      ranges.push({ lineIndex, start: idx, end })
      from = end // non-overlapping
    }
  }
  return ranges
}

// ─── Segment splitter + renderWithHighlights ─────────────────────────────────

import React, { Fragment } from 'react'
import { renderTextWithWhitespace } from './whitespaceMarkers'

export interface SyntaxToken {
  text: string
  className: string
}

export interface HighlightSegment {
  text: string
  className: string
  /** CSS class for the wrapping <mark>, or null if this segment is not highlighted. */
  markClass: string | null
}

export function buildHighlightSegments(
  tokens: SyntaxToken[],
  ranges: HighlightRange[],
  baseClass: string
): HighlightSegment[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const segments: HighlightSegment[] = []
  let col = 0
  for (const token of tokens) {
    const tStart = col
    const tEnd = col + token.text.length
    let cursor = tStart
    for (const r of sorted) {
      if (r.end <= cursor || r.start >= tEnd) continue
      if (r.start > cursor) {
        segments.push({ text: token.text.slice(cursor - tStart, r.start - tStart), className: token.className, markClass: null })
        cursor = r.start
      }
      const hlEnd = Math.min(r.end, tEnd)
      if (hlEnd > cursor) {
        segments.push({ text: token.text.slice(cursor - tStart, hlEnd - tStart), className: token.className, markClass: r.className ?? baseClass })
        cursor = hlEnd
      }
    }
    if (cursor < tEnd) {
      segments.push({ text: token.text.slice(cursor - tStart), className: token.className, markClass: null })
    }
    col = tEnd
  }
  return segments
}

export function renderWithHighlights(
  text: string,
  tokens: SyntaxToken[],
  ranges: HighlightRange[],
  baseClass: string
): React.ReactNode {
  const effectiveTokens = tokens.length ? tokens : [{ text, className: '' }]
  const segments = buildHighlightSegments(effectiveTokens, ranges, baseClass)
  return segments.map((seg, i) => {
    const inner = seg.className
      ? <span className={seg.className}>{renderTextWithWhitespace(seg.text, `h${i}-`)}</span>
      : <Fragment>{renderTextWithWhitespace(seg.text, `h${i}-`)}</Fragment>
    return seg.markClass
      ? <mark key={i} className={seg.markClass}>{inner}</mark>
      : <Fragment key={i}>{inner}</Fragment>
  })
}

// ─── Gutter mark math ────────────────────────────────────────────────────────

export interface FindMark {
  position: number
  current: boolean
}

export function computeFindMarks(lineIndexes: number[], totalRows: number, currentIndex: number): FindMark[] {
  if (totalRows <= 0) return []
  return lineIndexes.map((li, i) => ({ position: li / totalRows, current: i === currentIndex }))
}
