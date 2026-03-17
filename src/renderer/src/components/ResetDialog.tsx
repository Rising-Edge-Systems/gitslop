import React, { useState, useCallback } from 'react'
import { X, AlertTriangle, Check } from 'lucide-react'
import styles from './ResetDialog.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type ResetMode = 'soft' | 'mixed' | 'hard'

interface ResetDialogProps {
  repoPath: string
  targetHash: string
  targetSubject: string
  onClose: () => void
  onResetComplete: () => void
}

const MODE_DESCRIPTIONS: Record<ResetMode, { title: string; description: string; warning?: string }> = {
  soft: {
    title: 'Soft',
    description: 'Moves HEAD to the target commit. All changes between HEAD and the target will be staged (ready to commit). No files are modified.'
  },
  mixed: {
    title: 'Mixed',
    description: 'Moves HEAD to the target commit. All changes between HEAD and the target will be unstaged (in your working directory). No files are modified. This is the default mode.'
  },
  hard: {
    title: 'Hard',
    description: 'Moves HEAD to the target commit and discards ALL changes. Your working directory and staging area will match the target commit exactly.',
    warning: 'This is destructive! All uncommitted changes and commits after the target will be permanently lost.'
  }
}

// ─── Reset Dialog Component ──────────────────────────────────────────────────

export function ResetDialog({
  repoPath,
  targetHash,
  targetSubject,
  onClose,
  onResetComplete
}: ResetDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [hardConfirmation, setHardConfirmation] = useState('')
  const [isResetting, setIsResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const canReset = mode !== 'hard' || hardConfirmation === 'HARD'

  const handleReset = useCallback(async () => {
    if (!canReset || isResetting) return

    setIsResetting(true)
    setError(null)

    try {
      const result = await window.electronAPI.git.reset(repoPath, targetHash, mode)
      if (result.success) {
        setSuccess(true)
        // Auto-close after brief delay
        setTimeout(() => {
          onResetComplete()
          onClose()
        }, 1200)
      } else {
        setError(result.error || 'Reset failed.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed.')
    } finally {
      setIsResetting(false)
    }
  }, [canReset, isResetting, repoPath, targetHash, mode, onResetComplete, onClose])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3>Reset Current Branch</h3>
          <button className={styles.closeBtn} onClick={onClose} title="Close"><X size={16} /></button>
        </div>

        <div className={styles.body}>
          {/* Target commit info */}
          <div className={styles.target}>
            <span className={styles.targetLabel}>Reset to:</span>
            <code className={styles.targetHash}>{targetHash.substring(0, 7)}</code>
            <span className={styles.targetSubject}>{targetSubject}</span>
          </div>

          {/* Mode selection */}
          <div className={styles.modes}>
            {(['soft', 'mixed', 'hard'] as ResetMode[]).map((m) => {
              const info = MODE_DESCRIPTIONS[m]
              return (
                <label
                  key={m}
                  className={[
                    styles.mode,
                    mode === m ? styles.modeSelected : '',
                    m === 'hard' ? styles.modeHard : ''
                  ].join(' ')}
                >
                  <input
                    type="radio"
                    name="reset-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => {
                      setMode(m)
                      setHardConfirmation('')
                    }}
                  />
                  <div className={styles.modeContent}>
                    <div className={styles.modeTitle}>
                      {info.title}
                      {m === 'mixed' && <span className={styles.modeDefault}>(default)</span>}
                    </div>
                    <div className={styles.modeDescription}>{info.description}</div>
                    {info.warning && (
                      <div className={styles.modeWarning}><AlertTriangle size={14} /> {info.warning}</div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>

          {/* Hard reset confirmation */}
          {mode === 'hard' && (
            <div className={styles.hardConfirm}>
              <label className={styles.hardConfirmLabel}>
                Type <strong>HARD</strong> to confirm destructive reset:
              </label>
              <input
                type="text"
                className={styles.hardConfirmInput}
                value={hardConfirmation}
                onChange={(e) => setHardConfirmation(e.target.value)}
                placeholder="Type HARD to confirm"
                autoFocus
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className={styles.errorMsg}><AlertTriangle size={14} /> {error}</div>
          )}

          {/* Success */}
          {success && (
            <div className={styles.successMsg}>
              <Check size={14} /> Reset ({mode}) to {targetHash.substring(0, 7)} successful!
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <button className={`${styles.btn} ${styles.btnCancel}`} onClick={onClose} disabled={isResetting}>
            Cancel
          </button>
          <button
            className={[styles.btn, styles.btnReset, mode === 'hard' ? styles.btnHard : ''].join(' ')}
            onClick={handleReset}
            disabled={!canReset || isResetting || success}
          >
            {isResetting ? 'Resetting...' : `Reset (${MODE_DESCRIPTIONS[mode].title})`}
          </button>
        </div>
      </div>
    </div>
  )
}
