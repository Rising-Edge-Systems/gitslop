import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  AlertTriangle,
  Search,
  X,
  CheckCircle2,
  RotateCcw,
  GripVertical
} from 'lucide-react'
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
  /** Pre-selected branch to rebase onto (from sidebar or context menu) */
  preselectedBranch?: string | null
  /** If true, open directly in interactive mode */
  startInteractive?: boolean
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
  success: boolean
  preview: {
    commitCount: number
    commits: { hash: string; subject: string }[]
    isPublished: boolean
  } | null
  loadingPreview: boolean
  interactive: boolean
  commitActions: CommitAction[]
  rebasing: boolean
  conflicts: string[] | null
  progress: { current: number; total: number } | null
}

const ACTION_LABELS: Record<RebaseAction, { label: string; color: string }> = {
  pick: { label: 'pick', color: 'var(--accent)' },
  reword: { label: 'reword', color: '#eab308' },
  squash: { label: 'squash', color: '#a855f7' },
  fixup: { label: 'fixup', color: '#ec4899' },
  edit: { label: 'edit', color: '#22c55e' },
  drop: { label: 'drop', color: 'var(--error)' }
}

// ─── RebaseDialog ─────────────────────────────────────────────────────────────

export function RebaseDialog({
  currentRepo,
  preselectedBranch,
  startInteractive,
  onClose,
  onRebaseComplete
}: RebaseDialogProps): React.JSX.Element {
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Drag state
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)

  const [state, setState] = useState<RebaseState>({
    selectedBranch: preselectedBranch || '',
    loading: false,
    error: null,
    success: false,
    preview: null,
    loadingPreview: false,
    interactive: startInteractive || false,
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

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Handle standard or interactive rebase
  const handleRebase = useCallback(async () => {
    if (!state.selectedBranch) return
    setState((prev) => ({ ...prev, loading: true, error: null }))

    let result
    if (state.interactive) {
      result = await window.electronAPI.git.rebaseInteractive(
        currentRepo,
        state.selectedBranch,
        state.commitActions.map((ca) => ({ hash: ca.hash, action: ca.action }))
      )
    } else {
      result = await window.electronAPI.git.rebase(currentRepo, state.selectedBranch)
    }

    if (result.success) {
      const rebaseData = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (rebaseData.success) {
        setState((prev) => ({ ...prev, loading: false, success: true }))
        setTimeout(() => {
          onRebaseComplete()
          onClose()
        }, 1200)
      } else {
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
        setState((prev) => ({ ...prev, loading: false, error: errorMsg }))
      }
    }
  }, [currentRepo, state.selectedBranch, state.interactive, state.commitActions, onClose, onRebaseComplete])

  // Continue rebase
  const handleContinue = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const result = await window.electronAPI.git.rebaseContinue(currentRepo)
    if (result.success) {
      const data = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (data.success) {
        setState((prev) => ({ ...prev, loading: false, success: true }))
        setTimeout(() => {
          onRebaseComplete()
          onClose()
        }, 1200)
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

  // Abort rebase
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

  // Skip commit
  const handleSkip = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const result = await window.electronAPI.git.rebaseSkip(currentRepo)
    if (result.success) {
      const data = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (data.success) {
        setState((prev) => ({ ...prev, loading: false, success: true }))
        setTimeout(() => {
          onRebaseComplete()
          onClose()
        }, 1200)
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

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((index: number) => {
    setDragIndex(index)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      setState((prev) => {
        const newActions = [...prev.commitActions]
        const [removed] = newActions.splice(dragIndex, 1)
        newActions.splice(dragOverIndex, 0, removed)
        return { ...prev, commitActions: newActions }
      })
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, dragOverIndex])

  // Select branch
  const handleSelectBranch = useCallback((branchName: string) => {
    setState((prev) => ({ ...prev, selectedBranch: branchName, error: null }))
    setDropdownOpen(false)
    setSearchQuery('')
  }, [])

  // Clear selected branch
  const handleClearBranch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      selectedBranch: '',
      preview: null,
      commitActions: [],
      error: null
    }))
  }, [])

  const availableBranches = branches.filter((b) => !b.current)
  const filteredBranches = availableBranches.filter((b) =>
    b.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // ─── Success State ──────────────────────────────────────────────────────────

  if (state.success) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.success}>
            <CheckCircle2 size={48} className={styles.successIcon} />
            <div className={styles.successText}>Rebase Complete</div>
            <div className={styles.successSub}>
              Successfully rebased <strong>{currentBranch}</strong>
              {state.selectedBranch ? <> onto <strong>{state.selectedBranch}</strong></> : null}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── In-Progress Rebase State ───────────────────────────────────────────────

  if (state.rebasing) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h3 className={styles.title}>
              <AlertTriangle size={18} style={{ color: 'var(--error)' }} />
              Rebase in Progress
            </h3>
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className={styles.conflictSection}>
            <p className={styles.conflictInfo}>
              A rebase is in progress on <strong>{currentBranch}</strong>.
              {state.progress && (
                <span className={styles.progressBadge}>
                  Step {state.progress.current} of {state.progress.total}
                </span>
              )}
            </p>

            {/* Progress bar */}
            {state.progress && state.progress.total > 0 && (
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${(state.progress.current / state.progress.total) * 100}%` }}
                />
              </div>
            )}

            {state.conflicts && state.conflicts.length > 0 && (
              <div className={styles.conflictFiles}>
                <div className={styles.conflictFilesHeader}>Conflicted Files:</div>
                <ul className={styles.conflictFileList}>
                  {state.conflicts.map((file) => (
                    <li key={file} className={styles.conflictFileItem}>
                      <span className={styles.conflictFileIcon}>!</span>
                      {file}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.error && (
              <div className={styles.error}>
                <AlertTriangle size={14} className={styles.errorIcon} />
                <span>{state.error}</span>
              </div>
            )}

            <p className={styles.conflictHint}>
              Resolve conflicts in each file, stage the resolved files, then continue the rebase.
            </p>
          </div>

          <div className={styles.footer}>
            <button
              className={styles.btnDanger}
              onClick={handleAbort}
              disabled={state.loading}
            >
              {state.loading ? 'Aborting...' : 'Abort Rebase'}
            </button>
            <button
              className={styles.btnSecondary}
              onClick={handleSkip}
              disabled={state.loading}
            >
              Skip
            </button>
            <button
              className={styles.btnPrimary}
              onClick={handleContinue}
              disabled={state.loading}
            >
              {state.loading ? (
                <>
                  <span className={styles.spinner} /> Continuing...
                </>
              ) : (
                'Continue'
              )}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Normal Rebase Dialog ───────────────────────────────────────────────────

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h3 className={styles.title}>
            <RotateCcw size={18} style={{ color: 'var(--accent)' }} />
            Rebase <span className={styles.titleBranch}>{currentBranch}</span>
          </h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Error */}
          {state.error && (
            <div className={styles.error}>
              <AlertTriangle size={14} className={styles.errorIcon} />
              <span>{state.error}</span>
            </div>
          )}

          {/* Branch Selector */}
          <div>
            <div className={styles.fieldLabel}>Rebase onto</div>
            {state.selectedBranch ? (
              <div className={styles.selectedBranch}>
                {state.selectedBranch}
                <button className={styles.selectedBranchClear} onClick={handleClearBranch}>
                  <X size={12} />
                </button>
              </div>
            ) : (
              <div className={styles.searchWrapper} ref={dropdownRef}>
                <Search size={14} className={styles.searchIcon} />
                <input
                  ref={searchRef}
                  className={styles.searchInput}
                  type="text"
                  placeholder="Search branches..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    setDropdownOpen(true)
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  autoFocus={!preselectedBranch}
                />
                {dropdownOpen && (
                  <div className={styles.branchDropdown}>
                    {filteredBranches.length === 0 ? (
                      <div className={styles.noBranches}>No matching branches</div>
                    ) : (
                      filteredBranches.map((b) => (
                        <div
                          key={b.name}
                          className={styles.branchItem}
                          onClick={() => handleSelectBranch(b.name)}
                        >
                          {b.name}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Published commits warning */}
          {state.preview?.isPublished && state.preview.commitCount > 0 && (
            <div className={styles.warning}>
              <AlertTriangle size={16} className={styles.warningIcon} />
              <span>
                <strong>Warning:</strong> You are rebasing commits that have been pushed to a remote.
                This will rewrite history and may cause issues for collaborators.
              </span>
            </div>
          )}

          {/* Preview */}
          {state.selectedBranch && (
            <div className={styles.preview}>
              {state.loadingPreview ? (
                <span className={styles.previewLoading}>
                  <span className={`${styles.spinner} ${styles.spinnerSmall}`} />
                  Analyzing rebase...
                </span>
              ) : state.preview ? (
                <div className={styles.previewInfo}>
                  <span className={styles.previewCount}>
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
            <label className={styles.interactiveToggle}>
              <input
                type="checkbox"
                checked={state.interactive}
                onChange={(e) =>
                  setState((prev) => ({ ...prev, interactive: e.target.checked }))
                }
              />
              <span className={styles.interactiveToggleLabel}>Interactive rebase</span>
              <span className={styles.interactiveToggleHint}>Reorder, squash, edit, or drop commits</span>
            </label>
          )}

          {/* Interactive commit list with drag-to-reorder */}
          {state.interactive && state.commitActions.length > 0 && (
            <div className={styles.interactiveSection}>
              <div className={styles.interactiveHeader}>
                <span className={styles.interactiveHeaderGrip} />
                <span>Action</span>
                <span>Hash</span>
                <span>Message</span>
              </div>
              <div className={styles.interactiveCommits}>
                {state.commitActions.map((ca, index) => (
                  <div
                    key={ca.hash}
                    className={`${styles.interactiveRow} ${
                      dragIndex === index ? styles.interactiveRowDragging : ''
                    } ${dragOverIndex === index ? styles.interactiveRowDragOver : ''} ${
                      ca.action === 'drop' ? styles.interactiveRowDrop : ''
                    }`}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                  >
                    <div className={styles.interactiveGrip}>
                      <GripVertical size={14} />
                    </div>
                    <select
                      className={styles.interactiveActionSelect}
                      value={ca.action}
                      onChange={(e) => setCommitAction(ca.hash, e.target.value as RebaseAction)}
                      style={{ borderColor: ACTION_LABELS[ca.action].color }}
                    >
                      {(Object.keys(ACTION_LABELS) as RebaseAction[]).map((a) => (
                        <option key={a} value={a}>
                          {ACTION_LABELS[a].label}
                        </option>
                      ))}
                    </select>
                    <span className={styles.interactiveHash}>{ca.hash.substring(0, 7)}</span>
                    <span className={styles.interactiveMessage}>{ca.subject}</span>
                  </div>
                ))}
              </div>
              <div className={styles.interactiveHint}>
                Drag rows to reorder commits. Commits are applied top to bottom.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            onClick={handleRebase}
            disabled={
              state.loading ||
              !state.selectedBranch ||
              (state.preview?.commitCount === 0 && !state.loadingPreview)
            }
          >
            {state.loading ? (
              <>
                <span className={styles.spinner} /> Rebasing...
              </>
            ) : state.interactive ? (
              'Start Interactive Rebase'
            ) : (
              'Rebase'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
