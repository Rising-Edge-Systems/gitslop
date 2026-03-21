import React, { useCallback, useEffect, useState } from 'react'
import { Minus, Square, Copy, X, Sun, Moon, GitBranch } from 'lucide-react'
import type { Theme } from '../hooks/useSettings'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  repoPath?: string | null
  theme?: Theme
  onToggleTheme?: () => void
  /** When true, tabs are visible and showing the repo name — titlebar shows branch only */
  hasTabs?: boolean
}

export function TitleBar({ repoPath, theme, onToggleTheme, hasTabs = false }: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)
  const [branch, setBranch] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setIsMaximized)
    const cleanup = window.electronAPI.window.onMaximizeChange(setIsMaximized)
    return cleanup
  }, [])

  // Fetch current branch name
  useEffect(() => {
    if (!repoPath) {
      setBranch(null)
      return
    }
    let cancelled = false
    const fetchBranch = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.git.getCurrentBranch(repoPath)
        if (!cancelled && result.success && result.data) {
          setBranch(result.data)
        }
      } catch {
        // Ignore errors
      }
    }
    fetchBranch()

    // Refresh on repo file changes
    let timer: ReturnType<typeof setTimeout> | null = null
    const cleanup = window.electronAPI.onRepoChanged(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        fetchBranch()
      }, 800)
    })

    return () => {
      cancelled = true
      cleanup()
      if (timer) clearTimeout(timer)
    }
  }, [repoPath])

  const handleMinimize = useCallback(() => {
    window.electronAPI.window.minimize()
  }, [])

  const handleMaximize = useCallback(() => {
    window.electronAPI.window.maximize()
    setIsMaximized((prev) => !prev)
  }, [])

  const handleClose = useCallback(() => {
    window.electronAPI.window.close()
  }, [])

  const repoName = repoPath ? repoPath.split(/[/\\]/).pop() : null

  const handleCopyRepoInfo = useCallback(async () => {
    if (!repoName) return
    const text = branch ? `${repoName} (${branch})` : repoName
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard may not be available
    }
  }, [repoName, branch])

  return (
    <div className={styles.titlebar}>
      {/* Left: GitSlop wordmark */}
      <div className={styles.left}>
        <div className={styles.drag}>
          <span className={styles.wordmark}>GitSlop</span>
        </div>
      </div>

      {/* Center: branch info (repo name is in tabs, avoid duplication) */}
      <div className={styles.center}>
        <div className={styles.drag}>
          {repoPath && repoName && (
            <button
              className={styles.repoInfo}
              onClick={handleCopyRepoInfo}
              title={copied ? 'Copied!' : `${repoPath} — click to copy`}
            >
              {/* When tabs are visible, only show branch to avoid duplicating repo name */}
              {hasTabs ? (
                branch && (
                  <span className={styles.repoBranch}>
                    <GitBranch size={12} className={styles.branchIcon} />
                    {branch}
                  </span>
                )
              ) : (
                <>
                  <span className={styles.repoName}>{repoName}</span>
                  {branch && (
                    <>
                      <span className={styles.repoDivider}>/</span>
                      <span className={styles.repoBranch}>
                        <GitBranch size={12} className={styles.branchIcon} />
                        {branch}
                      </span>
                    </>
                  )}
                </>
              )}
              {copied && <span className={styles.copiedBadge}>Copied!</span>}
            </button>
          )}
        </div>
      </div>

      {/* Right: window controls */}
      <div className={styles.controls}>
        {onToggleTheme && (
          <button
            className={`${styles.btn} ${styles.btnTheme}`}
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl+Shift+T)`}
          >
            {theme === 'dark' ? <Sun size={14} className="lucide-icon" /> : <Moon size={14} className="lucide-icon" />}
          </button>
        )}
        <button
          className={`${styles.btn} ${styles.btnMinimize}`}
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
        >
          <Minus size={14} className="lucide-icon" />
        </button>
        <button
          className={`${styles.btn} ${styles.btnMaximize}`}
          onClick={handleMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? <Copy size={14} className="lucide-icon" /> : <Square size={14} className="lucide-icon" />}
        </button>
        <button
          className={`${styles.btn} ${styles.btnClose}`}
          onClick={handleClose}
          aria-label="Close"
          title="Close"
        >
          <X size={14} className="lucide-icon" />
        </button>
      </div>
    </div>
  )
}
