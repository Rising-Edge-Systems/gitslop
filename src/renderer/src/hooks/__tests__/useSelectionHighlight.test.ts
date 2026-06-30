// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { selectionRanges } from '../useSelectionHighlight'

const L = (...t: string[]) => t.map((text) => ({ text }))

describe('selectionRanges', () => {
  it('highlights every other occurrence, excluding the active selection itself', () => {
    // line0 "foo bar foo", select first "foo" (start 0). whole-word selection.
    const out = selectionRanges(L('foo bar foo', 'foo'), 'foo', 0, 0, '', ' ')
    expect(out).toEqual([
      { lineIndex: 0, start: 8, end: 11 },
      { lineIndex: 1, start: 0, end: 3 }
    ])
  })
  it('returns [] for a whitespace selection', () => {
    expect(selectionRanges(L('a  a'), '  ', 0, 1, 'a', 'a')).toEqual([])
  })
  it('uses literal substring (not whole-word) when the selection is not a clean word', () => {
    // select "oo" inside "foo" → boundary char 'f' is a word char → substring mode
    // Note: brief had a typo ('foo oot', 'oo') — 'foo oot' contains a second "oo"
    // at index 4 that invalidates the expected output. Correct data: line0='foo ot', line1='oot'.
    const out = selectionRanges(L('foo ot', 'oot'), 'oo', 0, 1, 'f', ' ')
    // matches "oo" at line0 start1(excluded), line1 "oot" start0
    expect(out).toEqual([{ lineIndex: 1, start: 0, end: 2 }])
  })
})
