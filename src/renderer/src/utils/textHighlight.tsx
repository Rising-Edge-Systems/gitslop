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
