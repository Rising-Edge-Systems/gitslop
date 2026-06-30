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

describe('clamp on shrink', () => {
  it('clamps currentIndex to count-1 when match set shrinks (not reset to 0)', () => {
    // 'a a a a a a a a a a' = 10 'a' matches
    const { result, rerender } = renderHook(
      ({ lines }) => useFindController(lines, 'a', OPTS),
      { initialProps: { lines: L('a a a a a a a a a a') } }
    )
    expect(result.current.count).toBe(10)
    act(() => result.current.goto(7))
    expect(result.current.currentIndex).toBe(7)

    // Reload document with only 4 matches
    rerender({ lines: L('a a a a') })
    expect(result.current.count).toBe(4)
    // Must clamp to count-1 = 3, NOT reset to 0
    expect(result.current.currentIndex).toBe(3)
    expect(result.current.matches[result.current.currentIndex]).toBeDefined()
  })

  it('preserves position when still in range after shrink', () => {
    // 'a a a a a a a a a a' = 10 matches
    const { result, rerender } = renderHook(
      ({ lines }) => useFindController(lines, 'a', OPTS),
      { initialProps: { lines: L('a a a a a a a a a a') } }
    )
    act(() => result.current.goto(2))
    expect(result.current.currentIndex).toBe(2)

    // Reload with 6 matches — index 2 is still valid, must NOT be reset to 0
    rerender({ lines: L('a a a a a a') })
    expect(result.current.count).toBe(6)
    expect(result.current.currentIndex).toBe(2)
  })

  it('sets currentIndex to 0 when count drops to 0', () => {
    const { result, rerender } = renderHook(
      ({ lines }) => useFindController(lines, 'a', OPTS),
      { initialProps: { lines: L('a a a') } }
    )
    act(() => result.current.goto(2))
    expect(result.current.currentIndex).toBe(2)

    // No matches — query unchanged, document changed
    rerender({ lines: L('bbb bbb') })
    expect(result.current.count).toBe(0)
    expect(result.current.currentIndex).toBe(0)
  })
})

describe('goto range guard', () => {
  it('clamps goto(999) to count-1', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    act(() => result.current.goto(999))
    expect(result.current.currentIndex).toBe(2) // count=3, max valid index is 2
  })

  it('clamps goto(-5) to 0', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    act(() => result.current.goto(5))
    act(() => result.current.goto(-5))
    expect(result.current.currentIndex).toBe(0)
  })

  it('goto is a no-op (stays 0) when count is 0', () => {
    const { result } = renderHook(() => useFindController(L('bbb'), 'a', OPTS))
    expect(result.current.count).toBe(0)
    act(() => result.current.goto(5))
    expect(result.current.currentIndex).toBe(0)
  })
})
