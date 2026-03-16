import React, { useCallback, useEffect, useState } from 'react'
import type { Theme } from '../hooks/useTheme'

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
    <div className="titlebar">
      <div className="titlebar-drag">
        <div className="titlebar-brand">
          <span className="titlebar-icon">&#9673;</span>
          <span className="titlebar-title">GitSlop</span>
          {repoPath && (
            <span className="titlebar-repo" title={repoPath}>
              <span className="titlebar-repo-separator">—</span>
              <span className="titlebar-repo-name">{repoPath.split(/[/\\]/).pop()}</span>
              <span className="titlebar-repo-path">{repoPath}</span>
            </span>
          )}
        </div>
      </div>
      <div className="titlebar-controls">
        {onToggleTheme && (
          <button
            className="titlebar-btn titlebar-btn-theme"
            onClick={onToggleTheme}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme (Ctrl+Shift+T)`}
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
        )}
        <button
          className="titlebar-btn titlebar-btn-minimize"
          onClick={handleMinimize}
          aria-label="Minimize"
          title="Minimize"
        >
          &#x2500;
        </button>
        <button
          className="titlebar-btn titlebar-btn-maximize"
          onClick={handleMaximize}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
          title={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? '\u29C9' : '\u25A1'}
        </button>
        <button
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          aria-label="Close"
          title="Close"
        >
          &#x2715;
        </button>
      </div>
    </div>
  )
}
