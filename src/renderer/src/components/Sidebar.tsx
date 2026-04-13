import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  ChevronRight,
  GitBranch,
  Globe,
  Tag,
  Archive,
  Package,
  FolderOpen,
  ArrowRightLeft,
  Pencil,
  GitMerge,
  RotateCcw,
  ArrowUpFromLine,
  Trash2,
  X,
  AlertTriangle,
  RefreshCw,
  Check,
  Circle,
  CircleDot,
  ArrowDown,
  ArrowUp,
  ExternalLink,
  CornerRightUp,
  CornerUpRight,
  Bell,
  Download,
  Bookmark,
  PanelLeftClose,
  PanelLeftOpen,
  GitPullRequestArrow,
  Gitlab
} from 'lucide-react'
import { MergeDialog } from './MergeDialog'
import { RebaseDialog } from './RebaseDialog'
import { FileTree } from './FileTree'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { SkeletonList } from './Skeleton'
import styles from './Sidebar.module.css'

type SidebarTab = 'git' | 'files'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GitBranch {
  name: string
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  hash: string
}

interface SidebarProps {
  currentRepo: string | null
  collapsed: boolean
  onToggleCollapse: () => void
}

interface ContextMenuState {
  x: number
  y: number
  branch: GitBranch
}

interface NewBranchDialogState {
  open: boolean
  name: string
  base: string
  checkout: boolean
  error: string | null
  loading: boolean
}

// ─── SidebarSection ──────────────────────────────────────────────────────────

interface SidebarSectionProps {
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  count?: number
  children: React.ReactNode
  headerAction?: React.ReactNode
}

function SidebarSection({
  title,
  icon,
  defaultOpen = true,
  count,
  children,
  headerAction
}: SidebarSectionProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const contentRef = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggle()
    }
    // Arrow down: focus the first focusable item in section content
    if (e.key === 'ArrowDown' && isOpen && contentRef.current) {
      e.preventDefault()
      const firstItem = contentRef.current.querySelector<HTMLElement>('[tabindex="0"], button, a, input')
      if (firstItem) firstItem.focus()
    }
  }, [toggle, isOpen])

  return (
    <div className={styles.section} role="region" aria-label={title}>
      <div className={styles.sectionHeaderRow}>
        <button
          className={styles.sectionHeader}
          onClick={toggle}
          onKeyDown={handleKeyDown}
          aria-expanded={isOpen}
          aria-controls={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
        >
          <span className={`${styles.sectionChevron} ${isOpen ? styles.sectionChevronOpen : ''}`}><ChevronRight size={14} /></span>
          <span className={styles.sectionIcon}>{icon}</span>
          <span className={styles.sectionTitle}>{title}</span>
          {count !== undefined && count > 0 && (
            <span className={styles.sectionCount}>{count}</span>
          )}
        </button>
        {headerAction && <div className={styles.sectionAction}>{headerAction}</div>}
      </div>
      {isOpen && (
        <div
          ref={contentRef}
          className={styles.sectionContent}
          id={`section-${title.toLowerCase().replace(/\s+/g, '-')}`}
          role="group"
        >
          {children}
        </div>
      )}
    </div>
  )
}

// ─── BranchContextMenu items builder ────────────────────────────────────────

function buildBranchContextMenuItems(
  branch: GitBranch,
  currentBranch: string,
  callbacks: {
    onCheckout: (name: string) => void
    onRename: (name: string) => void
    onDelete: (name: string) => void
    onMerge: (name: string) => void
    onRebase: (name: string) => void
    onPush: (name: string) => void
  }
): ContextMenuEntry[] {
  const isCurrent = branch.name === currentBranch
  const items: ContextMenuEntry[] = []

  if (!isCurrent) {
    items.push({ key: 'checkout', label: 'Checkout', icon: <ArrowRightLeft size={14} />, onClick: () => callbacks.onCheckout(branch.name) })
  }
  items.push({ key: 'rename', label: 'Rename', icon: <Pencil size={14} />, onClick: () => callbacks.onRename(branch.name) })
  if (!isCurrent) {
    items.push({ key: 'sep1', separator: true })
    items.push({ key: 'merge', label: `Merge into ${currentBranch}`, icon: <GitMerge size={14} />, onClick: () => callbacks.onMerge(branch.name) })
    items.push({ key: 'rebase', label: `Rebase onto ${branch.name}`, icon: <RotateCcw size={14} />, onClick: () => callbacks.onRebase(branch.name) })
  }
  items.push({ key: 'sep2', separator: true })
  if (branch.upstream) {
    items.push({ key: 'push', label: 'Push', icon: <ArrowUpFromLine size={14} />, shortcut: 'Ctrl+Shift+P', onClick: () => callbacks.onPush(branch.name) })
  }
  if (!isCurrent) {
    items.push({ key: 'delete', label: 'Delete', icon: <Trash2 size={14} />, danger: true, onClick: () => callbacks.onDelete(branch.name) })
  }

  return items
}

// ─── NewBranchDialog ────────────────────────────────────────────────────────

interface NewBranchDialogProps {
  state: NewBranchDialogState
  branches: GitBranch[]
  onClose: () => void
  onChange: (updates: Partial<NewBranchDialogState>) => void
  onSubmit: () => void
}

function NewBranchDialog({
  state,
  branches,
  onClose,
  onChange,
  onSubmit
}: NewBranchDialogProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && state.name.trim()) onSubmit()
    },
    [onClose, onSubmit, state.name]
  )

  return (
    <div className="branch-dialog-overlay" onClick={onClose}>
      <div
        className="branch-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="branch-dialog-header">
          <h3 className="branch-dialog-title">New Branch</h3>
          <button className="branch-dialog-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="branch-dialog-body">
          <div className="branch-dialog-field">
            <label className="branch-dialog-label">Branch Name</label>
            <input
              ref={inputRef}
              type="text"
              className="branch-dialog-input"
              placeholder="feature/my-branch"
              value={state.name}
              onChange={(e) => onChange({ name: e.target.value })}
              disabled={state.loading}
            />
          </div>
          <div className="branch-dialog-field">
            <label className="branch-dialog-label">Base Branch / Commit</label>
            <select
              className="branch-dialog-select"
              value={state.base}
              onChange={(e) => onChange({ base: e.target.value })}
              disabled={state.loading}
            >
              <option value="">HEAD (current)</option>
              {branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.current ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="branch-dialog-checkbox-label">
            <input
              type="checkbox"
              checked={state.checkout}
              onChange={(e) => onChange({ checkout: e.target.checked })}
              disabled={state.loading}
            />
            <span>Switch to new branch after creation</span>
          </label>
          {state.error && (
            <div className="branch-dialog-error">
              <AlertTriangle size={14} /> {state.error}
            </div>
          )}
        </div>
        <div className="branch-dialog-footer">
          <button className="branch-dialog-btn branch-dialog-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="branch-dialog-btn branch-dialog-btn-create"
            disabled={!state.name.trim() || state.loading}
            onClick={onSubmit}
          >
            {state.loading ? 'Creating...' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── RenameDialog ───────────────────────────────────────────────────────────

interface RenameDialogProps {
  oldName: string
  onClose: () => void
  onSubmit: (newName: string) => void
}

function RenameDialog({ oldName, onClose, onSubmit }: RenameDialogProps): React.JSX.Element {
  const [newName, setNewName] = useState(oldName)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = newName.trim()
    if (!trimmed) {
      setError('Branch name cannot be empty')
      return
    }
    if (trimmed === oldName) {
      onClose()
      return
    }
    onSubmit(trimmed)
  }, [newName, oldName, onClose, onSubmit])

  return (
    <div className="branch-dialog-overlay" onClick={onClose}>
      <div
        className="branch-dialog"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter') handleSubmit()
        }}
      >
        <div className="branch-dialog-header">
          <h3 className="branch-dialog-title">Rename Branch</h3>
          <button className="branch-dialog-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="branch-dialog-body">
          <div className="branch-dialog-field">
            <label className="branch-dialog-label">New Name</label>
            <input
              ref={inputRef}
              type="text"
              className="branch-dialog-input"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value)
                setError(null)
              }}
            />
          </div>
          {error && (
            <div className="branch-dialog-error">
              <AlertTriangle size={14} /> {error}
            </div>
          )}
        </div>
        <div className="branch-dialog-footer">
          <button className="branch-dialog-btn branch-dialog-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="branch-dialog-btn branch-dialog-btn-create"
            disabled={!newName.trim()}
            onClick={handleSubmit}
          >
            Rename
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Remote Types ───────────────────────────────────────────────────────────

interface GitRemote {
  name: string
  fetchUrl: string
  pushUrl: string
}

interface RemoteBranch {
  remote: string
  branch: string
  hash: string
}

interface RemoteContextMenuState {
  x: number
  y: number
  remote: GitRemote
}

interface RemoteBranchContextMenuState {
  x: number
  y: number
  remote: string
  branch: string
}

interface AddRemoteDialogState {
  open: boolean
  name: string
  url: string
  error: string | null
  loading: boolean
}

interface EditRemoteDialogState {
  open: boolean
  name: string
  url: string
  error: string | null
  loading: boolean
}

// ─── RemotesSection ─────────────────────────────────────────────────────────

interface RemotesSectionProps {
  currentRepo: string | null
  onBranchesChanged: () => void
}

