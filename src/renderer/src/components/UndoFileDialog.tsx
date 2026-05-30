import React, { useState, useCallback } from 'react'
import { X } from 'lucide-react'
import styles from './FileActionDialog.module.css'

export type UndoMode = 'reverse' | 'reset'

interface UndoFileDialogProps {
  fileName: string
  shortHash: string
  onChoose: (mode: UndoMode) => void
  onCancel: () => void
}

const MODES: { value: UndoMode; title: string; description: string }[] = [
  {
    value: 'reverse',
    title: 'Reverse just this commit’s change',
    description:
      'Undo only the change this commit made to the file, keeping any later edits to it. If a later commit touched the same lines you’ll get conflict markers to resolve. If this commit added the file, it’s removed.'
  },
  {
    value: 'reset',
    title: 'Reset to the version before this commit',
    description:
      'Restore the file exactly as it was in this commit’s parent. Simpler, but if later commits also changed this file, those changes are undone too. If the file didn’t exist before, it’s removed.'
  }
]

/**
 * Lets the user pick how to undo a single file's change from a commit. The
 * result is always an uncommitted working-tree change — history is never
 * rewritten — which the user reviews and commits themselves.
 */
export function UndoFileDialog({
  fileName,
  shortHash,
  onChoose,
  onCancel
}: UndoFileDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<UndoMode>('reverse')

  const handleConfirm = useCallback(() => onChoose(mode), [mode, onChoose])

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Undo file from commit</h3>
          <button className={styles.closeBtn} onClick={onCancel} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.intro}>
            Undo the change to <code>{fileName}</code> from commit <code>{shortHash}</code>.
            This leaves an uncommitted change in your working tree to review and commit — it
            does not rewrite history.
          </div>

          <div className={styles.modes}>
            {MODES.map((m) => (
              <label
                key={m.value}
                className={[styles.mode, mode === m.value ? styles.modeSelected : ''].join(' ')}
              >
                <input
                  type="radio"
                  name="undo-mode"
                  value={m.value}
                  checked={mode === m.value}
                  onChange={() => setMode(m.value)}
                />
                <div className={styles.modeContent}>
                  <div className={styles.modeTitle}>
                    {m.title}
                    {m.value === 'reverse' && <span className={styles.modeDefault}>(recommended)</span>}
                  </div>
                  <div className={styles.modeDescription}>{m.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onCancel}>Cancel</button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleConfirm}>Undo</button>
        </div>
      </div>
    </div>
  )
}
