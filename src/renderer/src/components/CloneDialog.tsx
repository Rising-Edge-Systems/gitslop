import React, { useCallback, useEffect, useRef, useState } from 'react'

interface CloneDialogProps {
  onClose: () => void
  onCloneComplete: (repoPath: string) => void
}

interface CloneProgress {
  phase: string
  percent: number | null
  current: number | null
  total: number | null
}

export function CloneDialog({ onClose, onCloneComplete }: CloneDialogProps): React.JSX.Element {
  const [url, setUrl] = useState('')
  const [destination, setDestination] = useState('')
  const [repoName, setRepoName] = useState('')
  const [nameManuallySet, setNameManuallySet] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [progress, setProgress] = useState<CloneProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)

  // Auto-focus URL input on mount
  useEffect(() => {
    urlInputRef.current?.focus()
  }, [])

  // Listen for clone progress events
  useEffect(() => {
    const unsubscribe = window.electronAPI.git.onCloneProgress((prog) => {
      if (operationIdRef.current && prog.operationId === operationIdRef.current) {
        setProgress({
          phase: prog.phase,
          percent: prog.percent,
          current: prog.current,
          total: prog.total
        })
      }
    })
    return unsubscribe
  }, [])

  // Extract repo name from URL
  const extractRepoName = useCallback((repoUrl: string): string => {
    // Handle URLs like:
    // https://github.com/user/repo.git
    // git@github.com:user/repo.git
    // https://github.com/user/repo
    // /path/to/repo
    const cleaned = repoUrl.replace(/\.git\/?$/, '').replace(/\/$/, '')
    const parts = cleaned.split(/[/:]/)
    return parts[parts.length - 1] || ''
  }, [])

  // Update repo name when URL changes (if not manually set)
  useEffect(() => {
    if (!nameManuallySet && url) {
      setRepoName(extractRepoName(url))
    }
  }, [url, nameManuallySet, extractRepoName])

  const handleBrowseDestination = useCallback(async () => {
    const dirPath = await window.electronAPI.dialog.openDirectory()
    if (dirPath) {
      setDestination(dirPath)
    }
  }, [])

  const handleNameChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRepoName(e.target.value)
    setNameManuallySet(true)
  }, [])

  const handleClone = useCallback(async () => {
    if (!url.trim() || !destination.trim() || !repoName.trim()) return

    setError(null)
    setCloning(true)
    setProgress({ phase: 'Starting clone...', percent: null, current: null, total: null })

    const fullPath = destination.endsWith('/')
      ? `${destination}${repoName}`
      : `${destination}/${repoName}`

    const result = await window.electronAPI.git.clone(url.trim(), fullPath)
    operationIdRef.current = result.operationId ?? null

    if (result.success) {
      setProgress(null)
      setCloning(false)
      onCloneComplete(fullPath)
    } else {
      setCloning(false)
      setProgress(null)
      setError(result.error || 'Clone failed')
    }
  }, [url, destination, repoName, onCloneComplete])

  const handleCancel = useCallback(async () => {
    if (operationIdRef.current) {
      await window.electronAPI.git.cancelOperation(operationIdRef.current)
      operationIdRef.current = null
    }
    setCloning(false)
    setProgress(null)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (cloning) {
          handleCancel()
        } else {
          onClose()
        }
      } else if (e.key === 'Enter' && !cloning && url && destination && repoName) {
        handleClone()
      }
    },
    [cloning, handleCancel, onClose, handleClone, url, destination, repoName]
  )

  const isValid = url.trim() && destination.trim() && repoName.trim()

  return (
    <div className="clone-dialog-overlay" onKeyDown={handleKeyDown}>
      <div className="clone-dialog">
        <div className="clone-dialog-header">
          <h2 className="clone-dialog-title">Clone Repository</h2>
          <button
            className="clone-dialog-close"
            onClick={cloning ? handleCancel : onClose}
            aria-label="Close"
          >
            &#x2715;
          </button>
        </div>

        <div className="clone-dialog-body">
          <div className="clone-dialog-field">
            <label className="clone-dialog-label" htmlFor="clone-url">
              Repository URL
            </label>
            <input
              ref={urlInputRef}
              id="clone-url"
              type="text"
              className="clone-dialog-input"
              placeholder="https://github.com/user/repo.git or git@github.com:user/repo.git"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={cloning}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="clone-dialog-hint">Supports HTTPS and SSH URLs</span>
          </div>

          <div className="clone-dialog-field">
            <label className="clone-dialog-label" htmlFor="clone-dest">
              Destination Folder
            </label>
            <div className="clone-dialog-input-group">
              <input
                id="clone-dest"
                type="text"
                className="clone-dialog-input"
                placeholder="/path/to/parent/folder"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                disabled={cloning}
                spellCheck={false}
                autoComplete="off"
              />
              <button
                className="clone-dialog-browse"
                onClick={handleBrowseDestination}
                disabled={cloning}
              >
                Browse...
              </button>
            </div>
          </div>

          <div className="clone-dialog-field">
            <label className="clone-dialog-label" htmlFor="clone-name">
              Repository Name
            </label>
            <input
              id="clone-name"
              type="text"
              className="clone-dialog-input"
              placeholder="repo-name"
              value={repoName}
              onChange={handleNameChange}
              disabled={cloning}
              spellCheck={false}
              autoComplete="off"
            />
            {destination && repoName && (
              <span className="clone-dialog-hint">
                Will clone to: {destination}{destination.endsWith('/') ? '' : '/'}{repoName}
              </span>
            )}
          </div>

          {error && (
            <div className="clone-dialog-error">
              <span className="clone-dialog-error-icon">&#9888;</span>
              <span className="clone-dialog-error-text">{error}</span>
            </div>
          )}

          {cloning && progress && (
            <div className="clone-dialog-progress">
              <div className="clone-dialog-progress-text">
                {progress.phase}
                {progress.percent !== null && ` ${progress.percent}%`}
                {progress.current !== null && progress.total !== null && (
                  <span className="clone-dialog-progress-count">
                    {' '}({progress.current}/{progress.total})
                  </span>
                )}
              </div>
              <div className="clone-dialog-progress-bar">
                <div
                  className="clone-dialog-progress-fill"
                  style={{ width: `${progress.percent ?? 0}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="clone-dialog-footer">
          <button
            className="clone-dialog-btn clone-dialog-btn-cancel"
            onClick={cloning ? handleCancel : onClose}
          >
            {cloning ? 'Cancel' : 'Close'}
          </button>
          <button
            className="clone-dialog-btn clone-dialog-btn-clone"
            onClick={handleClone}
            disabled={cloning || !isValid}
          >
            {cloning ? 'Cloning...' : 'Clone'}
          </button>
        </div>
      </div>
    </div>
  )
}
