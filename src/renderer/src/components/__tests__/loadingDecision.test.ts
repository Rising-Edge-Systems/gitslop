import { describe, it, expect } from 'vitest'
import { shouldShowLoadingSpinner } from '../loadingDecision'

describe('shouldShowLoadingSpinner', () => {
  it('shows on first load (identity changed, no content yet)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: true, hasCurrentContent: false })).toBe(true)
  })
  it('shows when switching to a different file (identity changed, content present)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: true, hasCurrentContent: true })).toBe(true)
  })
  it('stays silent on a background refresh of the same file', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: false, hasCurrentContent: true })).toBe(false)
  })
  it('shows when the same identity has no content yet (view toggled before first fetch)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: false, hasCurrentContent: false })).toBe(true)
  })
})
