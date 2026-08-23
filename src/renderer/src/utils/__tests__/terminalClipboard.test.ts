import { describe, it, expect, vi } from 'vitest'
import { terminalRightClick } from '../terminalClipboard'

function makeTerm(selection = ''): {
  getSelection: () => string
  clearSelection: () => void
  paste: (text: string) => void
} {
  return {
    getSelection: vi.fn(() => selection),
    clearSelection: vi.fn(),
    paste: vi.fn()
  }
}

function makeClipboard(contents = ''): {
  readText: () => Promise<string>
  writeText: (text: string) => Promise<{ success: boolean }>
} {
  return {
    readText: vi.fn(async () => contents),
    writeText: vi.fn(async () => ({ success: true }))
  }
}

describe('terminalRightClick', () => {
  // Regression: the terminal had no clipboard handling at all, so a file path
  // copied from elsewhere could not be pasted in (issue #7).
  it('pastes the clipboard when nothing is selected', async () => {
    const term = makeTerm('')
    const clipboard = makeClipboard('/home/user/some/path')

    const action = await terminalRightClick(term, clipboard)

    expect(action).toBe('paste')
    expect(term.paste).toHaveBeenCalledWith('/home/user/some/path')
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })

  it('copies the selection instead of pasting when text is selected', async () => {
    const term = makeTerm('git status')
    const clipboard = makeClipboard('should not be pasted')

    const action = await terminalRightClick(term, clipboard)

    expect(action).toBe('copy')
    expect(clipboard.writeText).toHaveBeenCalledWith('git status')
    expect(term.clearSelection).toHaveBeenCalled()
    expect(term.paste).not.toHaveBeenCalled()
  })

  it('does nothing when there is no selection and the clipboard is empty', async () => {
    const term = makeTerm('')
    const clipboard = makeClipboard('')

    const action = await terminalRightClick(term, clipboard)

    expect(action).toBe('noop')
    expect(term.paste).not.toHaveBeenCalled()
  })

  // Multi-line pastes must go through xterm's paste(), which wraps them in
  // bracketed-paste markers so the shell does not run each line on arrival.
  it('routes multi-line pastes through paste() as a single chunk', async () => {
    const term = makeTerm('')
    const clipboard = makeClipboard('git add -A\ngit commit -m "wip"\n')

    const action = await terminalRightClick(term, clipboard)

    expect(action).toBe('paste')
    expect(term.paste).toHaveBeenCalledTimes(1)
    expect(term.paste).toHaveBeenCalledWith('git add -A\ngit commit -m "wip"\n')
  })
})
