// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFindController } from '../useFindController'

const L = (...t: string[]) => t.map((text) => ({ text }))
const OPTS = { caseSensitive: false, wholeWord: false }

afterEach(() => cleanup())

describe('useFindController', () => {
  it('computes matches and count', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    expect(result.current.count).toBe(3)
    expect(result.current.currentIndex).toBe(0)
  })
  it('next/prev wrap around', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    act(() => result.current.prev())
    expect(result.current.currentIndex).toBe(2)
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(0)
  })
  it('resets currentIndex to 0 when the query changes', () => {
    const { result, rerender } = renderHook(({ q }) => useFindController(L('a a a'), q, OPTS), {
      initialProps: { q: 'a' }
    })
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(1)
    rerender({ q: 'aa' })
    expect(result.current.currentIndex).toBe(0)
  })
})
