import React, { useCallback, useEffect, useState } from 'react'
import { FolderOpen, GitBranch, FolderPlus, Folder, AlertTriangle, X } from 'lucide-react'
import type { RecentRepo } from '../hooks/useLayoutState'
import { CloneDialog } from './CloneDialog'
import styles from './WelcomeScreen.module.css'

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
    <div className={styles.welcomeScreen}>
      <div className={styles.welcomeHero}>
        <span className={styles.welcomeLogo}>GS</span>
        <h1 className={styles.welcomeTitle}>GitSlop</h1>
        <p className={styles.welcomeSubtitle}>A powerful, open-source Git client</p>
      </div>

      {error && (
        <div className={styles.welcomeError}>
          <span className={styles.welcomeErrorIcon}><AlertTriangle size={16} /></span>
          <span className={styles.welcomeErrorText}>{error}</span>
          {error.includes('not a git repository') && (
            <button className={styles.welcomeErrorAction} onClick={handleInitFromError}>
              Init Here
            </button>
          )}
          <button
            className={styles.welcomeErrorDismiss}
            onClick={() => setError(null)}
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.welcomeActions}>
        <button className={styles.welcomeActionBtn} onClick={handleOpenRepo}>
          <span className={styles.welcomeActionIcon}><FolderOpen size={24} /></span>
          <span className={styles.welcomeActionLabel}>Open Repository</span>
          <span className={styles.welcomeActionDesc}>Open an existing git repository</span>
        </button>

        <button className={styles.welcomeActionBtn} onClick={handleCloneRepo}>
          <span className={styles.welcomeActionIcon}><GitBranch size={24} /></span>
          <span className={styles.welcomeActionLabel}>Clone Repository</span>
          <span className={styles.welcomeActionDesc}>Clone a remote repository</span>
        </button>

        <button className={styles.welcomeActionBtn} onClick={handleInitRepo}>
          <span className={styles.welcomeActionIcon}><FolderPlus size={24} /></span>
          <span className={styles.welcomeActionLabel}>Init Repository</span>
          <span className={styles.welcomeActionDesc}>Initialize a new git repository</span>
        </button>
      </div>

      {recentRepos.length > 0 && (
        <div className={styles.welcomeRecent}>
          <h2 className={styles.welcomeRecentTitle}>Recent Repositories</h2>
          <div className={styles.welcomeRecentList}>
            {recentRepos.map((repo) => (
              <button
                key={repo.path}
                className={styles.welcomeRecentItem}
                onClick={() => handleRecentClick(repo)}
                title={repo.path}
              >
                <span className={styles.welcomeRecentIcon}><Folder size={18} /></span>
                <div className={styles.welcomeRecentInfo}>
                  <span className={styles.welcomeRecentName}>{repo.name}</span>
                  <span className={styles.welcomeRecentPath}>{repo.path}</span>
                </div>
                <span className={styles.welcomeRecentDate}>{formatDate(repo.lastOpened)}</span>
                <button
                  className={styles.welcomeRecentRemove}
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
