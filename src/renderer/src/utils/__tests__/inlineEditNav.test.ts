import { describe, it, expect } from 'vitest'
import { buildEditableTargets, nextEditable, prevEditable, extendSelection, NavItem } from '../inlineEditNav'

// Hunk 1: header, context@10, removed(old), added@11, added@12
// Hunk 2: header, context@50, added@51
const items: NavItem[] = [
  { type: 'hunkHeader', line: null },
  { type: 'line', line: { type: 'context', newLineNum: 10 } },
  { type: 'line', line: { type: 'removed', newLineNum: null } },
  { type: 'line', line: { type: 'added', newLineNum: 11 } },
  { type: 'line', line: { type: 'added', newLineNum: 12 } },
  { type: 'hunkHeader', line: null },
  { type: 'line', line: { type: 'context', newLineNum: 50 } },
  { type: 'line', line: { type: 'added', newLineNum: 51 } }
]

describe('buildEditableTargets', () => {
  it('keeps context+added rows, skips hunk headers and removed rows', () => {
    expect(buildEditableTargets(items)).toEqual([
      { displayIndex: 1, fileLine: 10 },
      { displayIndex: 3, fileLine: 11 },
      { displayIndex: 4, fileLine: 12 },
      { displayIndex: 6, fileLine: 50 },
      { displayIndex: 7, fileLine: 51 }
    ])
  })
})

describe('extendSelection', () => {
  const t = buildEditableTargets(items) // from the top-of-file fixture
  it('extends down onto the adjacent file line', () => {
    expect(extendSelection(11, 11, 'down', t)).toEqual({ anchorFileLine: 11, focusFileLine: 12 })
  })
  it('extends up onto the adjacent file line', () => {
    expect(extendSelection(12, 12, 'up', t)).toEqual({ anchorFileLine: 12, focusFileLine: 11 })
  })
  it('refuses to extend across a non-contiguous gap (hunk boundary: 12 -> 50)', () => {
    expect(extendSelection(12, 12, 'down', t)).toBeNull()
  })
  it('refuses to extend past the ends', () => {
    expect(extendSelection(51, 51, 'down', t)).toBeNull()
  })
})

describe('nextEditable / prevEditable', () => {
  const t = buildEditableTargets(items)
  it('steps within a hunk', () => {
    expect(nextEditable(10, t)).toEqual({ displayIndex: 3, fileLine: 11 })
  })
  it('HEADLINE: stepping past the last row of a hunk lands on the next hunk’s first editable row', () => {
    expect(nextEditable(12, t)).toEqual({ displayIndex: 6, fileLine: 50 })
  })
  it('prevEditable mirrors across the hunk boundary', () => {
    expect(prevEditable(50, t)).toEqual({ displayIndex: 4, fileLine: 12 })
  })
  it('returns null at the ends', () => {
    expect(nextEditable(51, t)).toBeNull()
    expect(prevEditable(10, t)).toBeNull()
  })
})
