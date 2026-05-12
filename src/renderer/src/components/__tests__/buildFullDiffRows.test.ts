import { describe, it, expect } from 'vitest'
import { buildFullDiffRows } from '../DiffViewer'

describe('buildFullDiffRows', () => {
  // Regression: `@@ -0,0 +N,M @@` (new file) used to produce hunkOldStart = -1,
  // which left oldIdx at -1 after walking the hunk. The final cleanup loop then
  // saw `-1 < 0` as truthy and emitted a phantom row with `left.content =
  // oldLines[-1] = undefined`, crashing the maxRowCharWidth useMemo on
  // `.length`. Symptom: any new file opened in Full Diff view threw
  // "Cannot read properties of undefined (reading 'length')".
  it('does not emit a phantom undefined row for a new (added) file', () => {
    const rows = buildFullDiffRows(
      [],
      ['line1', 'line2', 'line3'],
      [
        {
          header: '@@ -0,0 +1,3 @@',
          headerSuffix: '',
          lines: [
            { type: 'added', content: 'line1', rawContent: '+line1', oldLineNum: null, newLineNum: 1 },
            { type: 'added', content: 'line2', rawContent: '+line2', oldLineNum: null, newLineNum: 2 },
            { type: 'added', content: 'line3', rawContent: '+line3', oldLineNum: null, newLineNum: 3 }
          ]
        }
      ]
    )
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      if (r.left) expect(typeof r.left.content).toBe('string')
      if (r.right) expect(typeof r.right.content).toBe('string')
    }
  })

  it('does not emit a phantom undefined row for a deleted file', () => {
    const rows = buildFullDiffRows(
      ['line1', 'line2', 'line3'],
      [],
      [
        {
          header: '@@ -1,3 +0,0 @@',
          headerSuffix: '',
          lines: [
            { type: 'removed', content: 'line1', rawContent: '-line1', oldLineNum: 1, newLineNum: null },
            { type: 'removed', content: 'line2', rawContent: '-line2', oldLineNum: 2, newLineNum: null },
            { type: 'removed', content: 'line3', rawContent: '-line3', oldLineNum: 3, newLineNum: null }
          ]
        }
      ]
    )
    expect(rows).toHaveLength(3)
    for (const r of rows) {
      if (r.left) expect(typeof r.left.content).toBe('string')
      if (r.right) expect(typeof r.right.content).toBe('string')
    }
  })
})
