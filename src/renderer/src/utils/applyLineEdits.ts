/** A contiguous block replacement; 1-based inclusive line numbers. */
export interface BlockEdit {
  startLine: number
  endLine: number
  /** Replacement text; may contain '\n' to expand/split into several lines. */
  text: string
}

/**
 * Apply non-overlapping block edits to `original` and return the new file
 * text. The presence/absence of a trailing newline is preserved. A single
 * line edit is `startLine === endLine`; inserting a newline is `text`
 * containing '\n'.
 */
export function applyLineEdits(original: string, edits: BlockEdit[]): string {
  const hadTrailingNewline = original.endsWith('\n')
  const body = hadTrailingNewline ? original.slice(0, -1) : original
  const lines = body.split('\n')

  // Apply bottom-up so earlier line indices stay valid as we splice.
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)
  for (const edit of sorted) {
    const start = edit.startLine - 1
    const count = edit.endLine - edit.startLine + 1
    lines.splice(start, count, ...edit.text.split('\n'))
  }

  return lines.join('\n') + (hadTrailingNewline ? '\n' : '')
}
