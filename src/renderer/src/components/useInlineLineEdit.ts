import { useCallback, useRef, useState } from 'react'
import { applyLineEdits } from '../utils/applyLineEdits'
import { EditableTarget, nextEditable, prevEditable, extendSelection } from '../utils/inlineEditNav'

function bufferForRange(anchor: number, focus: number, lineText: Map<number, string>): string {
  const lo = Math.min(anchor, focus)
  const hi = Math.max(anchor, focus)
  const out: string[] = []
  for (let ln = lo; ln <= hi; ln++) out.push(lineText.get(ln) ?? '')
  return out.join('\n')
}

/**
 * Extract the text of disk lines [startLine..endLine] (1-based inclusive) from
 * freshly-read file content, normalized into '\n' space (trailing '\r'
 * stripped) so it compares apples-to-apples with the diff-seeded span text.
 */
function spanTextFromContent(content: string, startLine: number, endLine: number): string {
  const lines = content.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l))
  const out: string[] = []
  for (let ln = startLine; ln <= endLine; ln++) out.push(lines[ln - 1] ?? '')
  return out.join('\n')
}

export interface InlineEditState {
  anchorLine: number
  focusLine: number
}

export interface UseInlineLineEditArgs {
  /** Absolute path of the working-tree file to write on commit. */
  absPath: string
  /** Editable targets in display order (from buildEditableTargets). */
  targets: EditableTarget[]
  /** fileLine -> current on-screen text of that line. */
  lineText: Map<number, string>
  /** Fired after a successful write; caller refreshes the diff. */
  onSaved: () => void
  /**
   * Fired when an open edit is aborted because the file changed on disk
   * underneath it (external editor / AI edit); caller refreshes the diff to the
   * new content. Defaults to onSaved when not provided.
   */
  onConflict?: () => void
}

export interface UseInlineLineEdit {
  editing: InlineEditState | null
  buffer: string
  setBuffer: (text: string) => void
  enter: (fileLine: number) => void
  cancel: () => void
  commit: () => Promise<void>
  moveUp: () => Promise<void>
  moveDown: () => Promise<void>
  extendUp: () => void
  extendDown: () => void
}

export function useInlineLineEdit({ absPath, targets, lineText, onSaved, onConflict }: UseInlineLineEditArgs): UseInlineLineEdit {
  const [editing, setEditing] = useState<InlineEditState | null>(null)
  const [buffer, setBuffer] = useState('')
  // Snapshot of the unedited on-screen text for the currently-spanned lines at
  // the moment of enter/extend. commit() compares this against the fresh disk
  // read to detect an external change before overwriting the wrong lines.
  const originalSpanRef = useRef('')

  const enter = useCallback((fileLine: number) => {
    setEditing({ anchorLine: fileLine, focusLine: fileLine })
    setBuffer(lineText.get(fileLine) ?? '')
    originalSpanRef.current = lineText.get(fileLine) ?? ''
  }, [lineText])

  const cancel = useCallback(() => {
    setEditing(null)
    setBuffer('')
  }, [])

  const commit = useCallback(async () => {
    if (!editing) return
    const start = Math.min(editing.anchorLine, editing.focusLine)
    const end = Math.max(editing.anchorLine, editing.focusLine)
    const read = await window.electronAPI.file.read(absPath)
    if (!read.success || typeof read.data !== 'string') { setEditing(null); return }
    // Conflict guard: if the on-disk span text changed underneath the open edit
    // (external editor / AI edit), abort rather than overwrite the wrong lines.
    const diskSpan = spanTextFromContent(read.data, start, end)
    if (diskSpan !== originalSpanRef.current) {
      setEditing(null)
      setBuffer('')
      ;(onConflict ?? onSaved)()
      return
    }
    const next = applyLineEdits(read.data, [{ startLine: start, endLine: end, text: buffer }])
    const write = await window.electronAPI.file.write(absPath, next)
    setEditing(null)
    setBuffer('')
    if (write.success) onSaved()
  }, [editing, buffer, absPath, onSaved, onConflict])

  const moveDown = useCallback(async () => {
    if (!editing) return
    const t = nextEditable(editing.focusLine, targets)
    await commit()
    if (t) enter(t.fileLine)
  }, [editing, commit, targets, enter])

  const moveUp = useCallback(async () => {
    if (!editing) return
    const t = prevEditable(editing.focusLine, targets)
    await commit()
    if (t) enter(t.fileLine)
  }, [editing, commit, targets, enter])

  const extendDown = useCallback(() => {
    if (!editing) return
    const ext = extendSelection(editing.anchorLine, editing.focusLine, 'down', targets)
    if (!ext) return
    setEditing({ anchorLine: ext.anchorFileLine, focusLine: ext.focusFileLine })
    setBuffer(bufferForRange(ext.anchorFileLine, ext.focusFileLine, lineText))
    originalSpanRef.current = bufferForRange(ext.anchorFileLine, ext.focusFileLine, lineText)
  }, [editing, targets, lineText])

  const extendUp = useCallback(() => {
    if (!editing) return
    const ext = extendSelection(editing.anchorLine, editing.focusLine, 'up', targets)
    if (!ext) return
    setEditing({ anchorLine: ext.anchorFileLine, focusLine: ext.focusFileLine })
    setBuffer(bufferForRange(ext.anchorFileLine, ext.focusFileLine, lineText))
    originalSpanRef.current = bufferForRange(ext.anchorFileLine, ext.focusFileLine, lineText)
  }, [editing, targets, lineText])

  return { editing, buffer, setBuffer, enter, cancel, commit, moveUp, moveDown, extendUp, extendDown }
}
