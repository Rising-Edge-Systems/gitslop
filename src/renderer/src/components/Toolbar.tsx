import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { MergeDialog } from './MergeDialog'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'

interface StashDialogState {
  open: boolean
  message: string
  includeUntracked: boolean
  loading: boolean
  error: string | null
}

interface ForcePushDialogState {
  open: boolean
  loading: boolean
  error: string | null
}

interface SetUpstreamDialogState {
  open: boolean
  remotes: { name: string; fetchUrl: string; pushUrl: string }[]
  selectedRemote: string
  branchName: string
  loading: boolean
  error: string | null
}

interface PullStrategyDialogState {
  open: boolean
  useRebase: boolean
  loading: boolean
  error: string | null
}

type ActiveOperation = {
  type: 'push' | 'pull' | 'fetch'
  operationId: string | null
  phase: string
  percent: number | null
} | null

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

  const [forcePushDialog, setForcePushDialog] = useState<ForcePushDialogState>({
    open: false,
    loading: false,
    error: null
  })

  const [upstreamDialog, setUpstreamDialog] = useState<SetUpstreamDialogState>({
    open: false,
    remotes: [],
    selectedRemote: 'origin',
    branchName: '',
    loading: false,
    error: null
  })

  const [pullDialog, setPullDialog] = useState<PullStrategyDialogState>({
    open: false,
    useRebase: false,
    loading: false,
    error: null
  })

  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)

  const [activeOp, setActiveOp] = useState<ActiveOperation>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Show a temporary notification
  const showNotification = useCallback((type: 'success' | 'error', message: string) => {
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current)
    setNotification({ type, message })
    notificationTimerRef.current = setTimeout(() => setNotification(null), 4000)
  }, [])

  // Listen for progress events
  useEffect(() => {
    const cleanup = window.electronAPI.git.onOperationProgress((progress) => {
      setActiveOp((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          phase: progress.phase,
          percent: progress.percent,
          operationId: progress.operationId
        }
      })
    })
    return cleanup
  }, [])

  // ─── Push ──────────────────────────────────────────────────────────────────

  const handlePush = useCallback(async () => {
    if (!currentRepo || activeOp) return

    // Check if branch has upstream
    const upstreamResult = await window.electronAPI.git.hasUpstream(currentRepo)
    if (upstreamResult.success && !upstreamResult.data?.hasUpstream) {
      // No upstream — open set upstream dialog
      const remotesResult = await window.electronAPI.git.getRemotes(currentRepo)
      const branchResult = await window.electronAPI.git.getCurrentBranch(currentRepo)
      const remotes = remotesResult.success ? remotesResult.data : []
      const branch = branchResult.success ? branchResult.data : ''
      setUpstreamDialog({
        open: true,
        remotes,
        selectedRemote: remotes.length > 0 ? remotes[0].name : 'origin',
        branchName: branch || '',
        loading: false,
        error: null
      })
      return
    }

    setActiveOp({ type: 'push', operationId: null, phase: 'Pushing...', percent: null })
    try {
      const result = await window.electronAPI.git.push(currentRepo)
      if (result.success) {
        showNotification('success', 'Push completed successfully')
      } else {
        // Check for rejected push (non-fast-forward)
        const errorMsg = result.error || 'Push failed'
        if (errorMsg.includes('rejected') || errorMsg.includes('non-fast-forward') || errorMsg.includes('fetch first')) {
          showNotification('error', 'Push rejected — remote has new changes. Pull first or force push.')
        } else {
          showNotification('error', errorMsg)
        }
      }
    } catch {
      showNotification('error', 'Push failed')
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, activeOp, showNotification])

  const handleForcePushOpen = useCallback(() => {
    if (!currentRepo || activeOp) return
    setForcePushDialog({ open: true, loading: false, error: null })
  }, [currentRepo, activeOp])

  const handleForcePush = useCallback(async () => {
    if (!currentRepo) return
    setForcePushDialog((prev) => ({ ...prev, loading: true, error: null }))
    setActiveOp({ type: 'push', operationId: null, phase: 'Force pushing...', percent: null })
    try {
      const result = await window.electronAPI.git.push(currentRepo, { force: true })
      if (result.success) {
        showNotification('success', 'Force push completed successfully')
        setForcePushDialog({ open: false, loading: false, error: null })
      } else {
        setForcePushDialog((prev) => ({ ...prev, loading: false, error: result.error || 'Force push failed' }))
      }
    } catch {
      setForcePushDialog((prev) => ({ ...prev, loading: false, error: 'Force push failed' }))
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, showNotification])

  const handleSetUpstream = useCallback(async () => {
    if (!currentRepo) return
    setUpstreamDialog((prev) => ({ ...prev, loading: true, error: null }))
    setActiveOp({ type: 'push', operationId: null, phase: 'Pushing...', percent: null })
    try {
      const result = await window.electronAPI.git.push(currentRepo, {
        setUpstream: { remote: upstreamDialog.selectedRemote, branch: upstreamDialog.branchName }
      })
      if (result.success) {
        showNotification('success', `Pushed and set upstream to ${upstreamDialog.selectedRemote}/${upstreamDialog.branchName}`)
        setUpstreamDialog((prev) => ({ ...prev, open: false }))
      } else {
        setUpstreamDialog((prev) => ({ ...prev, loading: false, error: result.error || 'Push failed' }))
      }
    } catch {
      setUpstreamDialog((prev) => ({ ...prev, loading: false, error: 'Push failed' }))
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, upstreamDialog.selectedRemote, upstreamDialog.branchName, showNotification])

  // ─── Pull ──────────────────────────────────────────────────────────────────

  const handlePull = useCallback(async () => {
    if (!currentRepo || activeOp) return
    setActiveOp({ type: 'pull', operationId: null, phase: 'Pulling...', percent: null })
    try {
      const result = await window.electronAPI.git.pull(currentRepo)
      if (result.success) {
        showNotification('success', 'Pull completed successfully')
      } else {
        showNotification('error', result.error || 'Pull failed')
      }
    } catch {
      showNotification('error', 'Pull failed')
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, activeOp, showNotification])

  const handlePullWithOptions = useCallback(() => {
    if (!currentRepo || activeOp) return
    setPullDialog({ open: true, useRebase: false, loading: false, error: null })
  }, [currentRepo, activeOp])

  const handlePullConfirm = useCallback(async () => {
    if (!currentRepo) return
    setPullDialog((prev) => ({ ...prev, loading: true, error: null }))
    setActiveOp({ type: 'pull', operationId: null, phase: 'Pulling...', percent: null })
    try {
      const result = await window.electronAPI.git.pull(currentRepo, { rebase: pullDialog.useRebase })
      if (result.success) {
        showNotification('success', `Pull (${pullDialog.useRebase ? 'rebase' : 'merge'}) completed successfully`)
        setPullDialog((prev) => ({ ...prev, open: false }))
      } else {
        setPullDialog((prev) => ({ ...prev, loading: false, error: result.error || 'Pull failed' }))
      }
    } catch {
      setPullDialog((prev) => ({ ...prev, loading: false, error: 'Pull failed' }))
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, pullDialog.useRebase, showNotification])

  // ─── Fetch ─────────────────────────────────────────────────────────────────

  const handleFetch = useCallback(async () => {
    if (!currentRepo || activeOp) return
    setActiveOp({ type: 'fetch', operationId: null, phase: 'Fetching...', percent: null })
    try {
      const result = await window.electronAPI.git.fetchWithProgress(currentRepo)
      if (result.success) {
        showNotification('success', 'Fetch completed successfully')
      } else {
        showNotification('error', result.error || 'Fetch failed')
      }
    } catch {
      showNotification('error', 'Fetch failed')
    } finally {
      setActiveOp(null)
    }
  }, [currentRepo, activeOp, showNotification])

  // ─── Stash ─────────────────────────────────────────────────────────────────

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

  // ─── Keyboard Shortcuts (Central Registry) ──────────────────────────────

  const stablePush = useShortcutHandler(handlePush)
  const stablePull = useShortcutHandler(handlePull)
  const stableFetch = useShortcutHandler(handleFetch)
  const stableStash = useShortcutHandler(openStashDialog)

  const gitShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'push',
        'Push',
        'Git',
        'Ctrl+Shift+P',
        { ctrl: true, shift: true, key: 'P' },
        stablePush,
        !!currentRepo
      ),
      defineShortcut(
        'pull',
        'Pull',
        'Git',
        'Ctrl+Shift+L',
        { ctrl: true, shift: true, key: 'L' },
        stablePull,
        !!currentRepo
      ),
      defineShortcut(
        'fetch',
        'Fetch',
        'Git',
        'Ctrl+Shift+F',
        { ctrl: true, shift: true, key: 'F' },
        stableFetch,
        !!currentRepo
      ),
      defineShortcut(
        'stash',
        'Stash Changes',
        'Git',
        'Ctrl+Shift+S',
        { ctrl: true, shift: true, key: 'S' },
        stableStash,
        !!currentRepo
      )
    ],
    [stablePush, stablePull, stableFetch, stableStash, currentRepo]
  )

  useKeyboardShortcuts(gitShortcuts)

  const isOperationActive = (type: string): boolean => activeOp?.type === type

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button
          className={`toolbar-btn ${isOperationActive('pull') ? 'toolbar-btn-active' : ''}`}
          title="Pull (Ctrl+Shift+L)"
          onClick={handlePull}
          onContextMenu={(e) => {
            e.preventDefault()
            handlePullWithOptions()
          }}
          disabled={!!activeOp}
        >
          {isOperationActive('pull') ? (
            <span className="toolbar-btn-icon toolbar-spinner">⟳</span>
          ) : (
            <span className="toolbar-btn-icon">⬇</span>
          )}
          <span className="toolbar-btn-label">Pull</span>
        </button>
        <button
          className={`toolbar-btn ${isOperationActive('push') ? 'toolbar-btn-active' : ''}`}
          title="Push (Ctrl+Shift+P) — Right-click for force push"
          onClick={handlePush}
          onContextMenu={(e) => {
            e.preventDefault()
            handleForcePushOpen()
          }}
          disabled={!!activeOp}
        >
          {isOperationActive('push') ? (
            <span className="toolbar-btn-icon toolbar-spinner">⟳</span>
          ) : (
            <span className="toolbar-btn-icon">⬆</span>
          )}
          <span className="toolbar-btn-label">Push</span>
        </button>
        <button
          className={`toolbar-btn ${isOperationActive('fetch') ? 'toolbar-btn-active' : ''}`}
          title="Fetch (Ctrl+Shift+F)"
          onClick={handleFetch}
          disabled={!!activeOp}
        >
          {isOperationActive('fetch') ? (
            <span className="toolbar-btn-icon toolbar-spinner">⟳</span>
          ) : (
            <span className="toolbar-btn-icon">⟳</span>
          )}
          <span className="toolbar-btn-label">Fetch</span>
        </button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Branch">
          <span className="toolbar-btn-icon">⑂</span>
          <span className="toolbar-btn-label">Branch</span>
        </button>
        <button
          className="toolbar-btn"
          title="Merge"
          onClick={() => {
            if (currentRepo) setMergeDialogOpen(true)
          }}
          disabled={!currentRepo}
        >
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

      {/* Active operation progress indicator */}
      {activeOp && (
        <div className="toolbar-progress">
          <span className="toolbar-progress-text">
            {activeOp.phase}
            {activeOp.percent !== null ? ` ${activeOp.percent}%` : ''}
          </span>
          {activeOp.percent !== null && (
            <div className="toolbar-progress-bar">
              <div
                className="toolbar-progress-fill"
                style={{ width: `${activeOp.percent}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Notification toast */}
      {notification && (
        <div className={`toolbar-notification toolbar-notification-${notification.type}`}>
          {notification.type === 'success' ? '✓' : '✗'} {notification.message}
        </div>
      )}

      <div className="toolbar-group">
        <button className="toolbar-btn" title="Settings (Ctrl+,)">
          <span className="toolbar-btn-icon">⚙</span>
        </button>
      </div>

      {/* Stash Dialog */}
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

      {/* Force Push Confirmation Dialog */}
      {forcePushDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setForcePushDialog({ open: false, loading: false, error: null })}>
          <div className="branch-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="branch-dialog-title">Force Push</div>

            <div className="force-push-warning">
              <span className="force-push-warning-icon">⚠️</span>
              <p>
                <strong>Warning:</strong> Force push will overwrite the remote branch history.
                This can cause data loss for other collaborators.
              </p>
            </div>

            {forcePushDialog.error && (
              <div className="branch-dialog-error">{forcePushDialog.error}</div>
            )}

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={() => setForcePushDialog({ open: false, loading: false, error: null })}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-danger"
                onClick={handleForcePush}
                disabled={forcePushDialog.loading}
              >
                {forcePushDialog.loading ? 'Force Pushing...' : 'Force Push'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Set Upstream Dialog */}
      {upstreamDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setUpstreamDialog((prev) => ({ ...prev, open: false }))}>
          <div className="branch-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="branch-dialog-title">Set Upstream & Push</div>
            <p className="upstream-dialog-desc">
              This branch has no tracking branch. Choose a remote to push to:
            </p>

            {upstreamDialog.error && (
              <div className="branch-dialog-error">{upstreamDialog.error}</div>
            )}

            <label className="branch-dialog-label">
              Remote
              <select
                className="branch-dialog-input"
                value={upstreamDialog.selectedRemote}
                onChange={(e) =>
                  setUpstreamDialog((prev) => ({ ...prev, selectedRemote: e.target.value }))
                }
              >
                {upstreamDialog.remotes.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.name} ({r.pushUrl || r.fetchUrl})
                  </option>
                ))}
              </select>
            </label>

            <label className="branch-dialog-label">
              Branch name
              <input
                className="branch-dialog-input"
                type="text"
                value={upstreamDialog.branchName}
                onChange={(e) =>
                  setUpstreamDialog((prev) => ({ ...prev, branchName: e.target.value }))
                }
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !upstreamDialog.loading) handleSetUpstream()
                  if (e.key === 'Escape') setUpstreamDialog((prev) => ({ ...prev, open: false }))
                }}
              />
            </label>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={() => setUpstreamDialog((prev) => ({ ...prev, open: false }))}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleSetUpstream}
                disabled={upstreamDialog.loading || !upstreamDialog.branchName}
              >
                {upstreamDialog.loading ? 'Pushing...' : 'Push & Set Upstream'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Dialog */}
      {mergeDialogOpen && currentRepo && (
        <MergeDialog
          currentRepo={currentRepo}
          onClose={() => setMergeDialogOpen(false)}
          onMergeComplete={() => {
            showNotification('success', 'Merge completed successfully')
          }}
        />
      )}

      {/* Pull Strategy Dialog */}
      {pullDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setPullDialog((prev) => ({ ...prev, open: false }))}>
          <div className="branch-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="branch-dialog-title">Pull Options</div>

            {pullDialog.error && (
              <div className="branch-dialog-error">{pullDialog.error}</div>
            )}

            <div className="pull-strategy-options">
              <label className="pull-strategy-option">
                <input
                  type="radio"
                  name="pullStrategy"
                  checked={!pullDialog.useRebase}
                  onChange={() => setPullDialog((prev) => ({ ...prev, useRebase: false }))}
                />
                <div>
                  <strong>Merge</strong>
                  <span className="pull-strategy-desc">Create a merge commit if needed</span>
                </div>
              </label>
              <label className="pull-strategy-option">
                <input
                  type="radio"
                  name="pullStrategy"
                  checked={pullDialog.useRebase}
                  onChange={() => setPullDialog((prev) => ({ ...prev, useRebase: true }))}
                />
                <div>
                  <strong>Rebase</strong>
                  <span className="pull-strategy-desc">Rebase your local commits on top of remote</span>
                </div>
              </label>
            </div>

            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={() => setPullDialog((prev) => ({ ...prev, open: false }))}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handlePullConfirm}
                disabled={pullDialog.loading}
              >
                {pullDialog.loading ? 'Pulling...' : 'Pull'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
