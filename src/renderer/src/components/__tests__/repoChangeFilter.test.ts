import { describe, it, expect } from 'vitest'
import { isOpenFileAffected } from '../repoChangeFilter'

describe('isOpenFileAffected', () => {
  it('refetches when the open file is in the changed set', () => {
    expect(isOpenFileAffected('src/a.ts', false, ['src/a.ts', 'src/b.ts'])).toBe(true)
  })
  it('does NOT refetch when only other files changed', () => {
    expect(isOpenFileAffected('src/a.ts', false, ['src/b.ts'])).toBe(false)
  })
  it('refetches on a null payload (forced/global event)', () => {
    expect(isOpenFileAffected('src/a.ts', false, null)).toBe(true)
    expect(isOpenFileAffected('src/a.ts', true, undefined)).toBe(true)
  })
  it('refetches on an empty payload (path-less watcher event)', () => {
    expect(isOpenFileAffected('src/a.ts', false, [])).toBe(true)
  })
  it('still refetches a staged view when its path is in the set', () => {
    expect(isOpenFileAffected('src/a.ts', true, ['src/a.ts'])).toBe(true)
  })
})
