import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { AlertTriangle, Search, X, CheckCircle2, GitMerge } from 'lucide-react'
import styles from './MergeDialog.module.css'

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

interface MergeState {
  selectedBranch: string
  noFf: boolean
  squash: boolean
  loading: boolean
  error: string | null
  preview: { commitCount: number; fastForward: boolean } | null
  loadingPreview: boolean
  conflicts: string[] | null
  merging: boolean
  success: boolean
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
  const [searchQuery, setSearchQuery] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [state, setState] = useState<MergeState>({
    selectedBranch: preselectedBranch || '',
    noFf: false,
    squash: false,
    loading: false,
    error: null,
    preview: null,
    loadingPreview: false,
    conflicts: null,
    merging: false,
    success: false
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

  // Handle merge
  const handleMerge = useCallback(async () => {
    if (!state.selectedBranch) return

    setState((prev) => ({ ...prev, loading: true, error: null }))

    const opts: { noFastForward?: boolean; fastForwardOnly?: boolean; squash?: boolean } = {}
    if (state.squash) {
      opts.squash = true
    } else if (state.noFf) {
      opts.noFastForward = true
    }

    const result = await window.electronAPI.git.merge(
      currentRepo,
      state.selectedBranch,
      opts
    )

    if (result.success) {
      const mergeData = result.data as { success: boolean; message: string; conflicts?: string[] }
      if (mergeData.success) {
        // Show success state briefly
        setState((prev) => ({ ...prev, loading: false, success: true }))
        setTimeout(() => {
          onMergeComplete()
          onClose()
        }, 1200)
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
  }, [currentRepo, state.selectedBranch, state.noFf, state.squash, onClose, onMergeComplete])

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

  const availableBranches = useMemo(
    () => branches.filter((b) => !b.current),
    [branches]
  )

  const filteredBranches = useMemo(
    () =>
      searchQuery
        ? availableBranches.filter((b) =>
            b.name.toLowerCase().includes(searchQuery.toLowerCase())
          )
        : availableBranches,
    [availableBranches, searchQuery]
  )

  const selectBranch = useCallback((name: string) => {
    setState((prev) => ({ ...prev, selectedBranch: name, error: null }))
    setSearchQuery('')
    setDropdownOpen(false)
  }, [])

  const clearBranch = useCallback(() => {
    setState((prev) => ({ ...prev, selectedBranch: '', preview: null, error: null }))
    setSearchQuery('')
  }, [])

  // ── Success State ──────────────────────────────────────────────────────────

  if (state.success) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.success}>
            <CheckCircle2 size={48} className={styles.successIcon} />
            <div className={styles.successText}>Merge Complete</div>
            <div className={styles.successSub}>
              Merged <strong>{state.selectedBranch}</strong> into <strong>{currentBranch}</strong>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Conflict State ─────────────────────────────────────────────────────────

  if (state.merging) {
    return (
      <div className={styles.overlay} onClick={onClose}>
        <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
          <div className={styles.header}>
            <h2 className={styles.title}>
              <AlertTriangle size={18} />
              Merge in Progress
            </h2>
            <button className={styles.closeBtn} onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className={styles.conflictSection}>
            <p className={styles.conflictInfo}>
              A merge is in progress on <strong>{currentBranch}</strong>.
              {state.conflicts && state.conflicts.length > 0 && (
                <>
                  {' '}There {state.conflicts.length === 1 ? 'is' : 'are'}{' '}
                  <strong>{state.conflicts.length}</strong> conflicted
                  file{state.conflicts.length !== 1 ? 's' : ''}.
                </>
              )}
            </p>

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
                {state.error}
              </div>
            )}

            <p className={styles.conflictHint}>
              Resolve conflicts in each file, stage the resolved files, then commit to complete the merge.
            </p>
          </div>

          <div className={styles.footer}>
            <button
              className={styles.btnDanger}
              onClick={handleAbort}
              disabled={state.loading}
            >
              {state.loading ? (
                <>
                  <span className={`${styles.spinner}`} /> Aborting...
                </>
              ) : (
                'Abort Merge'
              )}
            </button>
            <button className={styles.btnSecondary} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Normal Merge Dialog ────────────────────────────────────────────────────

  const mergeDisabled =
    state.loading ||
    !state.selectedBranch ||
    (state.preview?.commitCount === 0 && !state.loadingPreview)

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            <GitMerge size={18} />
            Merge into <span className={styles.titleBranch}>{currentBranch || '...'}</span>
          </h2>
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
              {state.error}
            </div>
          )}

          {/* Branch selector */}
          <div>
            <div className={styles.fieldLabel}>Branch to merge</div>
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
                        className={`${styles.branchItem} ${
                          b.name === state.selectedBranch ? styles.branchItemActive : ''
                        }`}
                        onClick={() => selectBranch(b.name)}
                      >
                        {b.name}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {state.selectedBranch && (
              <div className={styles.selectedBranch}>
                {state.selectedBranch}
                <button className={styles.selectedBranchClear} onClick={clearBranch}>
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          {/* Merge preview */}
          {state.selectedBranch && (
            <div className={styles.preview}>
              {state.loadingPreview ? (
                <span className={styles.previewLoading}>
                  <span className={`${styles.spinner} ${styles.spinnerSmall}`} />
                  Analyzing merge...
                </span>
              ) : state.preview ? (
                <div className={styles.previewInfo}>
                  <span className={styles.previewCount}>
                    {state.preview.commitCount === 0
                      ? 'Already up to date — nothing to merge'
                      : `${state.preview.commitCount} commit${state.preview.commitCount !== 1 ? 's' : ''} will be merged`}
                  </span>
                  {state.preview.fastForward && state.preview.commitCount > 0 && (
                    <span className={styles.previewFf}>Fast-forward possible</span>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Options */}
          <div className={styles.optionsSection}>
            <div className={styles.optionsTitle}>Options</div>
            <label className={styles.optionRow}>
              <input
                type="checkbox"
                checked={state.noFf}
                onChange={() =>
                  setState((prev) => ({
                    ...prev,
                    noFf: !prev.noFf,
                    squash: !prev.noFf ? false : prev.squash
                  }))
                }
              />
              <span className={styles.optionLabel}>--no-ff</span>
              <span className={styles.optionDesc}>Always create a merge commit</span>
            </label>
            <label className={styles.optionRow}>
              <input
                type="checkbox"
                checked={state.squash}
                onChange={() =>
                  setState((prev) => ({
                    ...prev,
                    squash: !prev.squash,
                    noFf: !prev.squash ? false : prev.noFf
                  }))
                }
              />
              <span className={styles.optionLabel}>--squash</span>
              <span className={styles.optionDesc}>Squash all commits into one</span>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.btnMerge}
            onClick={handleMerge}
            disabled={mergeDisabled}
          >
            {state.loading ? (
              <>
                <span className={styles.spinner} />
                Merging...
              </>
            ) : (
              'Merge'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
