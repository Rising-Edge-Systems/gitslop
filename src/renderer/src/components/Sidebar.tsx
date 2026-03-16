import React, { useState, useCallback, useEffect, useRef } from 'react'

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
  icon: string
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

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  return (
    <div className="sidebar-section">
      <div className="sidebar-section-header-row">
        <button className="sidebar-section-header" onClick={toggle}>
          <span className={`sidebar-section-chevron ${isOpen ? 'open' : ''}`}>&#9654;</span>
          <span className="sidebar-section-icon">{icon}</span>
          <span className="sidebar-section-title">{title}</span>
          {count !== undefined && count > 0 && (
            <span className="sidebar-section-count">{count}</span>
          )}
        </button>
        {headerAction && <div className="sidebar-section-action">{headerAction}</div>}
      </div>
      {isOpen && <div className="sidebar-section-content">{children}</div>}
    </div>
  )
}

// ─── BranchContextMenu ──────────────────────────────────────────────────────

interface BranchContextMenuProps {
  state: ContextMenuState
  currentBranch: string
  onClose: () => void
  onCheckout: (name: string) => void
  onRename: (name: string) => void
  onDelete: (name: string) => void
  onMerge: (name: string) => void
  onRebase: (name: string) => void
  onPush: (name: string) => void
}

