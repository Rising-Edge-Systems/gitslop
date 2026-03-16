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

      <SidebarSection title="Tags" icon="&#127991;" defaultOpen={false}>
        <div className="sidebar-placeholder">
          {currentRepo ? 'Tags shown here' : 'No repository open'}
        </div>
      </SidebarSection>

      <SidebarSection title="Stashes" icon="&#128230;" defaultOpen={false}>
        <div className="sidebar-placeholder">
          {currentRepo ? 'Stashes shown here' : 'No repository open'}
        </div>
      </SidebarSection>

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
