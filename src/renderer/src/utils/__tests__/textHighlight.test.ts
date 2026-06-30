import { describe, it, expect } from 'vitest'
import { computeMatches, buildHighlightSegments, computeFindMarks, mergeColumnMatches } from '../textHighlight'

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

const tok = (text: string, className = '') => ({ text, className })

describe('buildHighlightSegments', () => {
  it('returns one unhighlighted segment when no ranges', () => {
    expect(buildHighlightSegments([tok('hello')], [], 'findMatch')).toEqual([
      { text: 'hello', className: '', markClass: null }
    ])
  })
  it('splits a single plain token around one range', () => {
    expect(buildHighlightSegments([tok('foobar')], [{ lineIndex: 0, start: 3, end: 6 }], 'findMatch')).toEqual([
      { text: 'foo', className: '', markClass: null },
      { text: 'bar', className: '', markClass: 'findMatch' }
    ])
  })
  it('splits a match that straddles two syntax tokens, preserving classes', () => {
    // tokens: "fo"(syn-keyword) + "obar"(""), match cols 1..4 = "oob"
    expect(buildHighlightSegments(
      [tok('fo', 'syn-keyword'), tok('obar')],
      [{ lineIndex: 0, start: 1, end: 4 }],
      'findMatch'
    )).toEqual([
      { text: 'f', className: 'syn-keyword', markClass: null },
      { text: 'o', className: 'syn-keyword', markClass: 'findMatch' },
      { text: 'ob', className: '', markClass: 'findMatch' },
      { text: 'ar', className: '', markClass: null }
    ])
  })
  it('uses the range className override when present (current match)', () => {
    expect(buildHighlightSegments([tok('abc')], [{ lineIndex: 0, start: 0, end: 3, className: 'findMatchCurrent' }], 'findMatch')).toEqual([
      { text: 'abc', className: '', markClass: 'findMatchCurrent' }
    ])
  })
})

describe('mergeColumnMatches', () => {
  it('orders by lineIndex, then left-before-right, then start', () => {
    const left = [{ lineIndex: 0, start: 5, end: 6 }, { lineIndex: 1, start: 0, end: 1 }]
    const right = [{ lineIndex: 0, start: 2, end: 3 }]
    expect(mergeColumnMatches(left, right)).toEqual([
      { lineIndex: 0, start: 5, end: 6, column: 'left' },
      { lineIndex: 0, start: 2, end: 3, column: 'right' },
      { lineIndex: 1, start: 0, end: 1, column: 'left' }
    ])
  })
})

describe('computeFindMarks', () => {
  it('maps line indexes to proportional positions and flags the current', () => {
    expect(computeFindMarks([0, 50], 100, 1)).toEqual([
      { position: 0, current: false },
      { position: 0.5, current: true }
    ])
  })
  it('returns [] when totalRows is 0', () => {
    expect(computeFindMarks([0], 0, 0)).toEqual([])
  })
})
