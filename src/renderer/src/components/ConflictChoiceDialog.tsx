import React, { useState, useCallback } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import styles from './FileActionDialog.module.css'

export type ConflictChoice = 'overwrite' | 'stash'

interface ConflictChoiceDialogProps {
  /** Human-readable description of what's being changed, e.g. a file name or "3 files". */
  targetLabel: string
  /** Verb describing the pending operation, e.g. "apply" or "undo". */
  actionVerb?: string
  onChoose: (choice: ConflictChoice) => void
  onCancel: () => void
}

const CHOICES: { value: ConflictChoice; title: string; description: string }[] = [
  {
    value: 'stash',
    title: 'Stash my changes first',
    description:
      'Set your uncommitted edits to these file(s) aside in a stash, then proceed. Your other changes are untouched, and you can pop the stash later to get these edits back.'
  },
  {
    value: 'overwrite',
    title: 'Overwrite my changes',
    description: 'Discard your uncommitted edits to these file(s) and replace them with the result.'
  }
]

/**
 * Shown before an overwrite-style operation when the target file(s) already
 * have uncommitted edits, so the user explicitly decides whether to preserve
 * (stash) or discard (overwrite) them rather than losing work silently.
 */
export function ConflictChoiceDialog({
  targetLabel,
  actionVerb = 'apply',
  onChoose,
  onCancel
}: ConflictChoiceDialogProps): React.JSX.Element {
  const [choice, setChoice] = useState<ConflictChoice>('stash')

  const handleConfirm = useCallback(() => onChoose(choice), [choice, onChoose])

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Uncommitted changes</h3>
          <button className={styles.closeBtn} onClick={onCancel} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          <div className={styles.intro}>
            <AlertTriangle size={14} /> You have uncommitted edits to <code>{targetLabel}</code>.
            Choosing to {actionVerb} will modify {targetLabel.includes(' ') ? 'these files' : 'this file'}.
            How should your current edits be handled?
          </div>

          <div className={styles.modes}>
            {CHOICES.map((c) => (
              <label
                key={c.value}
                className={[styles.mode, choice === c.value ? styles.modeSelected : ''].join(' ')}
              >
                <input
                  type="radio"
                  name="conflict-choice"
                  value={c.value}
                  checked={choice === c.value}
                  onChange={() => setChoice(c.value)}
                />
                <div className={styles.modeContent}>
                  <div className={styles.modeTitle}>
                    {c.title}
                    {c.value === 'stash' && <span className={styles.modeDefault}>(recommended)</span>}
                  </div>
                  <div className={styles.modeDescription}>{c.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onCancel}>Cancel</button>
          <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handleConfirm}>Continue</button>
        </div>
      </div>
    </div>
  )
}
