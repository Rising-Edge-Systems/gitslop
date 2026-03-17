import React, { useCallback, useEffect, useState } from 'react'
import { FolderOpen, GitBranch, FolderPlus, Folder, AlertTriangle, X } from 'lucide-react'
import type { RecentRepo } from '../hooks/useLayoutState'
import { CloneDialog } from './CloneDialog'

interface WelcomeScreenProps {
  onRepoOpen: (repoPath: string) => void
}

export function WelcomeScreen({ onRepoOpen }: WelcomeScreenProps): React.JSX.Element {
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [errorPath, setErrorPath] = useState<string | null>(null)
  const [showCloneDialog, setShowCloneDialog] = useState(false)

  useEffect(() => {
    window.electronAPI.repos.getRecent().then(setRecentRepos).catch(() => {
      // Ignore errors loading recent repos
    })
  }, [])

  const handleOpenRepo = useCallback(async () => {
    setError(null)
    setErrorPath(null)
    const dirPath = await window.electronAPI.dialog.openDirectory()
    if (!dirPath) return

    const isRepo = await window.electronAPI.git.isRepo(dirPath)
    if (isRepo) {
      const name = dirPath.split(/[/\\]/).pop() || dirPath
      const updated = await window.electronAPI.repos.addRecent(dirPath, name)
      setRecentRepos(updated)
      onRepoOpen(dirPath)
    } else {
      setErrorPath(dirPath)
      setError(`"${dirPath}" is not a git repository. Would you like to initialize one?`)
    }
  }, [onRepoOpen])

  const handleInitRepo = useCallback(async () => {
    setError(null)
    const dirPath = await window.electronAPI.dialog.openDirectory()
    if (!dirPath) return

    const result = await window.electronAPI.git.init(dirPath)
    if (result.success) {
      const name = dirPath.split(/[/\\]/).pop() || dirPath
      const updated = await window.electronAPI.repos.addRecent(dirPath, name)
      setRecentRepos(updated)
      onRepoOpen(dirPath)
    } else {
      setError(result.error || 'Failed to initialize repository')
    }
  }, [onRepoOpen])

  const handleInitFromError = useCallback(async () => {
    if (!errorPath) return
    setError(null)
    const result = await window.electronAPI.git.init(errorPath)
    if (result.success) {
      const name = errorPath.split(/[/\\]/).pop() || errorPath
      const updated = await window.electronAPI.repos.addRecent(errorPath, name)
      setRecentRepos(updated)
      setErrorPath(null)
      onRepoOpen(errorPath)
    } else {
      setError(result.error || 'Failed to initialize repository')
    }
  }, [errorPath, onRepoOpen])

  const handleCloneRepo = useCallback(() => {
    setError(null)
    setShowCloneDialog(true)
  }, [])

  const handleCloneComplete = useCallback(
    async (repoPath: string) => {
      setShowCloneDialog(false)
      const name = repoPath.split(/[/\\]/).pop() || repoPath
      const updated = await window.electronAPI.repos.addRecent(repoPath, name)
      setRecentRepos(updated)
      onRepoOpen(repoPath)
    },
    [onRepoOpen]
  )

  const handleRecentClick = useCallback(
    async (repo: RecentRepo) => {
      setError(null)
      const isRepo = await window.electronAPI.git.isRepo(repo.path)
      if (isRepo) {
        const updated = await window.electronAPI.repos.addRecent(repo.path, repo.name)
        setRecentRepos(updated)
        onRepoOpen(repo.path)
      } else {
        setError(`Repository not found at "${repo.path}". It may have been moved or deleted.`)
      }
    },
    [onRepoOpen]
  )

  const handleRemoveRecent = useCallback(
    async (e: React.MouseEvent, repoPath: string) => {
      e.stopPropagation()
      const updated = await window.electronAPI.repos.removeRecent(repoPath)
      setRecentRepos(updated)
    },
    []
  )

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMs / 3600000)
      const diffDays = Math.floor(diffMs / 86400000)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays < 7) return `${diffDays}d ago`
      return date.toLocaleDateString()
    } catch {
      return ''
    }
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-hero">
        <span className="welcome-logo">GS</span>
        <h1 className="welcome-title">GitSlop</h1>
        <p className="welcome-subtitle">A powerful, open-source Git client</p>
      </div>

      {error && (
        <div className="welcome-error">
          <span className="welcome-error-icon"><AlertTriangle size={16} /></span>
          <span className="welcome-error-text">{error}</span>
          {error.includes('not a git repository') && (
            <button className="welcome-error-action" onClick={handleInitFromError}>
              Init Here
            </button>
          )}
          <button
            className="welcome-error-dismiss"
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className="welcome-actions">
        <button className="welcome-action-btn" onClick={handleOpenRepo}>
          <span className="welcome-action-icon"><FolderOpen size={24} /></span>
          <span className="welcome-action-label">Open Repository</span>
          <span className="welcome-action-desc">Open an existing git repository</span>
        </button>

        <button className="welcome-action-btn" onClick={handleCloneRepo}>
          <span className="welcome-action-icon"><GitBranch size={24} /></span>
          <span className="welcome-action-label">Clone Repository</span>
          <span className="welcome-action-desc">Clone a remote repository</span>
        </button>

        <button className="welcome-action-btn" onClick={handleInitRepo}>
          <span className="welcome-action-icon"><FolderPlus size={24} /></span>
          <span className="welcome-action-label">Init Repository</span>
          <span className="welcome-action-desc">Initialize a new git repository</span>
        </button>
      </div>

      {recentRepos.length > 0 && (
        <div className="welcome-recent">
          <h2 className="welcome-recent-title">Recent Repositories</h2>
          <div className="welcome-recent-list">
            {recentRepos.map((repo) => (
              <button
                key={repo.path}
                className="welcome-recent-item"
                onClick={() => handleRecentClick(repo)}
                title={repo.path}
              >
                <span className="welcome-recent-icon"><Folder size={18} /></span>
                <div className="welcome-recent-info">
                  <span className="welcome-recent-name">{repo.name}</span>
                  <span className="welcome-recent-path">{repo.path}</span>
                </div>
                <span className="welcome-recent-date">{formatDate(repo.lastOpened)}</span>
                <button
                  className="welcome-recent-remove"
                  onClick={(e) => handleRemoveRecent(e, repo.path)}
                  aria-label={`Remove ${repo.name} from recent`}
                  title="Remove from recent"
                >
                  <X size={14} />
                </button>
              </button>
            ))}
          </div>
        </div>
      )}

      {showCloneDialog && (
        <CloneDialog
          onClose={() => setShowCloneDialog(false)}
          onCloneComplete={handleCloneComplete}
        />
      )}
    </div>
  )
}
