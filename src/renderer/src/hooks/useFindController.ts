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

  const next = useCallback(() => setCurrentIndex((i) => (count ? (i + 1) % count : 0)), [count])
  const prev = useCallback(() => setCurrentIndex((i) => (count ? (i - 1 + count) % count : 0)), [count])
  const goto = useCallback((i: number) => setCurrentIndex(i), [])

  return { matches, currentIndex, count, next, prev, goto }
}
