import React, { useState, useCallback, useEffect } from 'react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  hash: string
}

interface MergeDialogProps {
  currentRepo: string
  /** Pre-selected branch to merge (from sidebar context menu) */
  preselectedBranch?: string | null
  onClose: () => void
  onMergeComplete: () => void
}

type MergeStrategy = 'auto' | 'no-ff' | 'ff-only'

interface MergeState {
  selectedBranch: string
  strategy: MergeStrategy
  loading: boolean
  error: string | null
  preview: { commitCount: number; fastForward: boolean } | null
  loadingPreview: boolean
  // Conflict state
  conflicts: string[] | null
  merging: boolean
}

// ─── MergeDialog ─────────────────────────────────────────────────────────────

export function MergeDialog({
  currentRepo,
  preselectedBranch,
  onClose,
  onMergeComplete
}: MergeDialogProps): React.JSX.Element {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [state, setState] = useState<MergeState>({
    selectedBranch: preselectedBranch || '',
    strategy: 'auto',
    loading: false,
    error: null,
    preview: null,
    loadingPreview: false,
    conflicts: null,
    merging: false
  })

  // Load branches on mount
  useEffect(() => {
    const load = async (): Promise<void> => {
      const result = await window.electronAPI.git.getBranches(currentRepo)
      if (result.success && result.data) {
        const branchList = result.data as GitBranch[]
        setBranches(branchList)
        const current = branchList.find((b) => b.current)
        if (current) setCurrentBranch(current.name)
      }

      // Check if already merging
      const mergeResult = await window.electronAPI.git.isMerging(currentRepo)
      if (mergeResult.success && mergeResult.data) {
        const conflictResult = await window.electronAPI.git.getConflictedFiles(currentRepo)
        setState((prev) => ({
          ...prev,
          merging: true,
          conflicts: conflictResult.success ? conflictResult.data : []
        }))
      }
    }
    load()
  }, [currentRepo])

  // Load merge preview when branch is selected
  useEffect(() => {
    if (!state.selectedBranch || state.merging) return

    let cancelled = false
    setState((prev) => ({ ...prev, loadingPreview: true, preview: null }))

    const loadPreview = async (): Promise<void> => {
      const result = await window.electronAPI.git.mergePreview(currentRepo, state.selectedBranch)
      if (cancelled) return
      if (result.success && result.data) {
        setState((prev) => ({
          ...prev,
          loadingPreview: false,
          preview: result.data
        }))
      } else {
        setState((prev) => ({ ...prev, loadingPreview: false }))
      }
    }
    loadPreview()

    return (): void => {
      cancelled = true
    }
  }, [currentRepo, state.selectedBranch, state.merging])

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!state.selectedBranch) return

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const opts: { noFastForward?: boolean; fastForwardOnly?: boolean } = {}
    if (state.strategy === 'no-ff') opts.noFastForward = true
    if (state.strategy === 'ff-only') opts.fastForwardOnly = true

    const result = await window.electronAPI.git.merge(
      currentRepo,
      state.selectedBranch,
      opts
    )

    if (result.success) {
      const mergeData = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (mergeData.success) {
        // Clean merge
        onMergeComplete()
        onClose()
      } else {
        // Conflicts
        setState((prev) => ({
          ...prev,
          loading: false,
          merging: true,
          conflicts: mergeData.conflicts || [],
          error: mergeData.message
        }))
      }
    } else {
      // Check if it's a conflict error from the IPC layer
      const errorMsg = result.error || 'Merge failed'
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict')) {
        const conflictResult = await window.electronAPI.git.getConflictedFiles(currentRepo)
        setState((prev) => ({
          ...prev,
          loading: false,
          merging: true,
          conflicts: conflictResult.success ? conflictResult.data : [],
          error: 'Merge resulted in conflicts. Resolve conflicts and commit to complete the merge.'
        }))
      } else {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMsg
        }))
      }
    }
  }, [currentRepo, state.selectedBranch, state.strategy, onClose, onMergeComplete])

  // Handle merge abort
  const handleAbort = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    const result = await window.electronAPI.git.mergeAbort(currentRepo)
    if (result.success) {
      onMergeComplete()
      onClose()
    } else {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: result.error || 'Failed to abort merge'
      }))
    }
  }, [currentRepo, onClose, onMergeComplete])

  const availableBranches = branches.filter((b) => !b.current)

  return (
    <div className="branch-dialog-overlay" onClick={onClose}>
      <div className="branch-dialog merge-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="branch-dialog-title">
          {state.merging ? '⚠ Merge in Progress' : 'Merge Branch'}
        </div>

        {/* In-progress merge state */}
        {state.merging && (
          <div className="merge-conflict-section">
            <p className="merge-conflict-info">
              A merge is in progress on <strong>{currentBranch}</strong>.
              {state.conflicts && state.conflicts.length > 0 && (
                <> There {state.conflicts.length === 1 ? 'is' : 'are'}{' '}
                  <strong>{state.conflicts.length}</strong> conflicted file{state.conflicts.length !== 1 ? 's' : ''}.</>
              )}
            </p>

            {state.conflicts && state.conflicts.length > 0 && (
              <div className="merge-conflict-files">
                <div className="merge-conflict-files-header">Conflicted Files:</div>
                <ul className="merge-conflict-file-list">
                  {state.conflicts.map((file) => (
                    <li key={file} className="merge-conflict-file-item">
                      <span className="merge-conflict-file-icon">!</span>
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.error && (
              <div className="branch-dialog-error">{state.error}</div>
            )}

            <p className="merge-conflict-hint">
              Resolve conflicts in each file, stage the resolved files, then commit to complete the merge.
            </p>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-danger"
                onClick={handleAbort}
                disabled={state.loading}
              >
                {state.loading ? 'Aborting...' : 'Abort Merge'}
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={onClose}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* Normal merge dialog */}
        {!state.merging && (
          <>
            <p className="merge-dialog-desc">
              Merge into <strong>{currentBranch}</strong>
            </p>

            {state.error && (
              <div className="branch-dialog-error">{state.error}</div>
            )}

            <label className="branch-dialog-label">
              Branch to merge
              <select
                className="branch-dialog-input"
                value={state.selectedBranch}
                onChange={(e) =>
                  setState((prev) => ({
                    ...prev,
                    selectedBranch: e.target.value,
                    error: null
                  }))
                }
                autoFocus={!preselectedBranch}
              >
                <option value="">Select a branch...</option>
                {availableBranches.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Merge preview */}
            {state.selectedBranch && (
              <div className="merge-preview">
                {state.loadingPreview ? (
                  <span className="merge-preview-loading">Analyzing merge...</span>
                ) : state.preview ? (
                  <div className="merge-preview-info">
                    <span className="merge-preview-count">
                      {state.preview.commitCount === 0
                        ? 'Already up to date — nothing to merge'
                        : `${state.preview.commitCount} commit${state.preview.commitCount !== 1 ? 's' : ''} will be merged`}
                    </span>
                    {state.preview.fastForward && state.preview.commitCount > 0 && (
                      <span className="merge-preview-ff">Fast-forward possible</span>
                    )}
                  </div>
                ) : null}
              </div>
            )}

            {/* Merge strategy */}
            <div className="merge-strategy-options">
              <div className="merge-strategy-title">Strategy:</div>
              <label className="merge-strategy-option">
                <input
                  type="radio"
                  name="mergeStrategy"
                  checked={state.strategy === 'auto'}
                  onChange={() => setState((prev) => ({ ...prev, strategy: 'auto' }))}
                />
                <div>
                  <strong>Auto</strong>
                  <span className="merge-strategy-desc">Fast-forward if possible, otherwise create a merge commit</span>
                </div>
              </label>
              <label className="merge-strategy-option">
                <input
                  type="radio"
                  name="mergeStrategy"
                  checked={state.strategy === 'no-ff'}
                  onChange={() => setState((prev) => ({ ...prev, strategy: 'no-ff' }))}
                />
                <div>
                  <strong>No fast-forward</strong>
                  <span className="merge-strategy-desc">Always create a merge commit</span>
                </div>
              </label>
              <label className="merge-strategy-option">
                <input
                  type="radio"
                  name="mergeStrategy"
                  checked={state.strategy === 'ff-only'}
                  onChange={() => setState((prev) => ({ ...prev, strategy: 'ff-only' }))}
                />
                <div>
                  <strong>Fast-forward only</strong>
                  <span className="merge-strategy-desc">Fail if fast-forward is not possible</span>
                </div>
              </label>
            </div>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleMerge}
                disabled={
                  state.loading ||
                  !state.selectedBranch ||
                  (state.preview?.commitCount === 0 && !state.loadingPreview)
                }
              >
                {state.loading ? 'Merging...' : 'Merge'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
