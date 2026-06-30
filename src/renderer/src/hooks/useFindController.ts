import { useMemo, useState, useCallback, useEffect } from 'react'
import { computeMatches, type HighlightRange, type FindOpts } from '../utils/textHighlight'

export interface FindController {
  matches: HighlightRange[]
  currentIndex: number
  count: number
  next: () => void
  prev: () => void
  goto: (i: number) => void
}

export function useFindController(lines: { text: string }[], query: string, opts: FindOpts): FindController {
  const matches = useMemo(
    () => computeMatches(lines, query, opts),
    [lines, query, opts.caseSensitive, opts.wholeWord]
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const count = matches.length

  // Reset selection to the first match whenever the search query or options change.
  useEffect(() => {
    setCurrentIndex(0)
  }, [query, opts.caseSensitive, opts.wholeWord])

  // Clamp currentIndex when the match set shrinks (e.g. document reload with fewer matches).
  // NOTE: 'lines' is intentionally NOT in the reset-effect deps above — position is preserved
  // on document change. This effect only clamps; it does not reset to 0.
  useEffect(() => {
    setCurrentIndex((i) => (count > 0 ? Math.min(i, count - 1) : 0))
  }, [count])

  const next = useCallback(() => setCurrentIndex((i) => (count ? (i + 1) % count : 0)), [count])
  const prev = useCallback(() => setCurrentIndex((i) => (count ? (i - 1 + count) % count : 0)), [count])

  // Guard goto: clamp argument to [0, count-1]; no-op to 0 when count is 0.
  const goto = useCallback(
    (i: number) => setCurrentIndex(count > 0 ? Math.max(0, Math.min(i, count - 1)) : 0),
    [count]
  )

  return { matches, currentIndex, count, next, prev, goto }
}