function RemotesSection({ currentRepo, onBranchesChanged }: RemotesSectionProps): React.JSX.Element {
  const [remotes, setRemotes] = useState<GitRemote[]>([])
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranch[]>([])
  const [expandedRemotes, setExpandedRemotes] = useState<Set<string>>(new Set())
  const [remoteContextMenu, setRemoteContextMenu] = useState<RemoteContextMenuState | null>(null)
  const [remoteBranchContextMenu, setRemoteBranchContextMenu] = useState<RemoteBranchContextMenuState | null>(null)
  const [addRemoteDialog, setAddRemoteDialog] = useState<AddRemoteDialogState>({
    open: false, name: '', url: '', error: null, loading: false
  })
  const [editRemoteDialog, setEditRemoteDialog] = useState<EditRemoteDialogState>({
    open: false, name: '', url: '', error: null, loading: false
  })

  const loadRemotes = useCallback(async () => {
    if (!currentRepo) {
      setRemotes([])
      setRemoteBranches([])
      return
    }
    try {
      const [remotesResult, branchesResult] = await Promise.all([
        window.electronAPI.git.getRemotes(currentRepo),
        window.electronAPI.git.getRemoteBranches(currentRepo)
      ])
      if (remotesResult.success && Array.isArray(remotesResult.data)) {
        setRemotes(remotesResult.data as GitRemote[])
      }
      if (branchesResult.success && Array.isArray(branchesResult.data)) {
        setRemoteBranches(branchesResult.data as RemoteBranch[])
      }
    } catch {
      // ignore
    }
  }, [currentRepo])

  useEffect(() => {
    loadRemotes()
  }, [loadRemotes])

  // Refresh remotes on repo file changes
  useEffect(() => {
    if (!currentRepo) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(loadRemotes, 1000)
    })
    return () => {
      cleanup()
      if (timer) clearTimeout(timer)
    }
  }, [currentRepo, loadRemotes])

  // Refresh remotes on graph:force-refresh (after push/fetch/pull)
  useEffect(() => {
    const handler = (): void => {
      loadRemotes()
    }
    window.addEventListener('graph:force-refresh', handler)
    return () => window.removeEventListener('graph:force-refresh', handler)
  }, [loadRemotes])

  const toggleRemote = useCallback((name: string) => {
    setExpandedRemotes((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const handleCheckoutRemoteBranch = useCallback(
    async (remoteName: string, branchName: string) => {
      if (!currentRepo) return
      const result = await window.electronAPI.git.checkoutRemoteBranch(currentRepo, remoteName, branchName)
      if (result.success) {
        onBranchesChanged()
      }
    },
    [currentRepo, onBranchesChanged]
  )

  const handleDeleteRemoteBranch = useCallback(
    async (remoteName: string, branchName: string) => {
      if (!currentRepo) return
      const confirmed = confirm(`Delete remote branch "${remoteName}/${branchName}"?\n\nThis will remove the branch from the remote.`)
      if (!confirmed) return
      const result = await window.electronAPI.git.deleteRemoteBranch(currentRepo, remoteName, branchName)
      if (result.success) {
        await loadRemotes()
      }
    },
    [currentRepo, loadRemotes]
  )

  const handleFetchRemote = useCallback(
    async (remoteName?: string) => {
      if (!currentRepo) return
      await window.electronAPI.git.fetch(currentRepo, remoteName)
      await loadRemotes()
      onBranchesChanged()
    },
    [currentRepo, loadRemotes, onBranchesChanged]
  )

  const handleRemoveRemote = useCallback(
    async (remoteName: string) => {
      if (!currentRepo) return
      const confirmed = confirm(`Remove remote "${remoteName}"?`)
      if (!confirmed) return
      const result = await window.electronAPI.git.removeRemote(currentRepo, remoteName)
      if (result.success) {
        await loadRemotes()
      }
    },
    [currentRepo, loadRemotes]
  )

  const handleAddRemoteSubmit = useCallback(async () => {
    if (!currentRepo || !addRemoteDialog.name.trim() || !addRemoteDialog.url.trim()) return
    setAddRemoteDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.git.addRemote(
        currentRepo,
        addRemoteDialog.name.trim(),
        addRemoteDialog.url.trim()
      )
      if (result.success) {
        setAddRemoteDialog({ open: false, name: '', url: '', error: null, loading: false })
        await loadRemotes()
      } else {
        setAddRemoteDialog((prev) => ({ ...prev, error: result.error || 'Failed to add remote', loading: false }))
      }
    } catch (err) {
      setAddRemoteDialog((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to add remote',
        loading: false
      }))
    }
  }, [currentRepo, addRemoteDialog.name, addRemoteDialog.url, loadRemotes])

  const handleEditRemoteSubmit = useCallback(async () => {
    if (!currentRepo || !editRemoteDialog.name || !editRemoteDialog.url.trim()) return
    setEditRemoteDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.git.editRemoteUrl(
        currentRepo,
        editRemoteDialog.name,
        editRemoteDialog.url.trim()
      )
      if (result.success) {
        setEditRemoteDialog({ open: false, name: '', url: '', error: null, loading: false })
        await loadRemotes()
      } else {
        setEditRemoteDialog((prev) => ({ ...prev, error: result.error || 'Failed to edit remote', loading: false }))
      }
    } catch (err) {
      setEditRemoteDialog((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to edit remote',
        loading: false
      }))
    }
  }, [currentRepo, editRemoteDialog.name, editRemoteDialog.url, loadRemotes])

  const openEditRemote = useCallback((remote: GitRemote) => {
    setEditRemoteDialog({
      open: true,
      name: remote.name,
      url: remote.fetchUrl || remote.pushUrl,
      error: null,
      loading: false
    })
  }, [])

  const branchesByRemote = useCallback(
    (remoteName: string) => remoteBranches.filter((b) => b.remote === remoteName),
    [remoteBranches]
  )

  return (
    <>
      <SidebarSection
        title="Remotes"
        icon={<Globe size={16} />}
        defaultOpen={false}
        count={remotes.length}
        headerAction={
          currentRepo ? (
            <button
              className={styles.sectionAddBtn}
              onClick={() => setAddRemoteDialog({ open: true, name: '', url: '', error: null, loading: false })}
              title="Add Remote"
            >
              +
            </button>
          ) : undefined
        }
      >
        {!currentRepo ? (
          <div className={styles.placeholder}>No repository open</div>
        ) : remotes.length === 0 ? (
          <div className={styles.placeholder}>No remotes configured</div>
        ) : (
          <div className={styles.remoteList}>
            {remotes.map((remote) => {
              const isExpanded = expandedRemotes.has(remote.name)
              const branches = branchesByRemote(remote.name)
              return (
                <div key={remote.name} className={styles.remoteGroup}>
                  <div
                    className={styles.remoteItem}
                    onClick={() => toggleRemote(remote.name)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setRemoteContextMenu({ x: e.clientX, y: e.clientY, remote })
                    }}
                    title={`${remote.name}\nFetch: ${remote.fetchUrl}\nPush: ${remote.pushUrl}`}
                  >
                    <span className={`${styles.sectionChevron} ${isExpanded ? styles.sectionChevronOpen : ''}`}><ChevronRight size={14} /></span>
                    <span className={styles.remoteName}>{remote.name}</span>
                    <span className={styles.sectionCount}>{branches.length}</span>
                  </div>
                  {isExpanded && (
                    <div className={styles.remoteBranches}>
                      {branches.length === 0 ? (
                        <div className={styles.placeholder} style={{ paddingLeft: '28px' }}>No branches</div>
                      ) : (
                        branches.map((rb) => (
                          <div
                            key={`${rb.remote}/${rb.branch}`}
                            className={styles.remoteBranchItem}
                            onDoubleClick={() => handleCheckoutRemoteBranch(rb.remote, rb.branch)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setRemoteBranchContextMenu({ x: e.clientX, y: e.clientY, remote: rb.remote, branch: rb.branch })
                            }}
                            title={`${rb.remote}/${rb.branch} (${rb.hash})`}
                          >
                            <span className={styles.remoteBranchName}>{rb.branch}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </SidebarSection>

      {/* Remote context menu */}
      {remoteContextMenu && (
        <ContextMenu
          x={remoteContextMenu.x}
          y={remoteContextMenu.y}
          items={buildRemoteContextMenuItems(remoteContextMenu.remote, {
            onFetch: (name) => { handleFetchRemote(name) },
            onEdit: (remote) => { openEditRemote(remote) },
            onRemove: (name) => { handleRemoveRemote(name) },
          })}
          onClose={() => setRemoteContextMenu(null)}
        />
      )}

      {/* Remote branch context menu */}
      {remoteBranchContextMenu && (
        <ContextMenu
          x={remoteBranchContextMenu.x}
          y={remoteBranchContextMenu.y}
          items={buildRemoteBranchContextMenuItems(
            remoteBranchContextMenu.remote,
            remoteBranchContextMenu.branch,
            {
              onCheckout: (r, b) => { handleCheckoutRemoteBranch(r, b) },
              onDelete: (r, b) => { handleDeleteRemoteBranch(r, b) },
              onFetch: (r) => { handleFetchRemote(r) },
            }
          )}
          onClose={() => setRemoteBranchContextMenu(null)}
        />
      )}

      {/* Add Remote Dialog */}
      {addRemoteDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setAddRemoteDialog((p) => ({ ...p, open: false }))}>
          <div
            className="branch-dialog"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setAddRemoteDialog((p) => ({ ...p, open: false }))
              if (e.key === 'Enter' && addRemoteDialog.name.trim() && addRemoteDialog.url.trim()) handleAddRemoteSubmit()
            }}
          >
            <div className="branch-dialog-header">
              <h3 className="branch-dialog-title">Add Remote</h3>
              <button className="branch-dialog-close" onClick={() => setAddRemoteDialog((p) => ({ ...p, open: false }))}>
                <X size={14} />
              </button>
            </div>
            <div className="branch-dialog-body">
              <div className="branch-dialog-field">
                <label className="branch-dialog-label">Remote Name</label>
                <input
                  type="text"
                  className="branch-dialog-input"
                  placeholder="origin"
                  value={addRemoteDialog.name}
                  onChange={(e) => setAddRemoteDialog((p) => ({ ...p, name: e.target.value }))}
                  disabled={addRemoteDialog.loading}
                  autoFocus
                />
              </div>
              <div className="branch-dialog-field">
                <label className="branch-dialog-label">URL</label>
                <input
                  type="text"
                  className="branch-dialog-input"
                  placeholder="https://github.com/user/repo.git"
                  value={addRemoteDialog.url}
                  onChange={(e) => setAddRemoteDialog((p) => ({ ...p, url: e.target.value }))}
                  disabled={addRemoteDialog.loading}
                />
              </div>
              {addRemoteDialog.error && (
                <div className="branch-dialog-error">
                  <AlertTriangle size={14} /> {addRemoteDialog.error}
                </div>
              )}
            </div>
            <div className="branch-dialog-footer">
              <button className="branch-dialog-btn branch-dialog-btn-cancel" onClick={() => setAddRemoteDialog((p) => ({ ...p, open: false }))}>
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-create"
                disabled={!addRemoteDialog.name.trim() || !addRemoteDialog.url.trim() || addRemoteDialog.loading}
                onClick={handleAddRemoteSubmit}
              >
                {addRemoteDialog.loading ? 'Adding...' : 'Add Remote'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Remote Dialog */}
      {editRemoteDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setEditRemoteDialog((p) => ({ ...p, open: false }))}>
          <div
            className="branch-dialog"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditRemoteDialog((p) => ({ ...p, open: false }))
              if (e.key === 'Enter' && editRemoteDialog.url.trim()) handleEditRemoteSubmit()
            }}
          >
            <div className="branch-dialog-header">
              <h3 className="branch-dialog-title">Edit Remote: {editRemoteDialog.name}</h3>
              <button className="branch-dialog-close" onClick={() => setEditRemoteDialog((p) => ({ ...p, open: false }))}>
                <X size={14} />
              </button>
            </div>
            <div className="branch-dialog-body">
              <div className="branch-dialog-field">
                <label className="branch-dialog-label">URL</label>
                <input
                  type="text"
                  className="branch-dialog-input"
                  value={editRemoteDialog.url}
                  onChange={(e) => setEditRemoteDialog((p) => ({ ...p, url: e.target.value }))}
                  disabled={editRemoteDialog.loading}
                  autoFocus
                />
              </div>
              {editRemoteDialog.error && (
                <div className="branch-dialog-error">
                  <AlertTriangle size={14} /> {editRemoteDialog.error}
                </div>
              )}
            </div>
            <div className="branch-dialog-footer">
              <button className="branch-dialog-btn branch-dialog-btn-cancel" onClick={() => setEditRemoteDialog((p) => ({ ...p, open: false }))}>
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-create"
                disabled={!editRemoteDialog.url.trim() || editRemoteDialog.loading}
                onClick={handleEditRemoteSubmit}
              >
                {editRemoteDialog.loading ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── Remote Context Menu items builder ───────────────────────────────────────

function buildRemoteContextMenuItems(
  remote: GitRemote,
  callbacks: {
    onFetch: (name: string) => void
    onEdit: (remote: GitRemote) => void
    onRemove: (name: string) => void
  }
): ContextMenuEntry[] {
  return [
    { key: 'fetch', label: 'Fetch', icon: <RefreshCw size={14} />, onClick: () => callbacks.onFetch(remote.name) },
    { key: 'edit', label: 'Edit URL', icon: <Pencil size={14} />, onClick: () => callbacks.onEdit(remote) },
    { key: 'sep1', separator: true },
    { key: 'remove', label: 'Remove', icon: <Trash2 size={14} />, danger: true, onClick: () => callbacks.onRemove(remote.name) },
  ]
}

// ─── Remote Branch Context Menu items builder ────────────────────────────────

function buildRemoteBranchContextMenuItems(
  remote: string,
  branch: string,
  callbacks: {
    onCheckout: (remote: string, branch: string) => void
    onDelete: (remote: string, branch: string) => void
    onFetch: (remote: string) => void
  }
): ContextMenuEntry[] {
  return [
    { key: 'checkout', label: 'Checkout as local branch', icon: <ArrowRightLeft size={14} />, onClick: () => callbacks.onCheckout(remote, branch) },
    { key: 'fetch', label: 'Fetch', icon: <RefreshCw size={14} />, onClick: () => callbacks.onFetch(remote) },
    { key: 'sep1', separator: true },
    { key: 'delete', label: 'Delete remote branch', icon: <Trash2 size={14} />, danger: true, onClick: () => callbacks.onDelete(remote, branch) },
  ]
}

// ─── TagsSection ────────────────────────────────────────────────────────────

interface GitTag {
  name: string
  hash: string
  isAnnotated: boolean
  message: string
  taggerDate: string
}

interface TagContextMenuState {
  x: number
  y: number
  tag: GitTag
}

interface NewTagDialogState {
  open: boolean
  name: string
  target: string
  message: string
  error: string | null
  loading: boolean
}

interface TagsSectionProps {
  currentRepo: string | null
}

function TagsSection({ currentRepo }: TagsSectionProps): React.JSX.Element {
  const [tags, setTags] = useState<GitTag[]>([])
  const [filter, setFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<TagContextMenuState | null>(null)
  const [newTagDialog, setNewTagDialog] = useState<NewTagDialogState>({
    open: false,
    name: '',
    target: 'HEAD',
    message: '',
    error: null,
    loading: false
  })
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadTags = useCallback(async () => {
    if (!currentRepo) {
      setTags([])
      return
    }
    try {
      const result = await window.electronAPI.git.getTags(currentRepo)
      if (result.success && result.data) {
        setTags(result.data)
      }
    } catch {
      // ignore
    }
  }, [currentRepo])

  // Load tags on mount and refresh on repo changes
  useEffect(() => {
    loadTags()

    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(loadTags, 1000)
    })

    return () => {
      cleanup?.()
      if (timer) clearTimeout(timer)
    }
  }, [loadTags])

  // Refresh tags on graph:force-refresh (after push/fetch/pull)
  useEffect(() => {
    const handler = (): void => {
      loadTags()
    }
    window.addEventListener('graph:force-refresh', handler)
    return () => window.removeEventListener('graph:force-refresh', handler)
  }, [loadTags])

  const filteredTags = filter
    ? tags.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase()))
    : tags

  const handleContextMenu = useCallback((e: React.MouseEvent, tag: GitTag) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, tag })
  }, [])

  const handleDelete = useCallback(
    async (name: string) => {
      if (!currentRepo) return
      if (!confirm(`Delete tag "${name}"?`)) return
      try {
        const result = await window.electronAPI.git.deleteTag(currentRepo, name)
        if (!result.success) {
          alert(`Failed to delete tag: ${result.error}`)
        }
        loadTags()
      } catch {
        // ignore
      }
    },
    [currentRepo, loadTags]
  )

  const handleCheckoutTag = useCallback(
    async (name: string) => {
      if (!currentRepo) return
      if (!confirm(`Checkout tag "${name}"? This will put you in detached HEAD state.`)) return
      try {
        const result = await window.electronAPI.git.checkout(currentRepo, name)
        if (!result.success) {
          alert(`Failed to checkout tag: ${result.error}`)
        }
      } catch {
        // ignore
      }
    },
    [currentRepo]
  )

  const handlePushTag = useCallback(
    async (name: string) => {
      if (!currentRepo) return
      try {
        const result = await window.electronAPI.git.pushTag(currentRepo, name)
        if (!result.success) {
          alert(`Failed to push tag: ${result.error}`)
        }
      } catch {
        // ignore
      }
    },
    [currentRepo]
  )

  const handleNewTagSubmit = useCallback(async () => {
    if (!currentRepo || !newTagDialog.name.trim()) return
    setNewTagDialog((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const target = newTagDialog.target.trim() || undefined
      const message = newTagDialog.message.trim() || undefined
      const result = await window.electronAPI.git.createTag(
        currentRepo,
        newTagDialog.name.trim(),
        target,
        message ? { message } : undefined
      )
      if (result.success) {
        setNewTagDialog({
          open: false,
          name: '',
          target: 'HEAD',
          message: '',
          error: null,
          loading: false
        })
        loadTags()
      } else {
        setNewTagDialog((prev) => ({
          ...prev,
          error: result.error || 'Failed to create tag',
          loading: false
        }))
      }
    } catch {
      setNewTagDialog((prev) => ({
        ...prev,
        error: 'Unexpected error',
        loading: false
      }))
    }
  }, [currentRepo, newTagDialog.name, newTagDialog.target, newTagDialog.message, loadTags])

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - d.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
      if (diffDays === 0) return 'today'
      if (diffDays === 1) return 'yesterday'
      if (diffDays < 30) return `${diffDays}d ago`
      if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`
      return `${Math.floor(diffDays / 365)}y ago`
    } catch {
      return ''
    }
  }

  return (
    <>
      <SidebarSection
        title="Tags"
        icon={<Tag size={16} />}
        defaultOpen={false}
        count={tags.length}
        headerAction={
          currentRepo ? (
            <button
              className={styles.sectionAddBtn}
              title="New Tag"
              onClick={(e) => {
                e.stopPropagation()
                setNewTagDialog((prev) => ({ ...prev, open: true }))
              }}
            >
              +
            </button>
          ) : undefined
        }
      >
        {!currentRepo ? (
          <div className={styles.placeholder}>No repository open</div>
        ) : tags.length === 0 ? (
          <div className={styles.placeholder}>No tags</div>
        ) : (
          <div className={styles.branchList}>
            {tags.length > 5 && (
              <input
                className={styles.branchFilter}
                type="text"
                placeholder="Filter tags..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            {filteredTags.length === 0 ? (
              <div className={styles.placeholder}>No matching tags</div>
            ) : (
              filteredTags.map((tag) => (
                <div
                  key={tag.name}
                  className={styles.tagItem}
                  title={
                    tag.isAnnotated
                      ? `${tag.name} (annotated)\n${tag.message}`
                      : `${tag.name} (lightweight)`
                  }
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent('graph:scroll-to-commit', { detail: { hash: tag.hash } })
                    )
                  }}
                  onContextMenu={(e) => handleContextMenu(e, tag)}
                >
                  <span className={styles.tagIcon}>
                    {tag.isAnnotated ? <Tag size={14} /> : <Bookmark size={14} />}
                  </span>
                  <span className={styles.tagName}>{tag.name}</span>
                  {tag.taggerDate && (
                    <span className={styles.tagDate}>{formatDate(tag.taggerDate)}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </SidebarSection>

      {/* Tag Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { key: 'checkout', label: 'Checkout tag', icon: <Check size={14} />, onClick: () => handleCheckoutTag(contextMenu.tag.name) },
            { key: 'sep1', separator: true },
            { key: 'push', label: 'Push tag', icon: <ArrowUpFromLine size={14} />, onClick: () => handlePushTag(contextMenu.tag.name) },
            { key: 'delete', label: 'Delete tag', icon: <Trash2 size={14} />, danger: true, onClick: () => handleDelete(contextMenu.tag.name) },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* New Tag Dialog */}
      {newTagDialog.open && (
        <div className="branch-dialog-overlay" onClick={() => setNewTagDialog((prev) => ({ ...prev, open: false }))}>
          <div className="branch-dialog" onClick={(e) => e.stopPropagation()}>
            <h3>New Tag</h3>
            <div className="branch-dialog-field">
              <label>Name</label>
              <input
                type="text"
                placeholder="v1.0.0"
                value={newTagDialog.name}
                onChange={(e) =>
                  setNewTagDialog((prev) => ({ ...prev, name: e.target.value, error: null }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !newTagDialog.loading) handleNewTagSubmit()
                }}
                autoFocus
              />
            </div>
            <div className="branch-dialog-field">
              <label>Target commit (defaults to HEAD)</label>
              <input
                type="text"
                placeholder="HEAD"
                value={newTagDialog.target}
                onChange={(e) =>
                  setNewTagDialog((prev) => ({ ...prev, target: e.target.value }))
                }
              />
            </div>
            <div className="branch-dialog-field">
              <label>Message (for annotated tag, leave empty for lightweight)</label>
              <textarea
                placeholder="Release message..."
                value={newTagDialog.message}
                onChange={(e) =>
                  setNewTagDialog((prev) => ({ ...prev, message: e.target.value }))
                }
                rows={3}
                style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 'inherit' }}
              />
            </div>
            {newTagDialog.error && (
              <div className="branch-dialog-error">{newTagDialog.error}</div>
            )}
            <div className="branch-dialog-actions">
              <button
                className="branch-dialog-btn branch-dialog-cancel"
                onClick={() => setNewTagDialog((prev) => ({ ...prev, open: false }))}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-submit"
                disabled={!newTagDialog.name.trim() || newTagDialog.loading}
                onClick={handleNewTagSubmit}
              >
                {newTagDialog.loading ? 'Creating...' : 'Create Tag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ─── StashesSection ─────────────────────────────────────────────────────────

interface StashesSectionProps {
  currentRepo: string | null
}

interface GitStash {
  index: number
  message: string
  hash: string
  date: string
}

interface StashContextMenuState {
  x: number
  y: number
  stash: GitStash
}

interface StashDialogState {
  open: boolean
  message: string
  includeUntracked: boolean
  loading: boolean
  error: string | null
}

function StashesSection({ currentRepo }: StashesSectionProps): React.JSX.Element {
  const [stashes, setStashes] = useState<GitStash[]>([])
  const [contextMenu, setContextMenu] = useState<StashContextMenuState | null>(null)
  const [selectedStash, setSelectedStash] = useState<GitStash | null>(null)
  const [stashDiff, setStashDiff] = useState<string | null>(null)
  const [stashDialog, setStashDialog] = useState<StashDialogState>({
    open: false,
    message: '',
    includeUntracked: false,
    loading: false,
    error: null
  })
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadStashes = useCallback(async () => {
    if (!currentRepo) {
      setStashes([])
      return
    }
    try {
      const result = await window.electronAPI.git.getStashes(currentRepo)
      if (result.success && result.data) {
        setStashes(result.data)
      }
    } catch {
      // ignore
    }
  }, [currentRepo])

  useEffect(() => {
    loadStashes()

    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(loadStashes, 1000)
    })

    return () => {
      cleanup?.()
      if (timer) clearTimeout(timer)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [loadStashes])

  const handleStashClick = useCallback(
    async (stash: GitStash) => {
      if (!currentRepo) return
      setSelectedStash(stash)
      setStashDiff(null)
      try {
        const result = await window.electronAPI.git.stashShow(currentRepo, stash.index)
        if (result.success && result.data) {
          setStashDiff(result.data)
        } else {
          setStashDiff('Failed to load stash diff')
        }
      } catch {
        setStashDiff('Failed to load stash diff')
      }
    },
    [currentRepo]
  )

  const handleStashContextMenu = useCallback((e: React.MouseEvent, stash: GitStash) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, stash })
  }, [])

  const handleApply = useCallback(
    async (index: number) => {
      if (!currentRepo) return
      const result = await window.electronAPI.git.stashApply(currentRepo, index)
      if (!result.success) {
        alert(`Failed to apply stash: ${result.error}`)
      }
      loadStashes()
      setContextMenu(null)
    },
    [currentRepo, loadStashes]
  )

  const handlePop = useCallback(
    async (index: number) => {
      if (!currentRepo) return
      const result = await window.electronAPI.git.stashPop(currentRepo, index)
      if (!result.success) {
        alert(`Failed to pop stash: ${result.error}`)
      }
      loadStashes()
      setContextMenu(null)
    },
    [currentRepo, loadStashes]
  )

  const handleDrop = useCallback(
    async (index: number) => {
      if (!currentRepo) return
      if (!confirm(`Drop stash@{${index}}? This cannot be undone.`)) return
      const result = await window.electronAPI.git.stashDrop(currentRepo, index)
      if (!result.success) {
        alert(`Failed to drop stash: ${result.error}`)
      }
      if (selectedStash?.index === index) {
        setSelectedStash(null)
        setStashDiff(null)
      }
      loadStashes()
      setContextMenu(null)
    },
    [currentRepo, loadStashes, selectedStash]
  )

  const openStashDialog = useCallback(() => {
    setStashDialog({
      open: true,
      message: '',
      includeUntracked: false,
      loading: false,
      error: null
    })
  }, [])

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
        loadStashes()
      } else {
        setStashDialog((prev) => ({ ...prev, loading: false, error: result.error || 'Failed to stash' }))
      }
    } catch {
      setStashDialog((prev) => ({ ...prev, loading: false, error: 'Failed to stash' }))
    }
  }, [currentRepo, stashDialog.message, stashDialog.includeUntracked, closeStashDialog, loadStashes])

  const formatRelativeDate = useCallback((dateStr: string) => {
    if (!dateStr) return ''
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`
      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`
      const diffDays = Math.floor(diffHours / 24)
      if (diffDays < 30) return `${diffDays}d ago`
      const diffMonths = Math.floor(diffDays / 30)
      return `${diffMonths}mo ago`
    } catch {
      return ''
    }
  }, [])

  return (
    <>
      <SidebarSection
        title="Stashes"
        icon={<Archive size={16} />}
        defaultOpen={false}
        count={stashes.length}
        headerAction={
          currentRepo ? (
            <button
              className={styles.sectionActionBtn}
              title="Stash changes"
              onClick={(e) => {
                e.stopPropagation()
                openStashDialog()
              }}
            >
              +
            </button>
          ) : undefined
        }
      >
        {!currentRepo ? (
          <div className={styles.placeholder}>No repository open</div>
        ) : stashes.length === 0 ? (
          <div className={styles.placeholder}>No stashes</div>
        ) : (
          <div className={styles.stashList}>
            {stashes.map((stash) => (
              <div
                key={stash.hash}
                className={`${styles.stashItem} ${selectedStash?.index === stash.index ? styles.stashItemSelected : ''}`}
                onClick={() => handleStashClick(stash)}
                onContextMenu={(e) => handleStashContextMenu(e, stash)}
                title={`stash@{${stash.index}}: ${stash.message}`}
              >
                <span className={styles.stashIcon}><Archive size={14} /></span>
                <div className={styles.stashInfo}>
                  <span className={styles.stashMessage}>
                    {stash.message || `stash@{${stash.index}}`}
                  </span>
                  <span className={styles.stashDate}>
                    {formatRelativeDate(stash.date)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </SidebarSection>

      {/* Stash Diff Viewer */}
      {selectedStash && stashDiff !== null && (
        <div className={styles.stashDiffOverlay} onClick={() => { setSelectedStash(null); setStashDiff(null) }}>
          <div className={styles.stashDiffPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.stashDiffHeader}>
              <span>stash@&#123;{selectedStash.index}&#125;: {selectedStash.message}</span>
              <button className={styles.stashDiffClose} onClick={() => { setSelectedStash(null); setStashDiff(null) }}><X size={14} /></button>
            </div>
            <pre className={styles.stashDiffContent}>{stashDiff}</pre>
          </div>
        </div>
      )}

      {/* Stash Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            { key: 'apply', label: 'Apply', icon: <CornerRightUp size={14} />, onClick: () => handleApply(contextMenu.stash.index) },
            { key: 'pop', label: 'Pop', icon: <CornerUpRight size={14} />, onClick: () => handlePop(contextMenu.stash.index) },
            { key: 'sep1', separator: true },
            { key: 'drop', label: 'Drop', icon: <Trash2 size={14} />, danger: true, onClick: () => handleDrop(contextMenu.stash.index) },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Stash Save Dialog */}
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
    </>
  )
}

// ─── SubmodulesSection ──────────────────────────────────────────────────────

interface SubmodulesSectionProps {
  currentRepo: string | null
}

interface GitSubmodule {
  name: string
  path: string
  url: string
  status: 'initialized' | 'uninitialized' | 'dirty' | 'out-of-date'
  hash: string
  describe: string
}

interface SubmoduleContextMenuState {
  x: number
  y: number
  submodule: GitSubmodule
}

function SubmodulesSection({ currentRepo }: SubmodulesSectionProps): React.JSX.Element | null {
  const [submodules, setSubmodules] = useState<GitSubmodule[]>([])
  const [contextMenu, setContextMenu] = useState<SubmoduleContextMenuState | null>(null)
  const [loading, setLoading] = useState(false)
  // contextMenuRef removed — ContextMenu component manages its own ref

  const loadSubmodules = useCallback(async () => {
    if (!currentRepo) {
      setSubmodules([])
      return
    }
    try {
      const result = await window.electronAPI.git.getSubmodules(currentRepo)
      if (result.success) {
        setSubmodules(result.data)
      }
    } catch {
      // Silently fail
    }
  }, [currentRepo])

  useEffect(() => {
    loadSubmodules()
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(loadSubmodules, 2000)
    })
    return () => {
      cleanup?.()
      if (timer) clearTimeout(timer)
    }
  }, [loadSubmodules])

  const handleInitUpdate = useCallback(
    async (submodule: GitSubmodule) => {
      if (!currentRepo) return
      setLoading(true)
      try {
        if (submodule.status === 'uninitialized') {
          await window.electronAPI.git.submoduleInit(currentRepo, submodule.path)
        }
        await window.electronAPI.git.submoduleUpdate(currentRepo, submodule.path)
        await loadSubmodules()
      } catch {
        // Silently fail
      } finally {
        setLoading(false)
      }
    },
    [currentRepo, loadSubmodules]
  )

  const handleOpenInNewWindow = useCallback(
    async (submodule: GitSubmodule) => {
      if (!currentRepo) return
      // Build the submodule absolute path
      const separator = currentRepo.includes('\\') ? '\\' : '/'
      const subPath = currentRepo.endsWith(separator)
        ? currentRepo + submodule.path
        : currentRepo + separator + submodule.path

      // Ensure submodule is initialized before opening
      try {
        await window.electronAPI.git.submoduleUpdate(currentRepo, submodule.path)
      } catch {
        // ignore
      }

      // Trigger a custom event that App can listen to for opening the submodule repo
      window.dispatchEvent(
        new CustomEvent('open-repo', { detail: { path: subPath } })
      )
    },
    [currentRepo]
  )

  const statusIcon = (status: GitSubmodule['status']): React.ReactNode => {
    switch (status) {
      case 'initialized':
        return <Check size={12} />
      case 'uninitialized':
        return <Circle size={12} />
      case 'dirty':
        return <CircleDot size={12} />
      case 'out-of-date':
        return <ArrowDown size={12} />
      default:
        return '?'
    }
  }

  const statusColor = (status: GitSubmodule['status']): string => {
    switch (status) {
      case 'initialized':
        return 'var(--success)'
      case 'uninitialized':
        return 'var(--text-muted)'
      case 'dirty':
        return 'var(--warning)'
      case 'out-of-date':
        return 'var(--info)'
      default:
        return 'var(--text-muted)'
    }
  }

  // Render the section wrapper even when empty so the expanded sidebar
  // mirrors the collapsed icon rail (which always shows the Submodules
  // entry). Previously this returned null on empty, causing the expanded
  // view to silently omit a menu the user could see in the icon rail.
  const hasSubmodules = submodules.length > 0

  return (
    <>
      <SidebarSection title="Submodules" icon={<Package size={16} />} defaultOpen={hasSubmodules} count={submodules.length}>
        {!hasSubmodules ? (
          <div className={styles.placeholder}>
            {currentRepo ? 'No submodules' : 'No repository open'}
          </div>
        ) : (
        <div className={styles.list}>
          {submodules.map((sm) => (
            <div
              key={sm.path}
              className={`${styles.listItem} ${styles.submoduleItem}`}
              onContextMenu={(e) => {
                e.preventDefault()
                setContextMenu({ x: e.clientX, y: e.clientY, submodule: sm })
              }}
              title={`${sm.path}\nURL: ${sm.url}\nStatus: ${sm.status}${sm.hash ? '\nCommit: ' + sm.hash.slice(0, 8) : ''}`}
            >
              <span
                className={styles.submoduleStatus}
                style={{ color: statusColor(sm.status) }}
              >
                {statusIcon(sm.status)}
              </span>
              <span className={styles.submoduleName}>{sm.path}</span>
              <span className={styles.submoduleBadge} data-status={sm.status}>
                {sm.status}
              </span>
            </div>
          ))}
        </div>
        )}
      </SidebarSection>

      {/* Submodule Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={(() => {
            const items: ContextMenuEntry[] = []
            const sm = contextMenu.submodule
            if (sm.status === 'uninitialized' || sm.status === 'out-of-date') {
              items.push({
                key: 'init-update',
                label: sm.status === 'uninitialized' ? 'Init & Update' : 'Update',
                icon: <Download size={14} />,
                disabled: loading,
                onClick: () => handleInitUpdate(sm)
              })
            }
            if (sm.status !== 'uninitialized') {
              items.push({ key: 'update', label: 'Update', icon: <RefreshCw size={14} />, disabled: loading, onClick: () => handleInitUpdate(sm) })
            }
            items.push({ key: 'sep1', separator: true })
            items.push({ key: 'open', label: 'Open as Repository', icon: <ExternalLink size={14} />, onClick: () => handleOpenInNewWindow(sm) })
            return items
          })()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  )
}

// ─── PullRequestsSection ────────────────────────────────────────────────────

interface GitHubPR {
  number: number
  title: string
  state: string
  author: string
  authorAvatar: string
  createdAt: string
  updatedAt: string
  headBranch: string
  baseBranch: string
  draft: boolean
  htmlUrl: string
  body: string
  labels: { name: string; color: string }[]
  reviewStatus: string
  mergeable: boolean | null
  additions: number
  deletions: number
  changedFiles: number
}

interface GitHubPRDetail extends GitHubPR {
  comments: { id: number; author: string; authorAvatar: string; body: string; createdAt: string }[]
  reviews: { id: number; author: string; authorAvatar: string; state: string; body: string; submittedAt: string }[]
  files: { filename: string; status: string; additions: number; deletions: number; changes: number }[]
}

interface CreatePRDialogState {
  open: boolean
  title: string
  body: string
  head: string
  base: string
  draft: boolean
  loading: boolean
  error: string | null
}

interface PullRequestsSectionProps {
  currentRepo: string | null
}

function PullRequestsSection({ currentRepo }: PullRequestsSectionProps): React.JSX.Element | null {
  const [prs, setPrs] = useState<GitHubPR[]>([])
  const [loading, setLoading] = useState(false)
  const [ghInfo, setGhInfo] = useState<{ owner: string; repo: string } | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [selectedPR, setSelectedPR] = useState<GitHubPRDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [filterState, setFilterState] = useState<'open' | 'closed'>('open')
  const [createDialog, setCreateDialog] = useState<CreatePRDialogState>({
    open: false, title: '', body: '', head: '', base: 'main', draft: false, loading: false, error: null
  })
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [createdPR, setCreatedPR] = useState<{ number: number; htmlUrl: string } | null>(null)

  // Check if repo is GitHub and user is logged in
  useEffect(() => {
    if (!currentRepo) {
      setGhInfo(null)
      setPrs([])
      return
    }
    let cancelled = false
    const check = async (): Promise<void> => {
      const [loginRes, parseRes] = await Promise.all([
        window.electronAPI.github.isLoggedIn(),
        window.electronAPI.github.parseRemote(currentRepo)
      ])
      if (cancelled) return
      setIsLoggedIn(!!loginRes.data)
      if (parseRes.success && parseRes.data) {
        setGhInfo(parseRes.data as { owner: string; repo: string })
      } else {
        setGhInfo(null)
      }
    }
    check()
    return () => { cancelled = true }
  }, [currentRepo])

  // Load PRs when ghInfo available and logged in
  const loadPRs = useCallback(async () => {
    if (!ghInfo || !isLoggedIn) return
    setLoading(true)
    try {
      const result = await window.electronAPI.github.listPullRequests(ghInfo.owner, ghInfo.repo, filterState)
      if (result.success && Array.isArray(result.data)) {
        setPrs(result.data as GitHubPR[])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [ghInfo, isLoggedIn, filterState])

  useEffect(() => {
    loadPRs()
  }, [loadPRs])

  // Load branches for create dialog
  useEffect(() => {
    if (!currentRepo) return
    const load = async (): Promise<void> => {
      const result = await window.electronAPI.git.getBranches(currentRepo)
      if (result.success && Array.isArray(result.data)) {
        const branchNames = result.data.map((b: { name: string; current: boolean }) => {
          if (b.current) setCurrentBranch(b.name)
          return b.name
        })
        setBranches(branchNames)
      }
    }
    load()
  }, [currentRepo])

  const handlePRClick = useCallback(async (pr: GitHubPR) => {
    if (!ghInfo) return
    if (selectedPR?.number === pr.number) {
      setSelectedPR(null)
      return
    }
    setDetailLoading(true)
    setSelectedPR(null)
    try {
      const result = await window.electronAPI.github.getPullRequest(ghInfo.owner, ghInfo.repo, pr.number)
      if (result.success && result.data) {
        setSelectedPR(result.data as GitHubPRDetail)
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false)
    }
  }, [ghInfo, selectedPR])

  const openCreateDialog = useCallback(() => {
    setCreateDialog({
      open: true,
      title: '',
      body: '',
      head: currentBranch,
      base: 'main',
      draft: false,
      loading: false,
      error: null
    })
    setCreatedPR(null)
  }, [currentBranch])

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(prev => ({ ...prev, open: false }))
    if (createdPR) {
      loadPRs()
      setCreatedPR(null)
    }
  }, [createdPR, loadPRs])

  const handleCreatePR = useCallback(async () => {
    if (!ghInfo || !createDialog.title.trim()) return
    setCreateDialog(prev => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.github.createPullRequest(
        ghInfo.owner, ghInfo.repo,
        {
          title: createDialog.title,
          body: createDialog.body,
          head: createDialog.head,
          base: createDialog.base,
          draft: createDialog.draft
        }
      )
      if (result.success && result.data) {
        const data = result.data as { number: number; htmlUrl: string }
        setCreatedPR(data)
        setCreateDialog(prev => ({ ...prev, loading: false }))
      } else {
        setCreateDialog(prev => ({ ...prev, loading: false, error: result.error || 'Failed to create PR' }))
      }
    } catch (err) {
      setCreateDialog(prev => ({ ...prev, loading: false, error: 'Failed to create pull request' }))
    }
  }, [ghInfo, createDialog.title, createDialog.body, createDialog.head, createDialog.base, createDialog.draft])

  const openInBrowser = useCallback((url: string) => {
    window.open(url, '_blank')
  }, [])

  // Always render the Pull Requests section so the expanded sidebar
  // mirrors the collapsed icon rail. When the current repo has no GitHub
  // remote we still show the section with a helpful "Not a GitHub repo"
  // placeholder instead of hiding it entirely.

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <>
      <SidebarSection
        title="Pull Requests"
        icon={<GitBranch size={16} />}
        defaultOpen={!!ghInfo}
        count={ghInfo ? prs.length : undefined}
        headerAction={
          ghInfo && isLoggedIn ? (
            <button
              className={styles.sectionActionBtn}
              title="Create Pull Request"
              onClick={(e) => { e.stopPropagation(); openCreateDialog() }}
            >+</button>
          ) : undefined
        }
      >
        {!ghInfo ? (
          <div className={styles.placeholder}>
            {currentRepo ? 'Not a GitHub repository' : 'No repository open'}
          </div>
        ) : !isLoggedIn ? (
          <div className={styles.prLoginHint}>
            Log in to GitHub in Settings to view pull requests.
          </div>
        ) : (
          <>
            <div className={styles.prFilterRow}>
              <button
                className={`${styles.prFilterBtn} ${filterState === 'open' ? styles.prFilterBtnActive : ''}`}
                onClick={() => setFilterState('open')}
              >
                <Circle size={12} /> Open
              </button>
              <button
                className={`${styles.prFilterBtn} ${filterState === 'closed' ? styles.prFilterBtnActive : ''}`}
                onClick={() => setFilterState('closed')}
              >
                <Check size={12} /> Closed
              </button>
              <button
                className={styles.prRefreshBtn}
                onClick={loadPRs}
                disabled={loading}
                title="Refresh"
              >
                <RefreshCw size={12} className={loading ? styles.prSpinning : ''} />
              </button>
            </div>
            {loading && prs.length === 0 ? (
              <SkeletonList count={3} />
            ) : prs.length === 0 ? (
              <div className={styles.prEmpty}>No {filterState} pull requests</div>
            ) : (
              <div className={styles.prList}>
                {prs.map(pr => (
                  <div
                    key={pr.number}
                    className={`${styles.prItem} ${selectedPR?.number === pr.number ? styles.prItemSelected : ''}`}
                    onClick={() => handlePRClick(pr)}
                    tabIndex={0}
                    role="button"
                  >
                    <div className={styles.prItemHeader}>
                      <span className={`${styles.prNumber}`}>#{pr.number}</span>
                      <span className={styles.prTitle} title={pr.title}>{pr.title}</span>
                    </div>
                    <div className={styles.prItemMeta}>
                      <span className={styles.prAuthor}>{pr.author}</span>
                      <span className={styles.prTime}>{timeAgo(pr.updatedAt)}</span>
                      {pr.draft && <span className={styles.prDraftBadge}>Draft</span>}
                      {pr.labels.slice(0, 2).map(l => (
                        <span
                          key={l.name}
                          className={styles.prLabel}
                          style={{ backgroundColor: `#${l.color}20`, color: `#${l.color}`, borderColor: `#${l.color}40` }}
                        >{l.name}</span>
                      ))}
                    </div>
                    <div className={styles.prBranches}>
                      <span className={styles.prBranchName}>{pr.headBranch}</span>
                      <span className={styles.prBranchArrow}>→</span>
                      <span className={styles.prBranchName}>{pr.baseBranch}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SidebarSection>

      {/* PR Detail Overlay */}
      {(selectedPR || detailLoading) && (
        <div className={styles.prDetailOverlay} onClick={() => { setSelectedPR(null); setDetailLoading(false) }}>
          <div className={styles.prDetailPanel} onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className={styles.prDetailLoading}>
                <RefreshCw size={20} className={styles.prSpinning} />
                <span>Loading PR details...</span>
              </div>
            ) : selectedPR ? (
              <>
                <div className={styles.prDetailHeader}>
                  <div className={styles.prDetailTitleRow}>
                    <span className={styles.prDetailNumber}>#{selectedPR.number}</span>
                    <h3 className={styles.prDetailTitle}>{selectedPR.title}</h3>
                    <button className={styles.prDetailClose} onClick={() => setSelectedPR(null)}><X size={16} /></button>
                  </div>
                  <div className={styles.prDetailMetaRow}>
                    <span className={`${styles.prStateBadge} ${selectedPR.state === 'open' ? styles.prStateBadgeOpen : styles.prStateBadgeClosed}`}>
                      {selectedPR.state === 'open' ? <Circle size={12} /> : <Check size={12} />} {selectedPR.state}
                    </span>
                    <span>{selectedPR.author} wants to merge</span>
                    <span className={styles.prBranchName}>{selectedPR.headBranch}</span>
                    <span>into</span>
                    <span className={styles.prBranchName}>{selectedPR.baseBranch}</span>
                  </div>
                  <div className={styles.prDetailStats}>
                    <span className={styles.prStatAdd}>+{selectedPR.additions}</span>
                    <span className={styles.prStatDel}>-{selectedPR.deletions}</span>
                    <span>{selectedPR.changedFiles} files</span>
                    <button className={styles.prOpenBrowser} onClick={() => openInBrowser(selectedPR.htmlUrl)}>
                      <ExternalLink size={12} /> Open in Browser
                    </button>
                  </div>
                </div>

                {selectedPR.body && (
                  <div className={styles.prDetailBody}>
                    <h4>Description</h4>
                    <pre className={styles.prBodyText}>{selectedPR.body}</pre>
                  </div>
                )}

                {/* Reviews */}
                {selectedPR.reviews.length > 0 && (
                  <div className={styles.prDetailSection}>
                    <h4>Reviews ({selectedPR.reviews.length})</h4>
                    {selectedPR.reviews.map(r => (
                      <div key={r.id} className={styles.prReviewItem}>
                        <span className={`${styles.prReviewState} ${styles[`prReview_${r.state}`] || ''}`}>
                          {r.state === 'APPROVED' ? <Check size={12} /> : <Circle size={12} />} {r.state.toLowerCase().replace('_', ' ')}
                        </span>
                        <span className={styles.prReviewAuthor}>{r.author}</span>
                        {r.body && <p className={styles.prReviewBody}>{r.body}</p>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Comments */}
                {selectedPR.comments.length > 0 && (
                  <div className={styles.prDetailSection}>
                    <h4>Comments ({selectedPR.comments.length})</h4>
                    {selectedPR.comments.map(c => (
                      <div key={c.id} className={styles.prCommentItem}>
                        <div className={styles.prCommentHeader}>
                          <span className={styles.prCommentAuthor}>{c.author}</span>
                          <span className={styles.prCommentTime}>{timeAgo(c.createdAt)}</span>
                        </div>
                        <p className={styles.prCommentBody}>{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Files Changed */}
                {selectedPR.files.length > 0 && (
                  <div className={styles.prDetailSection}>
                    <h4>Files Changed ({selectedPR.files.length})</h4>
                    <div className={styles.prFileList}>
                      {selectedPR.files.map(f => (
                        <div key={f.filename} className={styles.prFileItem}>
                          <span className={`${styles.prFileStatus} ${styles[`prFileStatus_${f.status}`] || ''}`}>
                            {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                          </span>
                          <span className={styles.prFileName}>{f.filename}</span>
                          <span className={styles.prFileStats}>
                            {f.additions > 0 && <span className={styles.prStatAdd}>+{f.additions}</span>}
                            {f.deletions > 0 && <span className={styles.prStatDel}>-{f.deletions}</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Create PR Dialog */}
      {createDialog.open && (
        <div className={styles.prCreateOverlay} onClick={closeCreateDialog}>
          <div className={styles.prCreateDialog} onClick={(e) => e.stopPropagation()}>
            {createdPR ? (
              <div className={styles.prCreatedSuccess}>
                <Check size={32} className={styles.prCreatedIcon} />
                <h3>Pull Request Created!</h3>
                <p>PR #{createdPR.number} has been created successfully.</p>
                <button className={styles.prOpenBrowser} onClick={() => openInBrowser(createdPR.htmlUrl)}>
                  <ExternalLink size={14} /> Open in Browser
                </button>
                <button className={styles.prCreateCloseBtn} onClick={closeCreateDialog}>Close</button>
              </div>
            ) : (
              <>
                <h3 className={styles.prCreateTitle}>Create Pull Request</h3>
                <div className={styles.prCreateField}>
                  <label>Title</label>
                  <input
                    type="text"
                    value={createDialog.title}
                    onChange={(e) => setCreateDialog(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Pull request title"
                    autoFocus
                  />
                </div>
                <div className={styles.prCreateField}>
                  <label>Description</label>
                  <textarea
                    value={createDialog.body}
                    onChange={(e) => setCreateDialog(prev => ({ ...prev, body: e.target.value }))}
                    placeholder="Describe your changes..."
                    rows={4}
                  />
                </div>
                <div className={styles.prCreateBranches}>
                  <div className={styles.prCreateField}>
                    <label>Head branch (source)</label>
                    <select
                      value={createDialog.head}
                      onChange={(e) => setCreateDialog(prev => ({ ...prev, head: e.target.value }))}
                    >
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <span className={styles.prCreateArrow}>→</span>
                  <div className={styles.prCreateField}>
                    <label>Base branch (target)</label>
                    <select
                      value={createDialog.base}
                      onChange={(e) => setCreateDialog(prev => ({ ...prev, base: e.target.value }))}
                    >
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                <label className={styles.prCreateCheckbox}>
                  <input
                    type="checkbox"
                    checked={createDialog.draft}
                    onChange={(e) => setCreateDialog(prev => ({ ...prev, draft: e.target.checked }))}
                  />
                  Create as draft
                </label>
                {createDialog.error && (
                  <div className={styles.prCreateError}>
                    <AlertTriangle size={14} /> {createDialog.error}
                  </div>
                )}
                <div className={styles.prCreateActions}>
                  <button className={styles.prCreateCancelBtn} onClick={closeCreateDialog}>Cancel</button>
                  <button
                    className={styles.prCreateSubmitBtn}
                    onClick={handleCreatePR}
                    disabled={createDialog.loading || !createDialog.title.trim()}
                  >
                    {createDialog.loading ? (
                      <><RefreshCw size={14} className={styles.prSpinning} /> Creating...</>
                    ) : 'Create Pull Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── MergeRequestsSection (GitLab) ─────────────────────────────────────────

interface GitLabMR {
  iid: number
  title: string
  state: string
  author: string
  authorAvatar: string
  createdAt: string
  updatedAt: string
  sourceBranch: string
  targetBranch: string
  draft: boolean
  webUrl: string
  description: string
  labels: { name: string }[]
  mergeStatus: string
  hasConflicts: boolean
  userNotesCount: number
}

interface GitLabMRDetail extends GitLabMR {
  notes: { id: number; author: string; authorAvatar: string; body: string; createdAt: string }[]
  files: { filename: string; status: string; additions: number; deletions: number; changes: number }[]
}

interface CreateMRDialogState {
  open: boolean
  title: string
  description: string
  sourceBranch: string
  targetBranch: string
  loading: boolean
  error: string | null
}

interface MergeRequestsSectionProps {
  currentRepo: string | null
}

function MergeRequestsSection({ currentRepo }: MergeRequestsSectionProps): React.JSX.Element | null {
  const [mrs, setMrs] = useState<GitLabMR[]>([])
  const [loading, setLoading] = useState(false)
  const [glInfo, setGlInfo] = useState<{ projectPath: string; webUrl: string; instanceUrl: string } | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [selectedMR, setSelectedMR] = useState<GitLabMRDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [filterState, setFilterState] = useState<'open' | 'closed'>('open')
  const [createDialog, setCreateDialog] = useState<CreateMRDialogState>({
    open: false, title: '', description: '', sourceBranch: '', targetBranch: 'main', loading: false, error: null
  })
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [createdMR, setCreatedMR] = useState<{ iid: number; webUrl: string } | null>(null)

  // Check if repo is GitLab and user is logged in
  useEffect(() => {
    if (!currentRepo) {
      setGlInfo(null)
      setMrs([])
      return
    }
    let cancelled = false
    const check = async (): Promise<void> => {
      const [loginRes, parseRes] = await Promise.all([
        window.electronAPI.gitlab.isLoggedIn(),
        window.electronAPI.gitlab.parseRemote(currentRepo)
      ])
      if (cancelled) return
      setIsLoggedIn(!!loginRes.data)
      if (parseRes.success && parseRes.data) {
        setGlInfo(parseRes.data as { projectPath: string; webUrl: string; instanceUrl: string })
      } else {
        setGlInfo(null)
      }
    }
    check()
    return () => { cancelled = true }
  }, [currentRepo])

  // Load MRs when glInfo available and logged in
  const loadMRs = useCallback(async () => {
    if (!glInfo || !isLoggedIn) return
    setLoading(true)
    try {
      const result = await window.electronAPI.gitlab.listMergeRequests(glInfo.projectPath, filterState, glInfo.instanceUrl)
      if (result.success && Array.isArray(result.data)) {
        setMrs(result.data as GitLabMR[])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [glInfo, isLoggedIn, filterState])

  useEffect(() => {
    loadMRs()
  }, [loadMRs])

  // Load branches for create dialog
  useEffect(() => {
    if (!currentRepo) return
    const load = async (): Promise<void> => {
      const result = await window.electronAPI.git.getBranches(currentRepo)
      if (result.success && Array.isArray(result.data)) {
        const branchNames = result.data.map((b: { name: string; current: boolean }) => {
          if (b.current) setCurrentBranch(b.name)
          return b.name
        })
        setBranches(branchNames)
      }
    }
    load()
  }, [currentRepo])

  const handleMRClick = useCallback(async (mr: GitLabMR) => {
    if (!glInfo) return
    if (selectedMR?.iid === mr.iid) {
      setSelectedMR(null)
      return
    }
    setDetailLoading(true)
    setSelectedMR(null)
    try {
      const result = await window.electronAPI.gitlab.getMergeRequest(glInfo.projectPath, mr.iid)
      if (result.success && result.data) {
        setSelectedMR(result.data as GitLabMRDetail)
      }
    } catch {
      // ignore
    } finally {
      setDetailLoading(false)
    }
  }, [glInfo, selectedMR])

  const openCreateDialog = useCallback(() => {
    setCreateDialog({
      open: true,
      title: '',
      description: '',
      sourceBranch: currentBranch,
      targetBranch: 'main',
      loading: false,
      error: null
    })
    setCreatedMR(null)
  }, [currentBranch])

  const closeCreateDialog = useCallback(() => {
    setCreateDialog(prev => ({ ...prev, open: false }))
    if (createdMR) {
      loadMRs()
      setCreatedMR(null)
    }
  }, [createdMR, loadMRs])

  const handleCreateMR = useCallback(async () => {
    if (!glInfo || !createDialog.title.trim()) return
    setCreateDialog(prev => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.gitlab.createMergeRequest(
        glInfo.projectPath,
        {
          title: createDialog.title,
          description: createDialog.description,
          sourceBranch: createDialog.sourceBranch,
          targetBranch: createDialog.targetBranch
        }
      )
      if (result.success && result.data) {
        const data = result.data as { iid: number; webUrl: string }
        setCreatedMR(data)
        setCreateDialog(prev => ({ ...prev, loading: false }))
      } else {
        setCreateDialog(prev => ({ ...prev, loading: false, error: result.error || 'Failed to create MR' }))
      }
    } catch {
      setCreateDialog(prev => ({ ...prev, loading: false, error: 'Failed to create merge request' }))
    }
  }, [glInfo, createDialog.title, createDialog.description, createDialog.sourceBranch, createDialog.targetBranch])

  const openInBrowser = useCallback((url: string) => {
    window.open(url, '_blank')
  }, [])

  // Always render the Merge Requests section so the expanded sidebar
  // mirrors the collapsed icon rail — see comment in PullRequestsSection.

  const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days}d ago`
    return new Date(dateStr).toLocaleDateString()
  }

  return (
    <>
      <SidebarSection
        title="Merge Requests"
        icon={<Gitlab size={16} />}
        defaultOpen={!!glInfo}
        count={glInfo ? mrs.length : undefined}
        headerAction={
          glInfo && isLoggedIn ? (
            <button
              className={styles.sectionActionBtn}
              title="Create Merge Request"
              onClick={(e) => { e.stopPropagation(); openCreateDialog() }}
            >+</button>
          ) : undefined
        }
      >
        {!glInfo ? (
          <div className={styles.placeholder}>
            {currentRepo ? 'Not a GitLab repository' : 'No repository open'}
          </div>
        ) : !isLoggedIn ? (
          <div className={styles.prLoginHint}>
            Log in to GitLab in Settings to view merge requests.
          </div>
        ) : (
          <>
            <div className={styles.prFilterRow}>
              <button
                className={`${styles.prFilterBtn} ${filterState === 'open' ? styles.prFilterBtnActive : ''}`}
                onClick={() => setFilterState('open')}
              >
                <Circle size={12} /> Open
              </button>
              <button
                className={`${styles.prFilterBtn} ${filterState === 'closed' ? styles.prFilterBtnActive : ''}`}
                onClick={() => setFilterState('closed')}
              >
                <Check size={12} /> Merged
              </button>
              <button
                className={styles.prRefreshBtn}
                onClick={loadMRs}
                disabled={loading}
                title="Refresh"
              >
                <RefreshCw size={12} className={loading ? styles.prSpinning : ''} />
              </button>
            </div>
            {loading && mrs.length === 0 ? (
              <SkeletonList count={3} />
            ) : mrs.length === 0 ? (
              <div className={styles.prEmpty}>No {filterState === 'open' ? 'open' : 'merged'} merge requests</div>
            ) : (
              <div className={styles.prList}>
                {mrs.map(mr => (
                  <div
                    key={mr.iid}
                    className={`${styles.prItem} ${selectedMR?.iid === mr.iid ? styles.prItemSelected : ''}`}
                    onClick={() => handleMRClick(mr)}
                    tabIndex={0}
                    role="button"
                  >
                    <div className={styles.prItemHeader}>
                      <span className={styles.prNumber}>!{mr.iid}</span>
                      <span className={styles.prTitle} title={mr.title}>{mr.title}</span>
                    </div>
                    <div className={styles.prItemMeta}>
                      <span className={styles.prAuthor}>{mr.author}</span>
                      <span className={styles.prTime}>{timeAgo(mr.updatedAt)}</span>
                      {mr.draft && <span className={styles.prDraftBadge}>Draft</span>}
                      {mr.hasConflicts && <span className={styles.prDraftBadge} style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>Conflicts</span>}
                      {mr.labels.slice(0, 2).map(l => (
                        <span
                          key={l.name}
                          className={styles.prLabel}
                          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
                        >{l.name}</span>
                      ))}
                    </div>
                    <div className={styles.prBranches}>
                      <span className={styles.prBranchName}>{mr.sourceBranch}</span>
                      <span className={styles.prBranchArrow}>→</span>
                      <span className={styles.prBranchName}>{mr.targetBranch}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </SidebarSection>

      {/* MR Detail Overlay */}
      {(selectedMR || detailLoading) && (
        <div className={styles.prDetailOverlay} onClick={() => { setSelectedMR(null); setDetailLoading(false) }}>
          <div className={styles.prDetailPanel} onClick={(e) => e.stopPropagation()}>
            {detailLoading ? (
              <div className={styles.prDetailLoading}>
                <RefreshCw size={20} className={styles.prSpinning} />
                <span>Loading MR details...</span>
              </div>
            ) : selectedMR ? (
              <>
                <div className={styles.prDetailHeader}>
                  <div className={styles.prDetailTitleRow}>
                    <span className={styles.prDetailNumber}>!{selectedMR.iid}</span>
                    <h3 className={styles.prDetailTitle}>{selectedMR.title}</h3>
                    <button className={styles.prDetailClose} onClick={() => setSelectedMR(null)}><X size={16} /></button>
                  </div>
                  <div className={styles.prDetailMetaRow}>
                    <span className={`${styles.prStateBadge} ${selectedMR.state === 'opened' ? styles.prStateBadgeOpen : styles.prStateBadgeClosed}`}>
                      {selectedMR.state === 'opened' ? <Circle size={12} /> : <Check size={12} />} {selectedMR.state}
                    </span>
                    <span>{selectedMR.author} wants to merge</span>
                    <span className={styles.prBranchName}>{selectedMR.sourceBranch}</span>
                    <span>into</span>
                    <span className={styles.prBranchName}>{selectedMR.targetBranch}</span>
                  </div>
                  <div className={styles.prDetailStats}>
                    <span>{selectedMR.files.length} files</span>
                    <span>{selectedMR.userNotesCount} comments</span>
                    <button className={styles.prOpenBrowser} onClick={() => openInBrowser(selectedMR.webUrl)}>
                      <ExternalLink size={12} /> Open in Browser
                    </button>
                  </div>
                </div>

                {selectedMR.description && (
                  <div className={styles.prDetailBody}>
                    <h4>Description</h4>
                    <pre className={styles.prBodyText}>{selectedMR.description}</pre>
                  </div>
                )}

                {/* Notes (Comments) */}
                {selectedMR.notes.length > 0 && (
                  <div className={styles.prDetailSection}>
                    <h4>Comments ({selectedMR.notes.length})</h4>
                    {selectedMR.notes.map(n => (
                      <div key={n.id} className={styles.prCommentItem}>
                        <div className={styles.prCommentHeader}>
                          <span className={styles.prCommentAuthor}>{n.author}</span>
                          <span className={styles.prCommentTime}>{timeAgo(n.createdAt)}</span>
                        </div>
                        <p className={styles.prCommentBody}>{n.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Files Changed */}
                {selectedMR.files.length > 0 && (
                  <div className={styles.prDetailSection}>
                    <h4>Files Changed ({selectedMR.files.length})</h4>
                    <div className={styles.prFileList}>
                      {selectedMR.files.map(f => (
                        <div key={f.filename} className={styles.prFileItem}>
                          <span className={`${styles.prFileStatus} ${styles[`prFileStatus_${f.status}`] || ''}`}>
                            {f.status === 'added' ? 'A' : f.status === 'removed' ? 'D' : f.status === 'renamed' ? 'R' : 'M'}
                          </span>
                          <span className={styles.prFileName}>{f.filename}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* Create MR Dialog */}
      {createDialog.open && (
        <div className={styles.prCreateOverlay} onClick={closeCreateDialog}>
          <div className={styles.prCreateDialog} onClick={(e) => e.stopPropagation()}>
            {createdMR ? (
              <div className={styles.prCreatedSuccess}>
                <Check size={32} className={styles.prCreatedIcon} />
                <h3>Merge Request Created!</h3>
                <p>MR !{createdMR.iid} has been created successfully.</p>
                <button className={styles.prOpenBrowser} onClick={() => openInBrowser(createdMR.webUrl)}>
                  <ExternalLink size={14} /> Open in Browser
                </button>
                <button className={styles.prCreateCloseBtn} onClick={closeCreateDialog}>Close</button>
              </div>
            ) : (
              <>
                <h3 className={styles.prCreateTitle}>Create Merge Request</h3>
                <div className={styles.prCreateField}>
                  <label>Title</label>
                  <input
                    type="text"
                    value={createDialog.title}
                    onChange={(e) => setCreateDialog(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="Merge request title"
                    autoFocus
                  />
                </div>
                <div className={styles.prCreateField}>
                  <label>Description</label>
                  <textarea
                    value={createDialog.description}
                    onChange={(e) => setCreateDialog(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="Describe your changes..."
                    rows={4}
                  />
                </div>
                <div className={styles.prCreateBranches}>
                  <div className={styles.prCreateField}>
                    <label>Source branch</label>
                    <select
                      value={createDialog.sourceBranch}
                      onChange={(e) => setCreateDialog(prev => ({ ...prev, sourceBranch: e.target.value }))}
                    >
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                  <span className={styles.prCreateArrow}>→</span>
                  <div className={styles.prCreateField}>
                    <label>Target branch</label>
                    <select
                      value={createDialog.targetBranch}
                      onChange={(e) => setCreateDialog(prev => ({ ...prev, targetBranch: e.target.value }))}
                    >
                      {branches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  </div>
                </div>
                {createDialog.error && (
                  <div className={styles.prCreateError}>
                    <AlertTriangle size={14} /> {createDialog.error}
                  </div>
                )}
                <div className={styles.prCreateActions}>
                  <button className={styles.prCreateCancelBtn} onClick={closeCreateDialog}>Cancel</button>
                  <button
                    className={styles.prCreateSubmitBtn}
                    onClick={handleCreateMR}
                    disabled={createDialog.loading || !createDialog.title.trim()}
                  >
                    {createDialog.loading ? (
                      <><RefreshCw size={14} className={styles.prSpinning} /> Creating...</>
                    ) : 'Create Merge Request'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ─── Sidebar (main export) ──────────────────────────────────────────────────

// ─── Icon Rail Section Definitions ──────────────────────────────────────────

type RailSection = 'branches' | 'remotes' | 'tags' | 'stashes' | 'submodules' | 'files' | 'pullrequests' | 'mergerequests'

interface RailSectionDef {
  id: RailSection
  label: string
  icon: React.ReactNode
}

const RAIL_SECTIONS: RailSectionDef[] = [
  { id: 'branches', label: 'Branches', icon: <GitBranch size={20} /> },
  { id: 'files', label: 'Files', icon: <FolderOpen size={20} /> },
  { id: 'remotes', label: 'Remotes', icon: <Globe size={20} /> },
  { id: 'tags', label: 'Tags', icon: <Tag size={20} /> },
  { id: 'stashes', label: 'Stashes', icon: <Archive size={20} /> },
  { id: 'submodules', label: 'Submodules', icon: <Package size={20} /> },
  { id: 'pullrequests', label: 'Pull Requests', icon: <GitPullRequestArrow size={20} /> },
  { id: 'mergerequests', label: 'Merge Requests', icon: <Gitlab size={20} /> }
]

export function Sidebar({ currentRepo, collapsed, onToggleCollapse }: SidebarProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<SidebarTab>('git')
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [searchFilter, setSearchFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [newBranchDialog, setNewBranchDialog] = useState<NewBranchDialogState>({
    open: false,
    name: '',
    base: '',
    checkout: true,
    error: null,
    loading: false
  })
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [mergeBranch, setMergeBranch] = useState<string | null>(null)
  const [rebaseBranch, setRebaseBranch] = useState<string | null>(null)
  const [railOverlaySection, setRailOverlaySection] = useState<RailSection | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const railRef = useRef<HTMLDivElement>(null)

  // ─── Load branches ──────────────────────────────────────────────────────

  const loadBranches = useCallback(async () => {
    if (!currentRepo) {
      setBranches([])
      return
    }
    setLoading(true)
    try {
      const result = await window.electronAPI.git.getBranches(currentRepo)
      if (result.success && Array.isArray(result.data)) {
        setBranches(result.data as GitBranch[])
      }
    } catch {
      // Ignore errors — branches stay empty
    } finally {
      setLoading(false)
    }
  }, [currentRepo])

  useEffect(() => {
    loadBranches()
  }, [loadBranches])

  // Refresh branches on repo file changes
  useEffect(() => {
    if (!currentRepo) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(loadBranches, 800)
    })
    return () => {
      cleanup()
      if (timer) clearTimeout(timer)
    }
  }, [currentRepo, loadBranches])

  // Refresh branches on graph:force-refresh (after push/fetch/pull)
  useEffect(() => {
    const handler = (): void => {
      loadBranches()
    }
    window.addEventListener('graph:force-refresh', handler)
    return () => window.removeEventListener('graph:force-refresh', handler)
  }, [loadBranches])

  // ─── Derived data ───────────────────────────────────────────────────────

  const currentBranch = branches.find((b) => b.current)?.name || ''

  // Sort: current branch pinned to top, rest alphabetical
  const sortedBranches = [...branches].sort((a, b) => {
    if (a.current) return -1
    if (b.current) return 1
    return a.name.localeCompare(b.name)
  })

  // Apply search filter
  const filteredBranches = searchFilter
    ? sortedBranches.filter((b) => b.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : sortedBranches

  // ─── Actions ────────────────────────────────────────────────────────────

  const handleCheckout = useCallback(
    async (branchName: string) => {
      if (!currentRepo) return
      const result = await window.electronAPI.git.checkout(currentRepo, branchName)
      if (result.success) {
        await loadBranches()
      }
    },
    [currentRepo, loadBranches]
  )

  const handleDoubleClick = useCallback(
    (branch: GitBranch) => {
      if (branch.current) return
      handleCheckout(branch.name)
    },
    [handleCheckout]
  )

  const handleContextMenu = useCallback((e: React.MouseEvent, branch: GitBranch) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, branch })
  }, [])

  const handleDelete = useCallback(
    async (branchName: string) => {
      if (!currentRepo) return
      // eslint-disable-next-line no-restricted-globals
      const confirmed = confirm(`Delete branch "${branchName}"?`)
      if (!confirmed) return
      const result = await window.electronAPI.git.deleteBranch(currentRepo, branchName)
      if (!result.success) {
        // Try force delete if regular delete fails (unmerged)
        const forceConfirmed = confirm(
          `Branch "${branchName}" is not fully merged.\n\nForce delete?`
        )
        if (forceConfirmed) {
          await window.electronAPI.git.deleteBranch(currentRepo, branchName, { force: true })
        }
      }
      await loadBranches()
    },
    [currentRepo, loadBranches]
  )

  const handleRenameSubmit = useCallback(
    async (newName: string) => {
      if (!currentRepo || !renameTarget) return
      const result = await window.electronAPI.git.renameBranch(currentRepo, renameTarget, newName)
      if (result.success) {
        setRenameTarget(null)
        await loadBranches()
      }
    },
    [currentRepo, renameTarget, loadBranches]
  )

  const handleMerge = useCallback(
    (branchName: string) => {
      if (!currentRepo) return
      setMergeBranch(branchName)
    },
    [currentRepo]
  )

  const handleRebase = useCallback(
    (branchName: string) => {
      if (!currentRepo) return
      setRebaseBranch(branchName)
    },
    [currentRepo]
  )

  const handlePush = useCallback(
    async (branchName: string) => {
      if (!currentRepo) return
      await window.electronAPI.git.exec(['push', 'origin', branchName], currentRepo)
    },
    [currentRepo]
  )

  // ─── New Branch Dialog handlers ─────────────────────────────────────────

  const openNewBranchDialog = useCallback(() => {
    setNewBranchDialog({
      open: true,
      name: '',
      base: '',
      checkout: true,
      error: null,
      loading: false
    })
  }, [])

  const closeNewBranchDialog = useCallback(() => {
    setNewBranchDialog((prev) => ({ ...prev, open: false }))
  }, [])

  const handleNewBranchSubmit = useCallback(async () => {
    if (!currentRepo || !newBranchDialog.name.trim()) return
    setNewBranchDialog((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const result = await window.electronAPI.git.createBranch(
        currentRepo,
        newBranchDialog.name.trim(),
        newBranchDialog.base || undefined,
        { checkout: newBranchDialog.checkout }
      )
      if (result.success) {
        closeNewBranchDialog()
        await loadBranches()
      } else {
        setNewBranchDialog((prev) => ({ ...prev, error: result.error || 'Failed to create branch', loading: false }))
      }
    } catch (err) {
      setNewBranchDialog((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : 'Failed to create branch',
        loading: false
      }))
    }
  }, [currentRepo, newBranchDialog.name, newBranchDialog.base, newBranchDialog.checkout, closeNewBranchDialog, loadBranches])

  // ─── Rail overlay close on outside click ────────────────────────────────

  useEffect(() => {
    if (!railOverlaySection) return
    const handleClick = (e: MouseEvent): void => {
      if (
        overlayRef.current && !overlayRef.current.contains(e.target as Node) &&
        railRef.current && !railRef.current.contains(e.target as Node)
      ) {
        setRailOverlaySection(null)
      }
    }
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setRailOverlaySection(null)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [railOverlaySection])

  const handleRailIconClick = useCallback((section: RailSection) => {
    setRailOverlaySection((prev) => prev === section ? null : section)
  }, [])

  // ─── Arrow key navigation helper ─────────────────────────────────────────
  const handleListKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const container = e.currentTarget
    const items = Array.from(container.querySelectorAll<HTMLElement>('[tabindex="0"]'))
    if (items.length === 0) return
    const currentIdx = items.indexOf(document.activeElement as HTMLElement)
    let nextIdx: number
    if (e.key === 'ArrowDown') {
      nextIdx = currentIdx < items.length - 1 ? currentIdx + 1 : 0
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : items.length - 1
    }
    items[nextIdx]?.focus()
  }, [])

  // ─── Render ─────────────────────────────────────────────────────────────

  const noBranches = !currentRepo

  // ─── Collapsed Icon Rail ───────────────────────────────────────────────

  if (collapsed) {
    return (
      <div className={styles.iconRail} ref={railRef}>
        <button
          className={styles.railCollapseBtn}
          onClick={onToggleCollapse}
          title="Expand Sidebar"
        >
          <PanelLeftOpen size={18} />
        </button>
        {RAIL_SECTIONS.map((section) => (
          <button
            key={section.id}
            className={`${styles.railIcon} ${railOverlaySection === section.id ? styles.railIconActive : ''}`}
            onClick={() => handleRailIconClick(section.id)}
            title={section.label}
          >
            {section.icon}
          </button>
        ))}

        {/* Floating overlay panel */}
        {railOverlaySection && (
          <div className={styles.railOverlay} ref={overlayRef}>
            <div className={styles.railOverlayHeader}>
              <span className={styles.railOverlayTitle}>
                {RAIL_SECTIONS.find((s) => s.id === railOverlaySection)?.label}
              </span>
              <button
                className={styles.railOverlayClose}
                onClick={() => setRailOverlaySection(null)}
              >
                <X size={14} />
              </button>
            </div>
            <div className={styles.railOverlayContent}>
              {railOverlaySection === 'branches' && (
                <SidebarSection
                  title="Branches"
                  icon={<GitBranch size={16} />}
                  defaultOpen={true}
                  count={branches.length}
                  headerAction={
                    currentRepo ? (
                      <button
                        className={styles.sectionAddBtn}
                        onClick={openNewBranchDialog}
                        title="New Branch"
                      >
                        +
                      </button>
                    ) : undefined
                  }
                >
                  {noBranches ? (
                    <div className={styles.placeholder}>No repository open</div>
                  ) : loading && branches.length === 0 ? (
                    <SkeletonList count={4} showIcon={true} />
                  ) : (
                    <div className={styles.branchSection}>
                      {branches.length > 5 && (
                        <div className={styles.searchBox}>
                          <input
                            type="text"
                            className={styles.searchInput}
                            placeholder="Filter branches..."
                            value={searchFilter}
                            onChange={(e) => setSearchFilter(e.target.value)}
                          />
                          {searchFilter && (
                            <button
                              className={styles.searchClear}
                              onClick={() => setSearchFilter('')}
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      )}
                      <div className={styles.branchList} onKeyDown={handleListKeyDown} role="listbox" aria-label="Branches">
                        {filteredBranches.length === 0 ? (
                          <div className={styles.placeholder}>
                            {searchFilter ? 'No matching branches' : 'No branches'}
                          </div>
                        ) : (
                          filteredBranches.map((branch) => (
                            <div
                              key={branch.name}
                              className={`${styles.branchItem} ${branch.current ? styles.branchItemCurrent : ''}`}
                              onDoubleClick={() => handleDoubleClick(branch)}
                              onContextMenu={(e) => handleContextMenu(e, branch)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleDoubleClick(branch)
                              }}
                              title={`${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}`}
                              tabIndex={0}
                              role="option"
                              aria-selected={branch.current}
                            >
                              <span className={styles.branchIndicator}>
                                {branch.current ? <CircleDot size={12} /> : ''}
                              </span>
                              <span className={styles.branchName}>{branch.name}</span>
                              {(branch.ahead > 0 || branch.behind > 0) && branch.upstream && (
                                <span className={styles.branchTracking}>
                                  {branch.ahead > 0 && (
                                    <span className={styles.branchAhead} title={`${branch.ahead} ahead`}>
                                      <ArrowUp size={10} />{branch.ahead}
                                    </span>
                                  )}
                                  {branch.behind > 0 && (
                                    <span className={styles.branchBehind} title={`${branch.behind} behind`}>
                                      <ArrowDown size={10} />{branch.behind}
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </SidebarSection>
              )}
              {railOverlaySection === 'remotes' && (
                <RemotesSection currentRepo={currentRepo} onBranchesChanged={loadBranches} />
              )}
              {railOverlaySection === 'tags' && (
                <TagsSection currentRepo={currentRepo} />
              )}
              {railOverlaySection === 'stashes' && (
                <StashesSection currentRepo={currentRepo} />
              )}
              {railOverlaySection === 'submodules' && (
                <SubmodulesSection currentRepo={currentRepo} />
              )}
              {railOverlaySection === 'pullrequests' && (
                <PullRequestsSection currentRepo={currentRepo} />
              )}
              {railOverlaySection === 'mergerequests' && (
                <MergeRequestsSection currentRepo={currentRepo} />
              )}
              {railOverlaySection === 'files' && (
                <FileTree
                  currentRepo={currentRepo}
                  onShowBlame={(filePath) => {
                    window.dispatchEvent(
                      new CustomEvent('blame:open', { detail: { filePath } })
                    )
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* Context Menu (needed for branch interactions in overlay) */}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={buildBranchContextMenuItems(contextMenu.branch, currentBranch, {
              onCheckout: handleCheckout,
              onRename: (name) => setRenameTarget(name),
              onDelete: handleDelete,
              onMerge: handleMerge,
              onRebase: handleRebase,
              onPush: handlePush,
            })}
            onClose={() => setContextMenu(null)}
          />
        )}

        {/* Dialogs (shared with expanded mode) */}
        {newBranchDialog.open && (
          <NewBranchDialog
            state={newBranchDialog}
            branches={branches}
            onClose={closeNewBranchDialog}
            onChange={(updates) => setNewBranchDialog((prev) => ({ ...prev, ...updates }))}
            onSubmit={handleNewBranchSubmit}
          />
        )}
        {renameTarget && (
          <RenameDialog
            oldName={renameTarget}
            onClose={() => setRenameTarget(null)}
            onSubmit={handleRenameSubmit}
          />
        )}
        {mergeBranch && currentRepo && (
          <MergeDialog
            currentRepo={currentRepo}
            preselectedBranch={mergeBranch}
            onClose={() => setMergeBranch(null)}
            onMergeComplete={() => {
              setMergeBranch(null)
              loadBranches()
            }}
          />
        )}
        {rebaseBranch && currentRepo && (
          <RebaseDialog
            currentRepo={currentRepo}
            preselectedBranch={rebaseBranch}
            onClose={() => setRebaseBranch(null)}
            onRebaseComplete={() => {
              setRebaseBranch(null)
              loadBranches()
            }}
          />
        )}
      </div>
    )
  }

  // ─── Expanded Sidebar ──────────────────────────────────────────────────

  return (
    <div className={styles.sidebar}>
      {/* Sticky header: collapse button + tabs */}
      <div className={styles.sidebarHeader}>
        {/* Collapse toggle button */}
        <button
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          title="Collapse Sidebar"
        >
          <PanelLeftClose size={16} />
        </button>

        {/* Sidebar Tabs */}
        <div className={styles.tabs} role="tablist">
          <button
            className={`${styles.tab} ${activeTab === 'git' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('git')}
            title="Git"
            role="tab"
            aria-selected={activeTab === 'git'}
          >
            <GitBranch size={14} /> Git
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'files' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('files')}
            title="Files"
            role="tab"
            aria-selected={activeTab === 'files'}
          >
            <FolderOpen size={14} /> Files
          </button>
        </div>
      </div>

      {/* Scrollable content area */}
      <div className={styles.sidebarScrollArea}>
        {/* File Tree Tab */}
        {activeTab === 'files' && (
          <FileTree
            currentRepo={currentRepo}
            onShowBlame={(filePath) => {
              window.dispatchEvent(
                new CustomEvent('blame:open', { detail: { filePath } })
              )
            }}
          />
        )}

        {/* Git Tab */}
        {activeTab === 'git' && (
        <>
        <SidebarSection
        title="Branches"
        icon={<GitBranch size={16} />}
        defaultOpen={true}
        count={branches.length}
        headerAction={
          currentRepo ? (
            <button
              className={styles.sectionAddBtn}
              onClick={openNewBranchDialog}
              title="New Branch"
            >
              +
            </button>
          ) : undefined
        }
      >
        {noBranches ? (
          <div className={styles.placeholder}>No repository open</div>
        ) : loading && branches.length === 0 ? (
          <SkeletonList count={4} showIcon={true} />
        ) : (
          <div className={styles.branchSection}>
            {branches.length > 5 && (
              <div className={styles.searchBox}>
                <input
                  type="text"
                  className={styles.searchInput}
                  placeholder="Filter branches..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                {searchFilter && (
                  <button
                    className={styles.searchClear}
                    onClick={() => setSearchFilter('')}
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            )}
            <div className={styles.branchList} onKeyDown={handleListKeyDown} role="listbox" aria-label="Branches">
              {filteredBranches.length === 0 ? (
                <div className={styles.placeholder}>
                  {searchFilter ? 'No matching branches' : 'No branches'}
                </div>
              ) : (
                filteredBranches.map((branch) => (
                  <div
                    key={branch.name}
                    className={`${styles.branchItem} ${branch.current ? styles.branchItemCurrent : ''}`}
                    onDoubleClick={() => handleDoubleClick(branch)}
                    onContextMenu={(e) => handleContextMenu(e, branch)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleDoubleClick(branch)
                    }}
                    title={`${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}`}
                    tabIndex={0}
                    role="option"
                    aria-selected={branch.current}
                  >
                    <span className={styles.branchIndicator}>
                      {branch.current ? <CircleDot size={12} /> : ''}
                    </span>
                    <span className={styles.branchName}>{branch.name}</span>
                    {(branch.ahead > 0 || branch.behind > 0) && branch.upstream && (
                      <span className={styles.branchTracking}>
                        {branch.ahead > 0 && (
                          <span className={styles.branchAhead} title={`${branch.ahead} ahead`}>
                            <ArrowUp size={10} />{branch.ahead}
                          </span>
                        )}
                        {branch.behind > 0 && (
                          <span className={styles.branchBehind} title={`${branch.behind} behind`}>
                            <ArrowDown size={10} />{branch.behind}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </SidebarSection>

      <RemotesSection currentRepo={currentRepo} onBranchesChanged={loadBranches} />

      <TagsSection currentRepo={currentRepo} />

      <StashesSection currentRepo={currentRepo} />

      <SubmodulesSection currentRepo={currentRepo} />

      <PullRequestsSection currentRepo={currentRepo} />

      <MergeRequestsSection currentRepo={currentRepo} />
      </>
      )}
      </div>{/* end sidebarScrollArea */}

      {/* Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={buildBranchContextMenuItems(contextMenu.branch, currentBranch, {
            onCheckout: handleCheckout,
            onRename: (name) => setRenameTarget(name),
            onDelete: handleDelete,
            onMerge: handleMerge,
            onRebase: handleRebase,
            onPush: handlePush,
          })}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* New Branch Dialog */}
      {newBranchDialog.open && (
        <NewBranchDialog
          state={newBranchDialog}
          branches={branches}
          onClose={closeNewBranchDialog}
          onChange={(updates) => setNewBranchDialog((prev) => ({ ...prev, ...updates }))}
          onSubmit={handleNewBranchSubmit}
        />
      )}

      {/* Rename Dialog */}
      {renameTarget && (
        <RenameDialog
          oldName={renameTarget}
          onClose={() => setRenameTarget(null)}
          onSubmit={handleRenameSubmit}
        />
      )}

      {/* Merge Dialog */}
      {mergeBranch && currentRepo && (
        <MergeDialog
          currentRepo={currentRepo}
          preselectedBranch={mergeBranch}
          onClose={() => setMergeBranch(null)}
          onMergeComplete={() => {
            setMergeBranch(null)
            loadBranches()
          }}
        />
      )}

      {/* Rebase Dialog */}
      {rebaseBranch && currentRepo && (
        <RebaseDialog
          currentRepo={currentRepo}
          preselectedBranch={rebaseBranch}
          onClose={() => setRebaseBranch(null)}
          onRebaseComplete={() => {
            setRebaseBranch(null)
            loadBranches()
          }}
        />
      )}
    </div>
  )
}
