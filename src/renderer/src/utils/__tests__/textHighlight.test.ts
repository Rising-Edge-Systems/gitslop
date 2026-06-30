import { describe, it, expect } from 'vitest'
import { computeMatches } from '../textHighlight'

const L = (...t: string[]) => t.map((text) => ({ text }))

describe('computeMatches', () => {
  it('returns [] for empty query', () => {
    expect(computeMatches(L('hello world'), '', { caseSensitive: false, wholeWord: false })).toEqual([])
  })
  it('finds case-insensitive matches by default', () => {
    expect(computeMatches(L('Foo foo FOO'), 'foo', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 3 },
      { lineIndex: 0, start: 4, end: 7 },
      { lineIndex: 0, start: 8, end: 11 }
    ])
  })
  it('respects case sensitivity', () => {
    expect(computeMatches(L('Foo foo'), 'foo', { caseSensitive: true, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 4, end: 7 }
    ])
  })
  it('is non-overlapping (aa in aaaa = 2 matches)', () => {
    expect(computeMatches(L('aaaa'), 'aa', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 2 },
      { lineIndex: 0, start: 2, end: 4 }
    ])
  })
  it('whole-word only matches at word boundaries', () => {
    expect(computeMatches(L('cat catalog scatter cat'), 'cat', { caseSensitive: false, wholeWord: true })).toEqual([
      { lineIndex: 0, start: 0, end: 3 },
      { lineIndex: 0, start: 20, end: 23 }
    ])
  })
  it('tracks lineIndex across multiple lines', () => {
    expect(computeMatches(L('x', 'ax', 'x'), 'x', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 1 },
      { lineIndex: 1, start: 1, end: 2 },
      { lineIndex: 2, start: 0, end: 1 }
    ])
  })
})
