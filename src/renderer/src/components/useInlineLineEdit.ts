import { useCallback, useState } from 'react'
import { applyLineEdits } from '../utils/applyLineEdits'
import { EditableTarget, nextEditable, prevEditable, extendSelection } from '../utils/inlineEditNav'

function bufferForRange(anchor: number, focus: number, lineText: Map<number, string>): string {
  const lo = Math.min(anchor, focus)
  const hi = Math.max(anchor, focus)
  const out: string[] = []
  for (let ln = lo; ln <= hi; ln++) out.push(lineText.get(ln) ?? '')
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

export function useInlineLineEdit({ absPath, targets, lineText, onSaved }: UseInlineLineEditArgs): UseInlineLineEdit {
  const [editing, setEditing] = useState<InlineEditState | null>(null)
  const [buffer, setBuffer] = useState('')

  const enter = useCallback((fileLine: number) => {
    setEditing({ anchorLine: fileLine, focusLine: fileLine })
    setBuffer(lineText.get(fileLine) ?? '')
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
    const next = applyLineEdits(read.data, [{ startLine: start, endLine: end, text: buffer }])
    const write = await window.electronAPI.file.write(absPath, next)
    setEditing(null)
    setBuffer('')
    if (write.success) onSaved()
  }, [editing, buffer, absPath, onSaved])

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
  }, [editing, targets, lineText])

  const extendUp = useCallback(() => {
    if (!editing) return
    const ext = extendSelection(editing.anchorLine, editing.focusLine, 'up', targets)
    if (!ext) return
    setEditing({ anchorLine: ext.anchorFileLine, focusLine: ext.focusFileLine })
    setBuffer(bufferForRange(ext.anchorFileLine, ext.focusFileLine, lineText))
  }, [editing, targets, lineText])

  return { editing, buffer, setBuffer, enter, cancel, commit, moveUp, moveDown, extendUp, extendDown }
}
