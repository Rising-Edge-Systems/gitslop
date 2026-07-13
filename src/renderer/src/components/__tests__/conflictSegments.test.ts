import { describe, it, expect } from 'vitest'
import { parseSegments, composeOutput, composeLines, lkey, type Segment } from '../ConflictResolver'

// A standard 2-way conflict with surrounding context and a trailing newline.
const TWO_WAY = [
  'top',
  '<<<<<<< HEAD',
  'ours line',
  '=======',
  'theirs line',
  '>>>>>>> feature',
  'bottom',
  '' // trailing newline
].join('\n')

// A diff3-style conflict (merge.conflictStyle=diff3) carrying a base section.
const DIFF3 = [
  'a',
  '<<<<<<< HEAD',
  'ours',
  '||||||| base',
  'original',
  '=======',
  'theirs',
  '>>>>>>> feature',
  'b'
].join('\n')

// Two independent conflicts in one file.
const TWO_HUNKS = [
  'x',
  '<<<<<<< HEAD',
  'o1',
  '=======',
  't1',
  '>>>>>>> feature',
  'y',
  '<<<<<<< HEAD',
  'o2',
  '=======',
  't2',
  '>>>>>>> feature',
  'z'
].join('\n')

const conflictIds = (segs: Segment[]): number[] =>
  segs.filter((s) => s.kind === 'conflict').map((s) => (s as Extract<Segment, { kind: 'conflict' }>).id)

describe('conflict segment parse/compose', () => {
  it('round-trips an unresolved file byte-for-byte (incl. trailing newline)', () => {
    const segs = parseSegments(TWO_WAY)
    // Empty selection → every conflict re-emits its raw markers verbatim.
    expect(composeOutput(segs, {})).toBe(TWO_WAY)
  })

  it('round-trips a diff3 conflict verbatim while unresolved (base preserved)', () => {
    const segs = parseSegments(DIFF3)
    expect(composeOutput(segs, {})).toBe(DIFF3)
  })

  it('includes ours / theirs / both in the checked order', () => {
    const segs = parseSegments(TWO_WAY)
    const [id] = conflictIds(segs)
    expect(composeOutput(segs, { [id]: ['ours'] })).toBe('top\nours line\nbottom\n')
    expect(composeOutput(segs, { [id]: ['theirs'] })).toBe('top\ntheirs line\nbottom\n')
    expect(composeOutput(segs, { [id]: ['ours', 'theirs'] })).toBe('top\nours line\ntheirs line\nbottom\n')
    expect(composeOutput(segs, { [id]: ['theirs', 'ours'] })).toBe('top\ntheirs line\nours line\nbottom\n')
  })

  it('for diff3, ours/theirs drop the base section', () => {
    const segs = parseSegments(DIFF3)
    const [id] = conflictIds(segs)
    expect(composeOutput(segs, { [id]: ['ours'] })).toBe('a\nours\nb')
    expect(composeOutput(segs, { [id]: ['theirs'] })).toBe('a\ntheirs\nb')
  })

  it('resolving one hunk leaves the other hunk\'s markers intact (no base/label mangling)', () => {
    const segs = parseSegments(TWO_HUNKS)
    const [id1, id2] = conflictIds(segs)
    const out = composeOutput(segs, { [id1]: ['ours'] })
    expect(out).toContain('x\no1\ny')
    expect(out).toContain('<<<<<<< HEAD\no2\n=======\nt2\n>>>>>>> feature')
    const done = composeOutput(segs, { [id1]: ['ours'], [id2]: ['theirs'] })
    expect(done).toBe('x\no1\ny\nt2\nz')
    expect(done).not.toContain('<<<<<<<')
  })

  it('parses ours/base/theirs line content for the side-by-side view', () => {
    const segs = parseSegments(DIFF3)
    const conflict = segs.find((s) => s.kind === 'conflict') as Extract<Segment, { kind: 'conflict' }>
    expect(conflict.ours).toEqual(['ours'])
    expect(conflict.base).toEqual(['original'])
    expect(conflict.theirs).toEqual(['theirs'])
  })
})

// The line-level model that actually writes the resolved file (`composeLines`).
describe('line-level compose', () => {
  const MULTI = [
    'top',
    '<<<<<<< HEAD',
    'o1',
    'o2',
    '=======',
    't1',
    't2',
    '>>>>>>> feature',
    'bottom',
    ''
  ].join('\n')

  const id0 = (): number =>
    (parseSegments(MULTI).find((s) => s.kind === 'conflict') as Extract<Segment, { kind: 'conflict' }>).id

  it('re-emits raw markers for an untouched (undefined) conflict', () => {
    const segs = parseSegments(MULTI)
    expect(composeLines(segs, {})).toBe(MULTI)
  })

  it('emits only the checked lines, ours block before theirs block', () => {
    const segs = parseSegments(MULTI)
    const id = id0()
    // pick ours[1] ("o2") and theirs[0] ("t1")
    const sel = { [id]: new Set([lkey('ours', 1), lkey('theirs', 0)]) }
    expect(composeLines(segs, sel)).toBe('top\no2\nt1\nbottom\n')
  })

  it('take-all-ours reproduces the whole ours side', () => {
    const segs = parseSegments(MULTI)
    const id = id0()
    const sel = { [id]: new Set([lkey('ours', 0), lkey('ours', 1)]) }
    expect(composeLines(segs, sel)).toBe('top\no1\no2\nbottom\n')
  })

  it('an empty (but defined) selection means "take neither" — the conflict is dropped', () => {
    const segs = parseSegments(MULTI)
    const id = id0()
    const sel = { [id]: new Set<string>() }
    expect(composeLines(segs, sel)).toBe('top\nbottom\n')
  })
})
