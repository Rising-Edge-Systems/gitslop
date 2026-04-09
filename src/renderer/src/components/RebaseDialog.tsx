import React, { useState, useCallback, useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import styles from './RebaseDialog.module.css'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  hash: string
}

interface RebaseDialogProps {
  currentRepo: string
  /** Pre-selected branch to rebase onto (from sidebar context menu) */
  preselectedBranch?: string | null
  onClose: () => void
  onRebaseComplete: () => void
}

type RebaseAction = 'pick' | 'squash' | 'edit' | 'drop' | 'reword' | 'fixup'

interface CommitAction {
  hash: string
  subject: string
  action: RebaseAction
}

interface RebaseState {
  selectedBranch: string
  loading: boolean
  error: string | null
  preview: {
    commitCount: number
    commits: { hash: string; subject: string }[]
    isPublished: boolean
  } | null
  loadingPreview: boolean
  // Interactive rebase
  interactive: boolean
  commitActions: CommitAction[]
  // In-progress rebase state
  rebasing: boolean
  conflicts: string[] | null
  progress: { current: number; total: number } | null
}

// ─── RebaseDialog ─────────────────────────────────────────────────────────────

export function RebaseDialog({
  currentRepo,
  preselectedBranch,
  onClose,
  onRebaseComplete
}: RebaseDialogProps): React.JSX.Element {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [state, setState] = useState<RebaseState>({
    selectedBranch: preselectedBranch || '',
    loading: false,
    error: null,
    preview: null,
    loadingPreview: false,
    interactive: false,
    commitActions: [],
    rebasing: false,
    conflicts: null,
    progress: null
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

      // Check if already rebasing
      const rebaseResult = await window.electronAPI.git.isRebasing(currentRepo)
      if (rebaseResult.success && rebaseResult.data) {
        const conflictResult = await window.electronAPI.git.getConflictedFiles(currentRepo)
        const progressResult = await window.electronAPI.git.rebaseProgress(currentRepo)
        setState((prev) => ({
          ...prev,
          rebasing: true,
          conflicts: conflictResult.success ? conflictResult.data : [],
          progress: progressResult.success ? progressResult.data : null
        }))
      }
    }
    load()
  }, [currentRepo])

  // Load rebase preview when branch is selected
  useEffect(() => {
    if (!state.selectedBranch || state.rebasing) return

    let cancelled = false
    setState((prev) => ({ ...prev, loadingPreview: true, preview: null, commitActions: [] }))

    const loadPreview = async (): Promise<void> => {
      const result = await window.electronAPI.git.rebasePreview(currentRepo, state.selectedBranch)
      if (cancelled) return
      if (result.success && result.data) {
        const preview = result.data as {
          commitCount: number
          commits: { hash: string; subject: string }[]
          isPublished: boolean
        }
        setState((prev) => ({
          ...prev,
          loadingPreview: false,
          preview,
          commitActions: preview.commits.map((c) => ({
            hash: c.hash,
            subject: c.subject,
            action: 'pick' as RebaseAction
          }))
        }))
      } else {
        setState((prev) => ({ ...prev, loadingPreview: false }))
      }
    }
    loadPreview()

    return (): void => {
      cancelled = true
    }
  }, [currentRepo, state.selectedBranch, state.rebasing])

  // Handle standard rebase
  const handleRebase = useCallback(async () => {
    if (!state.selectedBranch) return

    setState((prev) => ({ ...prev, loading: true, error: null }))

    let result

    if (state.interactive) {
      // Use interactive rebase with custom actions
      result = await window.electronAPI.git.rebaseInteractive(
        currentRepo,
        state.selectedBranch,
        state.commitActions.map((ca) => ({ hash: ca.hash, action: ca.action }))
      )
    } else {
      // Standard rebase
      result = await window.electronAPI.git.rebase(currentRepo, state.selectedBranch)
    }

    if (result.success) {
      const rebaseData = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (rebaseData.success) {
        // Clean rebase
        onRebaseComplete()
        onClose()
      } else {
        // Conflicts
        const progressResult = await window.electronAPI.git.rebaseProgress(currentRepo)
        setState((prev) => ({
          ...prev,
          loading: false,
          rebasing: true,
          conflicts: rebaseData.conflicts || [],
          error: rebaseData.message,
          progress: progressResult.success ? progressResult.data : null
        }))
      }
    } else {
      const errorMsg = result.error || 'Rebase failed'
      if (errorMsg.includes('CONFLICT') || errorMsg.includes('conflict')) {
        const conflictResult = await window.electronAPI.git.getConflictedFiles(currentRepo)
        const progressResult = await window.electronAPI.git.rebaseProgress(currentRepo)
        setState((prev) => ({
          ...prev,
          loading: false,
          rebasing: true,
          conflicts: conflictResult.success ? conflictResult.data : [],
          error: 'Rebase resulted in conflicts. Resolve conflicts and continue.',
          progress: progressResult.success ? progressResult.data : null
        }))
      } else {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: errorMsg
        }))
      }
    }
  }, [currentRepo, state.selectedBranch, state.interactive, state.commitActions, onClose, onRebaseComplete])

  // Handle rebase continue
  const handleContinue = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const result = await window.electronAPI.git.rebaseContinue(currentRepo)
    if (result.success) {
      const data = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (data.success) {
        onRebaseComplete()
        onClose()
      } else {
        const progressResult = await window.electronAPI.git.rebaseProgress(currentRepo)
        setState((prev) => ({
          ...prev,
          loading: false,
          conflicts: data.conflicts || [],
          error: data.message,
          progress: progressResult.success ? progressResult.data : null
        }))
      }
    } else {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: result.error || 'Failed to continue rebase'
      }))
    }
  }, [currentRepo, onClose, onRebaseComplete])

  // Handle rebase abort
  const handleAbort = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    const result = await window.electronAPI.git.rebaseAbort(currentRepo)
    if (result.success) {
      onRebaseComplete()
      onClose()
    } else {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: result.error || 'Failed to abort rebase'
      }))
    }
  }, [currentRepo, onClose, onRebaseComplete])

  // Handle rebase skip
  const handleSkip = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const result = await window.electronAPI.git.rebaseSkip(currentRepo)
    if (result.success) {
      const data = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (data.success) {
        onRebaseComplete()
        onClose()
      } else {
        const progressResult = await window.electronAPI.git.rebaseProgress(currentRepo)
        setState((prev) => ({
          ...prev,
          loading: false,
          conflicts: data.conflicts || [],
          error: data.message,
          progress: progressResult.success ? progressResult.data : null
        }))
      }
    } else {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: result.error || 'Failed to skip'
      }))
    }
  }, [currentRepo, onClose, onRebaseComplete])

  // Update commit action
  const setCommitAction = useCallback((hash: string, action: RebaseAction) => {
    setState((prev) => ({
      ...prev,
      commitActions: prev.commitActions.map((ca) =>
        ca.hash === hash ? { ...ca, action } : ca
      )
    }))
  }, [])

  const availableBranches = branches.filter((b) => !b.current)

  return (
    <div className="branch-dialog-overlay" onClick={onClose}>
      <div className={`branch-dialog ${styles.rebaseDialog}`} onClick={(e) => e.stopPropagation()}>
        <div className="branch-dialog-title">
          {state.rebasing ? <><AlertTriangle size={16} /> Rebase in Progress</> : 'Rebase Branch'}
        </div>

        {/* In-progress rebase state */}
        {state.rebasing && (
          <div className={styles.rebaseConflictSection}>
            <p className={styles.rebaseConflictInfo}>
              A rebase is in progress on <strong>{currentBranch}</strong>.
              {state.progress && (
                <span className={styles.rebaseProgressIndicator}>
                  {' '}Step {state.progress.current} of {state.progress.total}
                </span>
              )}
            </p>

            {state.conflicts && state.conflicts.length > 0 && (
              <div className={styles.rebaseConflictFiles}>
                <div className={styles.rebaseConflictFilesHeader}>Conflicted Files:</div>
                <ul className={styles.rebaseConflictFileList}>
                  {state.conflicts.map((file) => (
                    <li key={file} className={styles.rebaseConflictFileItem}>
                      <span className={styles.rebaseConflictFileIcon}>!</span>
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.error && (
              <div className="branch-dialog-error">{state.error}</div>
            )}

            <p className={styles.rebaseConflictHint}>
              Resolve conflicts in each file, stage the resolved files, then continue the rebase.
            </p>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-danger"
                onClick={handleAbort}
                disabled={state.loading}
              >
                {state.loading ? 'Aborting...' : 'Abort Rebase'}
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={handleSkip}
                disabled={state.loading}
              >
                Skip
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleContinue}
                disabled={state.loading}
              >
                {state.loading ? 'Continuing...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {/* Normal rebase dialog */}
        {!state.rebasing && (
          <>
            <p className={styles.rebaseDialogDesc}>
              Rebase <strong>{currentBranch}</strong> onto:
            </p>

            {state.error && (
              <div className="branch-dialog-error">{state.error}</div>
            )}

            <label className="branch-dialog-label">
              Target branch
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

            {/* Published commits warning */}
            {state.preview?.isPublished && state.preview.commitCount > 0 && (
              <div className={styles.rebasePublishedWarning}>
                <span className={styles.rebasePublishedWarningIcon}><AlertTriangle size={16} /></span>
                <span>
                  <strong>Warning:</strong> You are rebasing commits that have been pushed to a remote.
                  This will rewrite history and may cause issues for collaborators.
                </span>
              </div>
            )}

            {/* Rebase preview */}
            {state.selectedBranch && (
              <div className={styles.rebasePreview}>
                {state.loadingPreview ? (
                  <span className={styles.rebasePreviewLoading}>Analyzing rebase...</span>
                ) : state.preview ? (
                  <div className={styles.rebasePreviewInfo}>
                    <span className={styles.rebasePreviewCount}>
                      {state.preview.commitCount === 0
                        ? 'Already up to date — nothing to rebase'
                        : `${state.preview.commitCount} commit${state.preview.commitCount !== 1 ? 's' : ''} will be replayed`}
                    </span>
                  </div>
                ) : null}
              </div>
            )}

            {/* Interactive toggle */}
            {state.preview && state.preview.commitCount > 0 && (
              <label className={styles.rebaseInteractiveToggle}>
                <input
                  type="checkbox"
                  checked={state.interactive}
                  onChange={(e) =>
                    setState((prev) => ({ ...prev, interactive: e.target.checked }))
                  }
                />
                Interactive rebase
              </label>
            )}

            {/* Interactive rebase commit list */}
            {state.interactive && state.commitActions.length > 0 && (
              <div className={styles.rebaseInteractiveCommits}>
                <div className={styles.rebaseInteractiveHeader}>
                  <span>Action</span>
                  <span>Hash</span>
                  <span>Message</span>
                </div>
                {state.commitActions.map((ca) => (
                  <div key={ca.hash} className={styles.rebaseInteractiveRow}>
                    <select
                      className={styles.rebaseInteractiveActionSelect}
                      value={ca.action}
                      onChange={(e) => setCommitAction(ca.hash, e.target.value as RebaseAction)}
                    >
                      <option value="pick">pick</option>
                      <option value="reword">reword</option>
                      <option value="squash">squash</option>
                      <option value="fixup">fixup</option>
                      <option value="edit">edit</option>
                      <option value="drop">drop</option>
                    </select>
                    <span className={styles.rebaseInteractiveHash}>{ca.hash.substring(0, 7)}</span>
                    <span className={styles.rebaseInteractiveMessage}>{ca.subject}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleRebase}
                disabled={
                  state.loading ||
                  !state.selectedBranch ||
                  (state.preview?.commitCount === 0 && !state.loadingPreview)
                }
              >
                {state.loading ? 'Rebasing...' : 'Rebase'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