function BranchContextMenu({
  state,
  currentBranch,
  onClose,
  onCheckout,
  onRename,
  onDelete,
  onMerge,
  onRebase,
  onPush
}: BranchContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)
  const isCurrent = state.branch.name === currentBranch

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="branch-ctx-menu"
      style={{
        position: 'fixed',
        left: state.x,
        top: state.y,
        zIndex: 2000
      }}
    >
      {!isCurrent && (
        <button
          className="branch-ctx-menu-item"
          onClick={() => {
            onCheckout(state.branch.name)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon">&#10140;</span>
          <span className="branch-ctx-menu-label">Checkout</span>
        </button>
      )}
      <button
        className="branch-ctx-menu-item"
        onClick={() => {
          onRename(state.branch.name)
          onClose()
        }}
      >
        <span className="branch-ctx-menu-icon">&#9998;</span>
        <span className="branch-ctx-menu-label">Rename</span>
      </button>
      {!isCurrent && (
        <>
          <div className="branch-ctx-menu-separator" />
          <button
            className="branch-ctx-menu-item"
            onClick={() => {
              onMerge(state.branch.name)
              onClose()
            }}
          >
            <span className="branch-ctx-menu-icon">&#8623;</span>
            <span className="branch-ctx-menu-label">Merge into {currentBranch}</span>
          </button>
          <button
            className="branch-ctx-menu-item"
            onClick={() => {
              onRebase(state.branch.name)
              onClose()
            }}
          >
            <span className="branch-ctx-menu-icon">&#8634;</span>
            <span className="branch-ctx-menu-label">Rebase onto {state.branch.name}</span>
          </button>
        </>
      )}
      <div className="branch-ctx-menu-separator" />
      {state.branch.upstream && (
        <button
          className="branch-ctx-menu-item"
          onClick={() => {
            onPush(state.branch.name)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon">&#8682;</span>
          <span className="branch-ctx-menu-label">Push</span>
        </button>
      )}
      {!isCurrent && (
        <button
          className="branch-ctx-menu-item branch-ctx-menu-item-danger"
          onClick={() => {
            onDelete(state.branch.name)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon">&#128465;</span>
          <span className="branch-ctx-menu-label">Delete</span>
        </button>
      )}
    </div>
  )
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
            &#10005;
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
              <span>&#9888;</span> {state.error}
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
            &#10005;
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
              <span>&#9888;</span> {error}
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

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!currentRepo) return
    const interval = setInterval(loadRemotes, 5000)
    return () => clearInterval(interval)
  }, [currentRepo, loadRemotes])

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
        icon="&#9729;"
        defaultOpen={false}
        count={remotes.length}
        headerAction={
          currentRepo ? (
            <button
              className="sidebar-section-add-btn"
              onClick={() => setAddRemoteDialog({ open: true, name: '', url: '', error: null, loading: false })}
              title="Add Remote"
            >
              +
            </button>
          ) : undefined
        }
      >
        {!currentRepo ? (
          <div className="sidebar-placeholder">No repository open</div>
        ) : remotes.length === 0 ? (
          <div className="sidebar-placeholder">No remotes configured</div>
        ) : (
          <div className="sidebar-remote-list">
            {remotes.map((remote) => {
              const isExpanded = expandedRemotes.has(remote.name)
              const branches = branchesByRemote(remote.name)
              return (
                <div key={remote.name} className="sidebar-remote-group">
                  <div
                    className="sidebar-remote-item"
                    onClick={() => toggleRemote(remote.name)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setRemoteContextMenu({ x: e.clientX, y: e.clientY, remote })
                    }}
                    title={`${remote.name}\nFetch: ${remote.fetchUrl}\nPush: ${remote.pushUrl}`}
                  >
                    <span className={`sidebar-section-chevron ${isExpanded ? 'open' : ''}`}>&#9654;</span>
                    <span className="sidebar-remote-name">{remote.name}</span>
                    <span className="sidebar-section-count">{branches.length}</span>
                  </div>
                  {isExpanded && (
                    <div className="sidebar-remote-branches">
                      {branches.length === 0 ? (
                        <div className="sidebar-placeholder" style={{ paddingLeft: '28px' }}>No branches</div>
                      ) : (
                        branches.map((rb) => (
                          <div
                            key={`${rb.remote}/${rb.branch}`}
                            className="sidebar-remote-branch-item"
                            onDoubleClick={() => handleCheckoutRemoteBranch(rb.remote, rb.branch)}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              setRemoteBranchContextMenu({ x: e.clientX, y: e.clientY, remote: rb.remote, branch: rb.branch })
                            }}
                            title={`${rb.remote}/${rb.branch} (${rb.hash})`}
                          >
                            <span className="sidebar-remote-branch-name">{rb.branch}</span>
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
        <RemoteContextMenu
          state={remoteContextMenu}
          onClose={() => setRemoteContextMenu(null)}
          onFetch={(name) => { handleFetchRemote(name); setRemoteContextMenu(null) }}
          onEdit={(remote) => { openEditRemote(remote); setRemoteContextMenu(null) }}
          onRemove={(name) => { handleRemoveRemote(name); setRemoteContextMenu(null) }}
        />
      )}

      {/* Remote branch context menu */}
      {remoteBranchContextMenu && (
        <RemoteBranchContextMenu
          state={remoteBranchContextMenu}
          onClose={() => setRemoteBranchContextMenu(null)}
          onCheckout={(r, b) => { handleCheckoutRemoteBranch(r, b); setRemoteBranchContextMenu(null) }}
          onDelete={(r, b) => { handleDeleteRemoteBranch(r, b); setRemoteBranchContextMenu(null) }}
          onFetch={(r) => { handleFetchRemote(r); setRemoteBranchContextMenu(null) }}
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
                &#10005;
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
                  <span>&#9888;</span> {addRemoteDialog.error}
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
                &#10005;
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
                  <span>&#9888;</span> {editRemoteDialog.error}
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

// ─── RemoteContextMenu ──────────────────────────────────────────────────────

interface RemoteContextMenuProps {
  state: RemoteContextMenuState
  onClose: () => void
  onFetch: (name: string) => void
  onEdit: (remote: GitRemote) => void
  onRemove: (name: string) => void
}

function RemoteContextMenu({ state, onClose, onFetch, onEdit, onRemove }: RemoteContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="branch-ctx-menu"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 2000 }}
    >
      <button className="branch-ctx-menu-item" onClick={() => onFetch(state.remote.name)}>
        <span className="branch-ctx-menu-icon">&#8635;</span>
        <span className="branch-ctx-menu-label">Fetch</span>
      </button>
      <button className="branch-ctx-menu-item" onClick={() => onEdit(state.remote)}>
        <span className="branch-ctx-menu-icon">&#9998;</span>
        <span className="branch-ctx-menu-label">Edit URL</span>
      </button>
      <div className="branch-ctx-menu-separator" />
      <button className="branch-ctx-menu-item branch-ctx-menu-item-danger" onClick={() => onRemove(state.remote.name)}>
        <span className="branch-ctx-menu-icon">&#128465;</span>
        <span className="branch-ctx-menu-label">Remove</span>
      </button>
    </div>
  )
}

// ─── RemoteBranchContextMenu ────────────────────────────────────────────────

interface RemoteBranchContextMenuProps {
  state: RemoteBranchContextMenuState
  onClose: () => void
  onCheckout: (remote: string, branch: string) => void
  onDelete: (remote: string, branch: string) => void
  onFetch: (remote: string) => void
}

function RemoteBranchContextMenu({ state, onClose, onCheckout, onDelete, onFetch }: RemoteBranchContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose()
    }
    const handleEsc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="branch-ctx-menu"
      style={{ position: 'fixed', left: state.x, top: state.y, zIndex: 2000 }}
    >
      <button className="branch-ctx-menu-item" onClick={() => onCheckout(state.remote, state.branch)}>
        <span className="branch-ctx-menu-icon">&#10140;</span>
        <span className="branch-ctx-menu-label">Checkout as local branch</span>
      </button>
      <button className="branch-ctx-menu-item" onClick={() => onFetch(state.remote)}>
        <span className="branch-ctx-menu-icon">&#8635;</span>
        <span className="branch-ctx-menu-label">Fetch</span>
      </button>
      <div className="branch-ctx-menu-separator" />
      <button className="branch-ctx-menu-item branch-ctx-menu-item-danger" onClick={() => onDelete(state.remote, state.branch)}>
        <span className="branch-ctx-menu-icon">&#128465;</span>
        <span className="branch-ctx-menu-label">Delete remote branch</span>
      </button>
    </div>
  )
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

  // Load tags on mount and auto-refresh
  useEffect(() => {
    loadTags()

    const startRefresh = (): void => {
      refreshTimerRef.current = setInterval(() => {
        loadTags()
      }, 5000)
    }

    startRefresh()
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [loadTags])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = (): void => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

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
        icon="&#127991;"
        defaultOpen={false}
        count={tags.length}
        headerAction={
          currentRepo ? (
            <button
              className="sidebar-section-add-btn"
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
          <div className="sidebar-placeholder">No repository open</div>
        ) : tags.length === 0 ? (
          <div className="sidebar-placeholder">No tags</div>
        ) : (
          <div className="sidebar-branch-list">
            {tags.length > 5 && (
              <input
                className="sidebar-branch-filter"
                type="text"
                placeholder="Filter tags..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            {filteredTags.length === 0 ? (
              <div className="sidebar-placeholder">No matching tags</div>
            ) : (
              filteredTags.map((tag) => (
                <div
                  key={tag.name}
                  className="sidebar-tag-item"
                  title={
                    tag.isAnnotated
                      ? `${tag.name} (annotated)\n${tag.message}`
                      : `${tag.name} (lightweight)`
                  }
                  onContextMenu={(e) => handleContextMenu(e, tag)}
                >
                  <span className="sidebar-tag-icon">
                    {tag.isAnnotated ? '\u{1F3F7}' : '\u{1F516}'}
                  </span>
                  <span className="sidebar-tag-name">{tag.name}</span>
                  {tag.taggerDate && (
                    <span className="sidebar-tag-date">{formatDate(tag.taggerDate)}</span>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </SidebarSection>

      {/* Tag Context Menu */}
      {contextMenu && (
        <div
          className="branch-ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="branch-ctx-menu-item"
            onClick={() => {
              handleDelete(contextMenu.tag.name)
              setContextMenu(null)
            }}
          >
            <span className="branch-ctx-menu-icon">&#128465;</span>
            <span className="branch-ctx-menu-label">Delete tag</span>
          </button>
          <button
            className="branch-ctx-menu-item"
            onClick={() => {
              handlePushTag(contextMenu.tag.name)
              setContextMenu(null)
            }}
          >
            <span className="branch-ctx-menu-icon">&#8593;</span>
            <span className="branch-ctx-menu-label">Push tag</span>
          </button>
        </div>
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
    // Auto-refresh every 5 seconds
    const interval = setInterval(loadStashes, 5000)
    return () => {
      clearInterval(interval)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [loadStashes])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = (): void => setContextMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [contextMenu])

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
        icon="&#128230;"
        defaultOpen={false}
        count={stashes.length}
        headerAction={
          currentRepo ? (
            <button
              className="sidebar-section-action-btn"
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
          <div className="sidebar-placeholder">No repository open</div>
        ) : stashes.length === 0 ? (
          <div className="sidebar-placeholder">No stashes</div>
        ) : (
          <div className="sidebar-stash-list">
            {stashes.map((stash) => (
              <div
                key={stash.hash}
                className={`sidebar-stash-item ${selectedStash?.index === stash.index ? 'selected' : ''}`}
                onClick={() => handleStashClick(stash)}
                onContextMenu={(e) => handleStashContextMenu(e, stash)}
                title={`stash@{${stash.index}}: ${stash.message}`}
              >
                <span className="sidebar-stash-icon">&#128230;</span>
                <div className="sidebar-stash-info">
                  <span className="sidebar-stash-message">
                    {stash.message || `stash@{${stash.index}}`}
                  </span>
                  <span className="sidebar-stash-date">
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
        <div className="stash-diff-overlay" onClick={() => { setSelectedStash(null); setStashDiff(null) }}>
          <div className="stash-diff-panel" onClick={(e) => e.stopPropagation()}>
            <div className="stash-diff-header">
              <span>stash@&#123;{selectedStash.index}&#125;: {selectedStash.message}</span>
              <button className="stash-diff-close" onClick={() => { setSelectedStash(null); setStashDiff(null) }}>✕</button>
            </div>
            <pre className="stash-diff-content">{stashDiff}</pre>
          </div>
        </div>
      )}

      {/* Stash Context Menu */}
      {contextMenu && (
        <div
          className="branch-ctx-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleApply(contextMenu.stash.index)}>Apply</button>
          <button onClick={() => handlePop(contextMenu.stash.index)}>Pop</button>
          <div className="branch-ctx-divider" />
          <button className="branch-ctx-danger" onClick={() => handleDrop(contextMenu.stash.index)}>Drop</button>
        </div>
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
    </>
  )
}

// ─── Sidebar (main export) ──────────────────────────────────────────────────

export function Sidebar({ currentRepo }: SidebarProps): React.JSX.Element {
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

  // Auto-refresh every 5 seconds
  useEffect(() => {
    if (!currentRepo) return
    const interval = setInterval(loadBranches, 5000)
    return () => clearInterval(interval)
  }, [currentRepo, loadBranches])

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
    async (branchName: string) => {
      if (!currentRepo) return
      // Placeholder — merge functionality will be implemented in US-019
      await window.electronAPI.git.exec(['merge', branchName], currentRepo)
      await loadBranches()
    },
    [currentRepo, loadBranches]
  )

  const handleRebase = useCallback(
    async (branchName: string) => {
      if (!currentRepo) return
      // Placeholder — rebase functionality will be implemented in US-020
      await window.electronAPI.git.exec(['rebase', branchName], currentRepo)
      await loadBranches()
    },
    [currentRepo, loadBranches]
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

  // ─── Render ─────────────────────────────────────────────────────────────

  const noBranches = !currentRepo

  return (
    <div className="sidebar">
      <SidebarSection
        title="Branches"
        icon="&#9922;"
        defaultOpen={true}
        count={branches.length}
        headerAction={
          currentRepo ? (
            <button
              className="sidebar-section-add-btn"
              onClick={openNewBranchDialog}
              title="New Branch"
            >
              +
            </button>
          ) : undefined
        }
      >
        {noBranches ? (
          <div className="sidebar-placeholder">No repository open</div>
        ) : loading && branches.length === 0 ? (
          <div className="sidebar-placeholder">Loading branches...</div>
        ) : (
          <div className="sidebar-branch-section">
            {branches.length > 5 && (
              <div className="sidebar-search-box">
                <input
                  type="text"
                  className="sidebar-search-input"
                  placeholder="Filter branches..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
                {searchFilter && (
                  <button
                    className="sidebar-search-clear"
                    onClick={() => setSearchFilter('')}
                  >
                    &#10005;
                  </button>
                )}
              </div>
            )}
            <div className="sidebar-branch-list">
              {filteredBranches.length === 0 ? (
                <div className="sidebar-placeholder">
                  {searchFilter ? 'No matching branches' : 'No branches'}
                </div>
              ) : (
                filteredBranches.map((branch) => (
                  <div
                    key={branch.name}
                    className={`sidebar-branch-item ${branch.current ? 'sidebar-branch-item-current' : ''}`}
                    onDoubleClick={() => handleDoubleClick(branch)}
                    onContextMenu={(e) => handleContextMenu(e, branch)}
                    title={`${branch.name}${branch.upstream ? ` → ${branch.upstream}` : ''}`}
                  >
                    <span className="sidebar-branch-indicator">
                      {branch.current ? '●' : ''}
                    </span>
                    <span className="sidebar-branch-name">{branch.name}</span>
                    {(branch.ahead > 0 || branch.behind > 0) && branch.upstream && (
                      <span className="sidebar-branch-tracking">
                        {branch.ahead > 0 && (
                          <span className="sidebar-branch-ahead" title={`${branch.ahead} ahead`}>
                            &#8593;{branch.ahead}
                          </span>
                        )}
                        {branch.behind > 0 && (
                          <span className="sidebar-branch-behind" title={`${branch.behind} behind`}>
                            &#8595;{branch.behind}
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

      {/* Context Menu */}
      {contextMenu && (
        <BranchContextMenu
          state={contextMenu}
          currentBranch={currentBranch}
          onClose={() => setContextMenu(null)}
          onCheckout={handleCheckout}
          onRename={(name) => setRenameTarget(name)}
          onDelete={handleDelete}
          onMerge={handleMerge}
          onRebase={handleRebase}
          onPush={handlePush}
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
    </div>
  )
}
