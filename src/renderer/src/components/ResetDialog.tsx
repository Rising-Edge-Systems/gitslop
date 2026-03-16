import React, { useState, useCallback } from 'react'

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
    <div className="reset-dialog-overlay" onClick={onClose}>
      <div className="reset-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="reset-dialog-header">
          <h3>Reset Current Branch</h3>
          <button className="reset-dialog-close" onClick={onClose} title="Close">&#x2715;</button>
        </div>

        <div className="reset-dialog-body">
          {/* Target commit info */}
          <div className="reset-dialog-target">
            <span className="reset-dialog-target-label">Reset to:</span>
            <code className="reset-dialog-target-hash">{targetHash.substring(0, 7)}</code>
            <span className="reset-dialog-target-subject">{targetSubject}</span>
          </div>

          {/* Mode selection */}
          <div className="reset-dialog-modes">
            {(['soft', 'mixed', 'hard'] as ResetMode[]).map((m) => {
              const info = MODE_DESCRIPTIONS[m]
              return (
                <label
                  key={m}
                  className={`reset-dialog-mode${mode === m ? ' reset-dialog-mode-selected' : ''}${m === 'hard' ? ' reset-dialog-mode-hard' : ''}`}
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
                  <div className="reset-dialog-mode-content">
                    <div className="reset-dialog-mode-title">
                      {info.title}
                      {m === 'mixed' && <span className="reset-dialog-mode-default">(default)</span>}
                    </div>
                    <div className="reset-dialog-mode-description">{info.description}</div>
                    {info.warning && (
                      <div className="reset-dialog-mode-warning">&#x26A0; {info.warning}</div>
                    )}
                  </div>
                </label>
              )
            })}
          </div>

          {/* Hard reset confirmation */}
          {mode === 'hard' && (
            <div className="reset-dialog-hard-confirm">
              <label className="reset-dialog-hard-confirm-label">
                Type <strong>HARD</strong> to confirm destructive reset:
              </label>
              <input
                type="text"
                className="reset-dialog-hard-confirm-input"
                value={hardConfirmation}
                onChange={(e) => setHardConfirmation(e.target.value)}
                placeholder="Type HARD to confirm"
                autoFocus
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="reset-dialog-error">&#x26A0; {error}</div>
          )}

          {/* Success */}
          {success && (
            <div className="reset-dialog-success">
              &#x2714; Reset ({mode}) to {targetHash.substring(0, 7)} successful!
            </div>
          )}
        </div>

        <div className="reset-dialog-footer">
          <button className="reset-dialog-btn reset-dialog-btn-cancel" onClick={onClose} disabled={isResetting}>
            Cancel
          </button>
          <button
            className={`reset-dialog-btn reset-dialog-btn-reset${mode === 'hard' ? ' reset-dialog-btn-hard' : ''}`}
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
