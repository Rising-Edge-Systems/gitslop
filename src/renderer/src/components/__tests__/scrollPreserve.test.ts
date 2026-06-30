import { describe, it, expect } from 'vitest'
import { clampRestoreScrollTop } from '../scrollPreserve'

describe('clampRestoreScrollTop', () => {
  it('returns the saved offset when it still fits', () => {
    expect(clampRestoreScrollTop(120, 500)).toBe(120)
  })
  it('clamps to the new max when the content shrank', () => {
    expect(clampRestoreScrollTop(900, 300)).toBe(300)
  })
  it('never returns a negative offset', () => {
    expect(clampRestoreScrollTop(-10, 500)).toBe(0)
  })
  it('clamps to 0 when content is shorter than the viewport (negative max)', () => {
    expect(clampRestoreScrollTop(120, -40)).toBe(0)
  })
})
