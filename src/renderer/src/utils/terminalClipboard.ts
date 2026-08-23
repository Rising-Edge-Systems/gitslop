/**
 * Terminal clipboard behaviour — extracted for testability.
 *
 * Terminals conventionally bind copy and paste to right-click rather than to
 * Ctrl+C/Ctrl+V, because those two are already spoken for: Ctrl+C sends SIGINT
 * and Ctrl+V inserts the next keystroke literally. PuTTY, Windows Terminal and
 * most Linux emulators therefore copy on right-click when text is selected and
 * paste when it is not.
 */

/** The slice of xterm's Terminal this module needs. */
export interface TerminalClipboardTarget {
  getSelection: () => string
  clearSelection: () => void
  paste: (text: string) => void
}

/** The slice of window.electronAPI.clipboard this module needs. */
export interface ClipboardBridge {
  readText: () => Promise<string>
  writeText: (text: string) => Promise<{ success: boolean }>
}

export type RightClickAction = 'copy' | 'paste' | 'noop'

/**
 * Copy the selection if there is one, otherwise paste the clipboard.
 *
 * Pasting goes through xterm's paste() rather than writing to the pty directly,
 * so bracketed-paste mode is honoured: a multi-line paste arrives at the shell
 * as a single chunk instead of executing itself line by line.
 *
 * Returns the action taken, so callers and tests can assert on it.
 */
export async function terminalRightClick(
  term: TerminalClipboardTarget,
  clipboard: ClipboardBridge
): Promise<RightClickAction> {
  const selection = term.getSelection()
  if (selection) {
    await clipboard.writeText(selection)
    term.clearSelection()
    return 'copy'
  }

  const text = await clipboard.readText()
  if (!text) return 'noop'

  term.paste(text)
  return 'paste'
}
