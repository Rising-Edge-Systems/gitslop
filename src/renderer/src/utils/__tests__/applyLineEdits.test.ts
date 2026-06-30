import { describe, it, expect } from 'vitest'
import { applyLineEdits } from '../applyLineEdits'

describe('applyLineEdits', () => {
  it('replaces a single line', () => {
    expect(applyLineEdits('a\nb\nc\n', [{ startLine: 2, endLine: 2, text: 'B' }])).toBe('a\nB\nc\n')
  })
  it('replaces a multi-line block with one line', () => {
    expect(applyLineEdits('a\nb\nc\nd\n', [{ startLine: 2, endLine: 3, text: 'X' }])).toBe('a\nX\nd\n')
  })
  it('splits one line into two via an embedded newline', () => {
    expect(applyLineEdits('a\nbc\nd\n', [{ startLine: 2, endLine: 2, text: 'b\nc' }])).toBe('a\nb\nc\nd\n')
  })
  it('preserves a trailing newline', () => {
    expect(applyLineEdits('a\nb\n', [{ startLine: 1, endLine: 1, text: 'A' }])).toBe('A\nb\n')
  })
  it('preserves absence of a trailing newline', () => {
    expect(applyLineEdits('a\nb', [{ startLine: 1, endLine: 1, text: 'A' }])).toBe('A\nb')
  })
  it('applies multiple non-overlapping edits regardless of order', () => {
    expect(
      applyLineEdits('a\nb\nc\n', [{ startLine: 3, endLine: 3, text: 'C' }, { startLine: 1, endLine: 1, text: 'A' }])
    ).toBe('A\nb\nC\n')
  })
})

describe('applyLineEdits — CRLF preservation', () => {
  it('keeps CRLF when editing a single line seeded without \\r', () => {
    expect(applyLineEdits('a\r\nb\r\nc\r\n', [{ startLine: 2, endLine: 2, text: 'B' }])).toBe('a\r\nB\r\nc\r\n')
  })
  it('keeps CRLF throughout a multi-line expand', () => {
    expect(applyLineEdits('a\r\nb\r\nc\r\n', [{ startLine: 2, endLine: 2, text: 'X\nY' }])).toBe('a\r\nX\r\nY\r\nc\r\n')
  })
  it('strips a stray \\r in the edit text and re-emits CRLF', () => {
    expect(applyLineEdits('a\r\nb\r\nc\r\n', [{ startLine: 2, endLine: 2, text: 'B\r' }])).toBe('a\r\nB\r\nc\r\n')
  })
  it('leaves an LF file untouched (no \\r introduced)', () => {
    expect(applyLineEdits('a\nb\nc\n', [{ startLine: 2, endLine: 2, text: 'B' }])).toBe('a\nB\nc\n')
  })
})
