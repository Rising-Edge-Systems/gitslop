/** A contiguous block replacement; 1-based inclusive line numbers. */
export interface BlockEdit {
  startLine: number
  endLine: number
  /** Replacement text; may contain '\n' to expand/split into several lines. */
  text: string
}

/** Strip a single trailing '\r' so split lines compare/edit in '\n' space. */
function stripCR(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/**
 * Apply non-overlapping block edits to `original` and return the new file
 * text. The presence/absence of a trailing newline is preserved, and the
 * file's dominant line ending is preserved: a CRLF file is re-joined with
 * '\r\n' even though the seeded line text (parsed from diff content) and the
 * edit `text` arrive without '\r'. A single line edit is
 * `startLine === endLine`; inserting a newline is `text` containing '\n'.
 */
export function applyLineEdits(original: string, edits: BlockEdit[]): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  const hadTrailingNewline = original.endsWith('\n')
  const body = hadTrailingNewline ? original.slice(0, -1) : original
  // Work in '\n' space: strip any trailing '\r' from every split line.
  const lines = body.split('\n').map(stripCR)

  // Apply bottom-up so earlier line indices stay valid as we splice.
  const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)
  for (const edit of sorted) {
    const start = edit.startLine - 1
    const count = edit.endLine - edit.startLine + 1
    lines.splice(start, count, ...edit.text.split('\n').map(stripCR))
  }

  return lines.join(eol) + (hadTrailingNewline ? eol : '')
}
