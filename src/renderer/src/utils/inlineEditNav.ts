/** A row that can be edited in place, in display order. */
export interface EditableTarget {
  /** Index into the flat InlineVirtualItem[] this target came from. */
  displayIndex: number
  /** 1-based new-file (working-tree) line number. */
  fileLine: number
}

/** Minimal structural shape of a flat inline row (InlineVirtualItem satisfies this). */
export interface NavItem {
  type: 'hunkHeader' | 'line'
  line: { type: 'context' | 'added' | 'removed'; newLineNum: number | null } | null
}

/**
 * Reduce a flat inline row list to its editable targets, in display order.
 * Editable iff the row maps to a current file line: context + added rows
 * (they carry a new-side line number). Hunk headers and pure removed rows
 * have no working-tree line, so they are skipped.
 */
export function buildEditableTargets(items: NavItem[]): EditableTarget[] {
  const targets: EditableTarget[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.type !== 'line' || !it.line) continue
    if (it.line.type === 'removed' || it.line.newLineNum == null) continue
    targets.push({ displayIndex: i, fileLine: it.line.newLineNum })
  }
  return targets
}

function indexOfFileLine(fileLine: number, targets: EditableTarget[]): number {
  for (let i = 0; i < targets.length; i++) if (targets[i].fileLine === fileLine) return i
  return -1
}

/** Next editable target in display order after `currentFileLine`, or null at the end. */
export function nextEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null {
  const idx = indexOfFileLine(currentFileLine, targets)
  if (idx === -1 || idx + 1 >= targets.length) return null
  return targets[idx + 1]
}

/** Previous editable target in display order before `currentFileLine`, or null at the start. */
export function prevEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null {
  const idx = indexOfFileLine(currentFileLine, targets)
  if (idx <= 0) return null
  return targets[idx - 1]
}

/**
 * Grow/shrink a multi-line edit by one row in display order. Returns the new
 * {anchorFileLine, focusFileLine}, or null if the step is not allowed.
 *
 * Extension is permitted only onto an *adjacent* file line (focus ± 1), so
 * the spanned rows always map to a contiguous block of file lines — which
 * keeps the textarea content exactly equal to file lines [min..max].
 */
export function extendSelection(
  anchorFileLine: number,
  focusFileLine: number,
  dir: 'up' | 'down',
  targets: EditableTarget[]
): { anchorFileLine: number; focusFileLine: number } | null {
  const next = dir === 'down'
    ? nextEditable(focusFileLine, targets)
    : prevEditable(focusFileLine, targets)
  if (!next) return null
  const expected = dir === 'down' ? focusFileLine + 1 : focusFileLine - 1
  if (next.fileLine !== expected) return null
  return { anchorFileLine, focusFileLine: next.fileLine }
}
