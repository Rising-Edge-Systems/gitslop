// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useInlineLineEdit } from '../useInlineLineEdit'
import { EditableTarget } from '../../utils/inlineEditNav'

const targets: EditableTarget[] = [
  { displayIndex: 1, fileLine: 1 },
  { displayIndex: 2, fileLine: 2 },
  { displayIndex: 3, fileLine: 3 }
]
const lineText = new Map<number, string>([[1, 'one'], [2, 'two'], [3, 'three']])

let readMock: ReturnType<typeof vi.fn>
let writeMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  readMock = vi.fn(async () => ({ success: true, data: 'one\ntwo\nthree\n' }))
  writeMock = vi.fn(async () => ({ success: true }))
  vi.stubGlobal('window', { ...globalThis.window, electronAPI: { file: { read: readMock, write: writeMock } } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function setup(onSaved = vi.fn()) {
  return renderHook(() => useInlineLineEdit({ absPath: '/repo/f.txt', targets, lineText, onSaved }))
}

describe('useInlineLineEdit', () => {
  it('enter() seeds editing state and the buffer from the line text', () => {
    const { result } = setup()
    act(() => result.current.enter(2))
    expect(result.current.editing).toEqual({ anchorLine: 2, focusLine: 2 })
    expect(result.current.buffer).toBe('two')
  })

  it('commit() writes the applied file content and fires onSaved', async () => {
    const onSaved = vi.fn()
    const { result } = setup(onSaved)
    act(() => result.current.enter(2))
    act(() => result.current.setBuffer('TWO'))
    await act(async () => { await result.current.commit() })
    expect(writeMock).toHaveBeenCalledWith('/repo/f.txt', 'one\nTWO\nthree\n')
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(result.current.editing).toBeNull()
  })

  it('moveDown() commits then advances the edit to the next target', async () => {
    const { result } = setup()
    act(() => result.current.enter(1))
    act(() => result.current.setBuffer('ONE'))
    await act(async () => { await result.current.moveDown() })
    expect(writeMock).toHaveBeenCalledWith('/repo/f.txt', 'ONE\ntwo\nthree\n')
    expect(result.current.editing).toEqual({ anchorLine: 2, focusLine: 2 })
    expect(result.current.buffer).toBe('two')
  })

  it('cancel() clears editing without writing', () => {
    const { result } = setup()
    act(() => result.current.enter(1))
    act(() => result.current.cancel())
    expect(result.current.editing).toBeNull()
    expect(writeMock).not.toHaveBeenCalled()
  })
})
