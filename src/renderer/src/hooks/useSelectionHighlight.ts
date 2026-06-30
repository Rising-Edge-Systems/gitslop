import { useState, useEffect } from 'react'
import type React from 'react'
import {
  selectionToQuery,
  isWordSelection,
  computeMatches,
  excludeOwnRange,
  type HighlightRange
} from '../utils/textHighlight'

/** Pure core: given the selected text + its line/offset/boundary context, return the
 *  ranges to highlight (all matches minus the selection's own range). */
export function selectionRanges(
  lines: { text: string }[],
  selectedText: string,
  ownLineIndex: number,
  ownStart: number,
  before: string,
  after: string
): HighlightRange[] {
  const q = selectionToQuery(selectedText, isWordSelection(before, selectedText, after))
  if (!q) return []
  const all = computeMatches(lines, q.query, { caseSensitive: q.caseSensitive, wholeWord: q.wholeWord })
  return excludeOwnRange(all, { lineIndex: ownLineIndex, start: ownStart })
}

/** DOM glue: tracks the active selection inside containerRef and produces highlight ranges. */
export function useSelectionHighlight(
  lines: { text: string }[],
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
): HighlightRange[] {
  const [ranges, setRanges] = useState<HighlightRange[]>([])

  useEffect(() => {
    if (!enabled) {
      setRanges([])
      return
    }
    const container = containerRef.current
    if (!container) return

    const recompute = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setRanges([])
        return
      }
      const text = sel.toString()
      const anchor = sel.anchorNode
      if (!anchor || !container.contains(anchor)) {
        setRanges([])
        return
      }
      // Find the line element carrying data-find-line for this selection.
      const el = (
        anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : (anchor as HTMLElement)
      )?.closest('[data-find-line]') as HTMLElement | null
      if (!el) {
        setRanges([])
        return
      }
      const lineIndex = Number(el.dataset.findLine)
      const lineText = lines[lineIndex]?.text ?? ''
      const start = lineText.indexOf(text)
      if (start < 0) {
        setRanges([])
        return
      }
      const before = start > 0 ? lineText[start - 1] : ''
      const after = start + text.length < lineText.length ? lineText[start + text.length] : ''
      setRanges(selectionRanges(lines, text, lineIndex, start, before, after))
    }

    document.addEventListener('selectionchange', recompute)
    return () => document.removeEventListener('selectionchange', recompute)
  }, [lines, containerRef, enabled])

  return ranges
}
