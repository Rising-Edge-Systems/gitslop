import React, { useState, useCallback } from 'react'

interface StashDialogState {
  open: boolean
  message: string
  includeUntracked: boolean
  loading: boolean
  error: string | null
}

interface ToolbarProps {
  currentRepo: string | null
}

export function Toolbar({ currentRepo }: ToolbarProps): React.JSX.Element {
  const [stashDialog, setStashDialog] = useState<StashDialogState>({
    open: false,
    message: '',
    includeUntracked: false,
    loading: false,
    error: null
  })

  const openStashDialog = useCallback(() => {
    if (!currentRepo) return
    setStashDialog({
      open: true,
      message: '',
      includeUntracked: false,
      loading: false,
      error: null
    })
  }, [currentRepo])

  const closeStashDialog = useCallback(() => {
    setStashDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const handleStashSave = useCallback(async () => {
    if (!currentRepo) return
    setStashDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.git.stashSave(currentRepo, {
        message: stashDialog.message || undefined,
        includeUntracked: stashDialog.includeUntracked
      })
      if (result.success) {
        closeStashDialog()
      } else {
        setStashDialog((prev) => ({
          ...prev,
          loading: false,
          error: result.error || 'Failed to stash'
        }))
      }
    } catch {
      setStashDialog((prev) => ({ ...prev, loading: false, error: 'Failed to stash' }))
    }
  }, [currentRepo, stashDialog.message, stashDialog.includeUntracked, closeStashDialog])

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Pull (Ctrl+Shift+L)">
          <span className="toolbar-btn-icon">⬇</span>
          <span className="toolbar-btn-label">Pull</span>
        </button>
        <button className="toolbar-btn" title="Push (Ctrl+Shift+P)">
          <span className="toolbar-btn-icon">⬆</span>
          <span className="toolbar-btn-label">Push</span>
        </button>
        <button className="toolbar-btn" title="Fetch (Ctrl+Shift+F)">
          <span className="toolbar-btn-icon">⟳</span>
          <span className="toolbar-btn-label">Fetch</span>
        </button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Branch">
          <span className="toolbar-btn-icon">⑂</span>
          <span className="toolbar-btn-label">Branch</span>
        </button>
        <button className="toolbar-btn" title="Merge">
          <span className="toolbar-btn-icon">⤞</span>
          <span className="toolbar-btn-label">Merge</span>
        </button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Stash" onClick={openStashDialog}>
          <span className="toolbar-btn-icon">📦</span>
          <span className="toolbar-btn-label">Stash</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Settings (Ctrl+,)">
          <span className="toolbar-btn-icon">⚙</span>
        </button>
      </div>

      {/* Stash Dialog from Toolbar */}
      {stashDialog.open && (
        <div className="branch-dialog-overlay" onClick={closeStashDialog}>
          <div className="branch-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="branch-dialog-title">Stash Changes</div>

            {stashDialog.error && (
              <div className="branch-dialog-error">{stashDialog.error}</div>
            )}

            <label className="branch-dialog-label">
              Message (optional)
              <input
                className="branch-dialog-input"
                type="text"
                value={stashDialog.message}
                onChange={(e) =>
                  setStashDialog((prev) => ({ ...prev, message: e.target.value }))
                }
                placeholder="Stash message..."
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !stashDialog.loading) handleStashSave()
                  if (e.key === 'Escape') closeStashDialog()
                }}
              />
            </label>

            <label className="stash-dialog-checkbox">
              <input
                type="checkbox"
                checked={stashDialog.includeUntracked}
                onChange={(e) =>
                  setStashDialog((prev) => ({ ...prev, includeUntracked: e.target.checked }))
                }
              />
              Include untracked files
            </label>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={closeStashDialog}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleStashSave}
                disabled={stashDialog.loading}
              >
                {stashDialog.loading ? 'Stashing...' : 'Stash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
