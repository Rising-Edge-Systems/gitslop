import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  GitBranch,
  GitMerge,
  Archive,
  Settings,
  AlertTriangle,
  Check,
  XCircle,
  Loader2,
  FolderOpen,
  FolderPlus,
  MoreHorizontal
} from 'lucide-react'
import { MergeDialog } from './MergeDialog'
import { CloneDialog } from './CloneDialog'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'
import styles from './Toolbar.module.css'

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

interface ToolbarButton {
  id: string
  icon: React.ReactNode
  label: string
  title: string
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  disabled: boolean
  disabledReason?: string
  active: boolean
  activeOp?: 'push' | 'pull' | 'fetch'
  requiresRemote?: boolean
  group: 'remote' | 'branch' | 'stash'
}

interface ToolbarProps {
  currentRepo: string | null
  onRepoOpen?: (repoPath: string) => void
  onOpenSettings?: () => void
  onNotify?: (type: 'success' | 'error' | 'warning' | 'info', message: string, details?: string) => void
}

export function Toolbar({ currentRepo, onRepoOpen, onOpenSettings, onNotify }: ToolbarProps): React.JSX.Element {
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
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false)

  const [activeOp, setActiveOp] = useState<ActiveOperation>(null)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track whether repo has remotes configured
  const [hasRemotes, setHasRemotes] = useState(true)
  const [remotesChecked, setRemotesChecked] = useState(false)

  // Overflow menu state
  const [overflowOpen, setOverflowOpen] = useState(false)
  const overflowRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const [overflowIndex, setOverflowIndex] = useState<number>(-1)

  // Check remotes when repo changes
  useEffect(() => {
    if (!currentRepo) {
      setHasRemotes(true)
      setRemotesChecked(false)
      return
    }
    let cancelled = false
    window.electronAPI.git.getRemotes(currentRepo).then((result) => {
      if (cancelled) return
      const remotes = result.success ? result.data : []
      setHasRemotes(Array.isArray(remotes) && remotes.length > 0)
      setRemotesChecked(true)
    }).catch(() => {
      if (!cancelled) {
        setHasRemotes(false)
        setRemotesChecked(true)
      }
    })
    return () => { cancelled = true }
  }, [currentRepo])

  // Show a temporary notification — delegates to onNotify if available
  const showNotification = useCallback((type: 'success' | 'error', message: string, details?: string) => {
    if (onNotify) {
      onNotify(type, message, details)
    } else {
      if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current)
      setNotification({ type, message })
      notificationTimerRef.current = setTimeout(() => setNotification(null), 4000)
    }
  }, [onNotify])

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

  // Close overflow menu on click outside
  useEffect(() => {
    if (!overflowOpen) return
    const handler = (e: MouseEvent) => {
      if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) {
        setOverflowOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [overflowOpen])

  // ─── No-repo actions ─────────────────────────────────────────────────────

  const handleOpenRepo = useCallback(async () => {
    const dirPath = await window.electronAPI.dialog.openDirectory()
    if (!dirPath) return
    const isRepo = await window.electronAPI.git.isRepo(dirPath)
    if (isRepo) {
      onRepoOpen?.(dirPath)
    } else {
      showNotification('error', `"${dirPath}" is not a git repository`)
    }
  }, [onRepoOpen, showNotification])

  const handleInitRepo = useCallback(async () => {
    const dirPath = await window.electronAPI.dialog.openDirectory()
    if (!dirPath) return
    const result = await window.electronAPI.git.init(dirPath)
    if (result.success) {
      onRepoOpen?.(dirPath)
    } else {
      showNotification('error', result.error || 'Failed to initialize repository')
    }
  }, [onRepoOpen, showNotification])

  const handleCloneComplete = useCallback((repoPath: string) => {
    setCloneDialogOpen(false)
    onRepoOpen?.(repoPath)
  }, [onRepoOpen])

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
          showNotification('error', 'Push rejected — remote has new changes. Pull first or force push.', errorMsg)
        } else {
          showNotification('error', errorMsg, result.error)
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

  // ─── Build button definitions for repo mode ───────────────────────────

  const repoButtons: ToolbarButton[] = useMemo(() => {
    if (!currentRepo) return []
    const noRemoteReason = !hasRemotes && remotesChecked ? 'No remotes configured' : undefined
    const busyReason = activeOp ? `${activeOp.phase}` : undefined

    return [
      {
        id: 'pull',
        icon: <ArrowDownToLine size={18} className="lucide-icon" />,
        label: 'Pull',
        title: noRemoteReason ? `Pull — ${noRemoteReason}` : 'Pull (Ctrl+Shift+L)',
        onClick: handlePull,
        onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); handlePullWithOptions() },
        disabled: !!activeOp || (!hasRemotes && remotesChecked),
        disabledReason: noRemoteReason || busyReason,
        active: isOperationActive('pull'),
        activeOp: 'pull' as const,
        requiresRemote: true,
        group: 'remote'
      },
      {
        id: 'push',
        icon: <ArrowUpFromLine size={18} className="lucide-icon" />,
        label: 'Push',
        title: noRemoteReason ? `Push — ${noRemoteReason}` : 'Push (Ctrl+Shift+P) — Right-click for force push',
        onClick: handlePush,
        onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); handleForcePushOpen() },
        disabled: !!activeOp || (!hasRemotes && remotesChecked),
        disabledReason: noRemoteReason || busyReason,
        active: isOperationActive('push'),
        activeOp: 'push' as const,
        requiresRemote: true,
        group: 'remote'
      },
      {
        id: 'fetch',
        icon: <RefreshCw size={18} className="lucide-icon" />,
        label: 'Fetch',
        title: noRemoteReason ? `Fetch — ${noRemoteReason}` : 'Fetch (Ctrl+Shift+F)',
        onClick: handleFetch,
        disabled: !!activeOp || (!hasRemotes && remotesChecked),
        disabledReason: noRemoteReason || busyReason,
        active: isOperationActive('fetch'),
        activeOp: 'fetch' as const,
        requiresRemote: true,
        group: 'remote'
      },
      {
        id: 'branch',
        icon: <GitBranch size={18} className="lucide-icon" />,
        label: 'Branch',
        title: 'Branch',
        onClick: () => {},
        disabled: false,
        active: false,
        group: 'branch'
      },
      {
        id: 'merge',
        icon: <GitMerge size={18} className="lucide-icon" />,
        label: 'Merge',
        title: 'Merge',
        onClick: () => { if (currentRepo) setMergeDialogOpen(true) },
        disabled: !currentRepo,
        active: false,
        group: 'branch'
      },
      {
        id: 'stash',
        icon: <Archive size={18} className="lucide-icon" />,
        label: 'Stash',
        title: 'Stash (Ctrl+Shift+S)',
        onClick: openStashDialog,
        disabled: false,
        active: false,
        group: 'stash'
      }
    ]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo, hasRemotes, remotesChecked, activeOp, handlePull, handlePush, handleFetch, handlePullWithOptions, handleForcePushOpen, openStashDialog])

  // ─── Overflow detection ────────────────────────────────────────────────

  // Detect overflow by measuring toolbar container
  useEffect(() => {
    if (!toolbarRef.current || !currentRepo) {
      setOverflowIndex(-1)
      return
    }
    const observer = new ResizeObserver(() => {
      if (!toolbarRef.current) return
      const toolbarWidth = toolbarRef.current.clientWidth
      // Reserve space for: settings btn (40px), spacer, overflow btn (36px), progress area (~160px), padding
      const reservedWidth = 240
      const availableWidth = toolbarWidth - reservedWidth
      // Each button is roughly 80px with label, 36px icon-only (< 700px)
      const buttonWidth = window.innerWidth < 700 ? 36 : 80
      const maxButtons = Math.max(1, Math.floor(availableWidth / buttonWidth))
      if (maxButtons < repoButtons.length) {
        setOverflowIndex(maxButtons)
      } else {
        setOverflowIndex(-1)
      }
    })
    observer.observe(toolbarRef.current)
    return () => observer.disconnect()
  }, [currentRepo, repoButtons.length])

  // ─── Render helpers ────────────────────────────────────────────────────

  const renderButton = (btn: ToolbarButton, inOverflow = false) => {
    // Hide remote buttons when no remotes
    if (btn.requiresRemote && !hasRemotes && remotesChecked) return null

    const isActive = btn.activeOp ? isOperationActive(btn.activeOp) : btn.active

    if (inOverflow) {
      return (
        <button
          key={btn.id}
          className={`${styles.overflowItem} ${isActive ? styles.overflowItemActive : ''}`}
          title={btn.disabledReason || btn.title}
          onClick={() => { btn.onClick(); setOverflowOpen(false) }}
          disabled={btn.disabled}
        >
          <span className={styles.overflowItemIcon}>{btn.icon}</span>
          <span>{btn.label}</span>
          {isActive && (
            <span className={`${styles.inlineSpinner}`}><Loader2 size={12} className="lucide-icon" /></span>
          )}
        </button>
      )
    }

    return (
      <button
        key={btn.id}
        className={`${styles.btn} ${isActive ? styles.btnActive : ''}`}
        title={btn.disabledReason || btn.title}
        onClick={btn.onClick}
        onContextMenu={btn.onContextMenu}
        disabled={btn.disabled}
      >
        <span className={styles.btnIcon}>{btn.icon}</span>
        <span className={styles.btnLabel}>{btn.label}</span>
        {isActive && (
          <span className={`${styles.inlineSpinner}`}><Loader2 size={12} className="lucide-icon" /></span>
        )}
      </button>
    )
  }

  // Split buttons into visible and overflow
  const visibleButtons = overflowIndex > 0 ? repoButtons.slice(0, overflowIndex) : repoButtons
  const overflowButtons = overflowIndex > 0 ? repoButtons.slice(overflowIndex) : []

  // Group visible buttons by group for separators
  const groupedVisible = useMemo(() => {
    const groups: ToolbarButton[][] = []
    let currentGroup: ToolbarButton[] = []
    let lastGroup = ''
    for (const btn of visibleButtons) {
      // Skip remote buttons when no remotes
      if (btn.requiresRemote && !hasRemotes && remotesChecked) continue
      if (btn.group !== lastGroup && currentGroup.length > 0) {
        groups.push(currentGroup)
        currentGroup = []
      }
      currentGroup.push(btn)
      lastGroup = btn.group
    }
    if (currentGroup.length > 0) groups.push(currentGroup)
    return groups
  }, [visibleButtons, hasRemotes, remotesChecked])

  return (
    <div className={styles.toolbar} ref={toolbarRef}>
      {!currentRepo ? (
        /* ─── No-repo mode: Open, Clone, Init ─── */
        <>
          <div className={styles.toolbarGroup}>
            <button className={styles.btn} title="Open Repository (Ctrl+O)" onClick={handleOpenRepo}>
              <span className={styles.btnIcon}><FolderOpen size={18} className="lucide-icon" /></span>
              <span className={styles.btnLabel}>Open</span>
            </button>
            <button className={styles.btn} title="Clone Repository" onClick={() => setCloneDialogOpen(true)}>
              <span className={styles.btnIcon}><GitBranch size={18} className="lucide-icon" /></span>
              <span className={styles.btnLabel}>Clone</span>
            </button>
            <button className={styles.btn} title="Initialize Repository" onClick={handleInitRepo}>
              <span className={styles.btnIcon}><FolderPlus size={18} className="lucide-icon" /></span>
              <span className={styles.btnLabel}>Init</span>
            </button>
          </div>
          <div className={styles.spacer} />
        </>
      ) : (
        /* ─── Repo mode: git operation buttons ─── */
        <>
          {groupedVisible.map((group, gi) => (
            <React.Fragment key={gi}>
              {gi > 0 && <div className={styles.separator} />}
              <div className={styles.toolbarGroup}>
                {group.map((btn) => renderButton(btn))}
              </div>
            </React.Fragment>
          ))}

          {/* Overflow menu */}
          {overflowButtons.length > 0 && (
            <div className={styles.overflowContainer} ref={overflowRef}>
              <button
                className={`${styles.btn} ${overflowOpen ? styles.btnActive : ''}`}
                title="More actions"
                onClick={() => setOverflowOpen(!overflowOpen)}
              >
                <span className={styles.btnIcon}><MoreHorizontal size={18} className="lucide-icon" /></span>
              </button>
              {overflowOpen && (
                <div className={styles.overflowMenu}>
                  {overflowButtons.map((btn) => renderButton(btn, true))}
                </div>
              )}
            </div>
          )}

          <div className={styles.spacer} />

          {/* Active operation progress indicator */}
          {activeOp && (
            <div className={styles.progress}>
              <span className={styles.progressText}>
                {activeOp.phase}
                {activeOp.percent !== null ? ` ${activeOp.percent}%` : ''}
              </span>
              {activeOp.percent !== null && (
                <div className={styles.progressBar}>
                  <div
                    className={styles.progressFill}
                    style={{ width: `${activeOp.percent}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Inline notification fallback (when no centralized notification system) */}
      {!onNotify && notification && (
        <div className={`${styles.notification} ${notification.type === 'success' ? styles.notificationSuccess : styles.notificationError}`}>
          {notification.type === 'success' ? <Check size={14} className="lucide-icon" /> : <XCircle size={14} className="lucide-icon" />} {notification.message}
        </div>
      )}

      <div className={styles.toolbarGroup}>
        <button className={styles.btn} title="Settings (Ctrl+,)" onClick={onOpenSettings}>
          <span className={styles.btnIcon}><Settings size={18} className="lucide-icon" /></span>
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

            <label className={styles.stashDialogCheckbox}>
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

            <div className={styles.forcePushWarning}>
              <span className={styles.forcePushWarningIcon}><AlertTriangle size={18} className="lucide-icon" /></span>
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
            <p className={styles.upstreamDialogDesc}>
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

      {/* Clone Dialog */}
      {cloneDialogOpen && (
        <CloneDialog
          onClose={() => setCloneDialogOpen(false)}
          onCloneComplete={handleCloneComplete}
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

            <div className={styles.pullStrategyOptions}>
              <label className={styles.pullStrategyOption}>
                <input
                  type="radio"
                  name="pullStrategy"
                  checked={!pullDialog.useRebase}
                  onChange={() => setPullDialog((prev) => ({ ...prev, useRebase: false }))}
                />
                <div>
                  <strong>Merge</strong>
                  <span className={styles.pullStrategyDesc}>Create a merge commit if needed</span>
                </div>
              </label>
              <label className={styles.pullStrategyOption}>
                <input
                  type="radio"
                  name="pullStrategy"
                  checked={pullDialog.useRebase}
                  onChange={() => setPullDialog((prev) => ({ ...prev, useRebase: true }))}
                />
                <div>
                  <strong>Rebase</strong>
                  <span className={styles.pullStrategyDesc}>Rebase your local commits on top of remote</span>
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
