import React, { useCallback, useEffect, useState } from 'react'
import { Minus, Square, Copy, X, Sun, Moon } from 'lucide-react'
import type { Theme } from '../hooks/useSettings'
import styles from './TitleBar.module.css'

interface TitleBarProps {
  repoPath?: string | null
  theme?: Theme
  onToggleTheme?: () => void
}

export function TitleBar({ repoPath, theme, onToggleTheme }: TitleBarProps): React.JSX.Element {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setIsMaximized)
    const cleanup = window.electronAPI.window.onMaximizeChange(setIsMaximized)
    return cleanup
  }, [])

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

  return (
    <div className={styles.titlebar}>
      <div className={styles.drag}>
        <div className={styles.brand}>
          <span className={styles.icon}>GS</span>
          <span className={styles.title}>GitSlop</span>
          {repoPath && (
            <span className={styles.repo} title={repoPath}>
              <span className={styles.repoSeparator}>—</span>
              <span className={styles.repoName}>{repoPath.split(/[/\\]/).pop()}</span>
              <span className={styles.repoPath}>{repoPath}</span>
            </span>
          )}
        </div>
      </div>
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
