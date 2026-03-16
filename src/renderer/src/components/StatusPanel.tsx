import React, { useCallback, useEffect, useRef, useState } from 'react'

interface FileStatus {
  path: string
  oldPath?: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored'
  staged: boolean
  indexStatus: string
  workTreeStatus: string
}

interface RepoStatus {
  branch: string
  upstream: string | null
  ahead: number
  behind: number
  staged: FileStatus[]
  unstaged: FileStatus[]
  untracked: FileStatus[]
}

interface StatusPanelProps {
  repoPath: string
  onRefresh?: () => void
}

const STATUS_ICONS: Record<string, string> = {
  added: '+',
  modified: '~',
  deleted: '−',
  renamed: '→',
  copied: '⊕',
  untracked: '?',
  ignored: '!'
}

const STATUS_LABELS: Record<string, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
  ignored: 'Ignored'
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() || filePath
}

function fileDir(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

export function StatusPanel({ repoPath, onRefresh }: StatusPanelProps): React.JSX.Element {
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<{ path: string; staged: boolean; isUntracked: boolean } | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [operationInProgress, setOperationInProgress] = useState(false)
  const [dragSource, setDragSource] = useState<'staged' | 'unstaged' | 'untracked' | null>(null)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const panelRef = useRef<HTMLDivElement>(null)

  const loadStatus = useCallback(async () => {
    if (!mountedRef.current) return
    try {
      const result = await window.electronAPI.git.getStatus(repoPath)
      if (!mountedRef.current) return
      if (result.success && result.data) {
        setStatus(result.data as RepoStatus)
        setError(null)
      } else {
        setError(result.error || 'Failed to load status')
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to load status')
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false)
      }
    }
  }, [repoPath])

  // Initial load and auto-refresh every 3 seconds
  useEffect(() => {
    mountedRef.current = true
    loadStatus()

    const interval = setInterval(() => {
      loadStatus()
    }, 3000)

    return () => {
      mountedRef.current = false
      clearInterval(interval)
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
    }
  }, [loadStatus])

  // Listen for file-watcher refresh events
  useEffect(() => {
    const cleanup = window.electronAPI.onRepoChanged?.(() => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
      }
      refreshTimerRef.current = setTimeout(() => {
        loadStatus()
        onRefresh?.()
      }, 300)
    })

    return () => {
      cleanup?.()
    }
  }, [loadStatus, onRefresh])

  // Keyboard shortcuts for stage/unstage
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!panelRef.current?.contains(document.activeElement) && document.activeElement !== panelRef.current) return
      if (operationInProgress) return

      // S key to stage selected file(s)
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedFiles.size > 0 || selectedFile) {
          e.preventDefault()
          handleStageSelected()
        }
      }

      // U key to unstage selected file(s)
      if (e.key === 'u' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (selectedFiles.size > 0 || selectedFile) {
          e.preventDefault()
          handleUnstageSelected()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, selectedFiles, operationInProgress, status])

  // ─── Stage/Unstage Operations ─────────────────────────────────────────────

  const stageFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0 || operationInProgress) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.stageFiles(repoPath, filePaths)
        if (result.success) {
          await loadStatus()
          onRefresh?.()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [repoPath, loadStatus, onRefresh, operationInProgress]
  )

  const unstageFiles = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length === 0 || operationInProgress) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.unstageFiles(repoPath, filePaths)
        if (result.success) {
          await loadStatus()
          onRefresh?.()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [repoPath, loadStatus, onRefresh, operationInProgress]
  )

  const stageAll = useCallback(async () => {
    if (operationInProgress) return
    setOperationInProgress(true)
    try {
      const result = await window.electronAPI.git.stageAll(repoPath)
      if (result.success) {
        await loadStatus()
        onRefresh?.()
      }
    } finally {
      setOperationInProgress(false)
    }
  }, [repoPath, loadStatus, onRefresh, operationInProgress])

  const unstageAll = useCallback(async () => {
    if (operationInProgress) return
    setOperationInProgress(true)
    try {
      const result = await window.electronAPI.git.unstageAll(repoPath)
      if (result.success) {
        await loadStatus()
        onRefresh?.()
      }
    } finally {
      setOperationInProgress(false)
    }
  }, [repoPath, loadStatus, onRefresh, operationInProgress])

  // Handle stage/unstage from keyboard shortcut based on selected files
  const handleStageSelected = useCallback(() => {
    if (!status) return
    const unstaged = [...status.unstaged, ...status.untracked]
    const filesToStage: string[] = []

    if (selectedFiles.size > 0) {
      for (const key of selectedFiles) {
        const file = unstaged.find((f) => `unstaged:${f.path}` === key || `untracked:${f.path}` === key)
        if (file) filesToStage.push(file.path)
      }
    } else if (selectedFile && !selectedFile.staged) {
      filesToStage.push(selectedFile.path)
    }

    if (filesToStage.length > 0) {
      stageFiles(filesToStage)
    }
  }, [status, selectedFiles, selectedFile, stageFiles])

  const handleUnstageSelected = useCallback(() => {
    if (!status) return
    const filesToUnstage: string[] = []

    if (selectedFiles.size > 0) {
      for (const key of selectedFiles) {
        const file = status.staged.find((f) => `staged:${f.path}` === key)
        if (file) filesToUnstage.push(file.path)
      }
    } else if (selectedFile && selectedFile.staged) {
      filesToUnstage.push(selectedFile.path)
    }

    if (filesToUnstage.length > 0) {
      unstageFiles(filesToUnstage)
    }
  }, [status, selectedFiles, selectedFile, unstageFiles])

  // ─── File Selection ───────────────────────────────────────────────────────

  const handleFileClick = useCallback(
    async (file: FileStatus, isUntracked: boolean, section: string, e: React.MouseEvent) => {
      const fileKey = `${section}:${file.path}`

      // Multi-select with Ctrl/Cmd or Shift
      if (e.ctrlKey || e.metaKey) {
        setSelectedFiles((prev) => {
          const next = new Set(prev)
          if (next.has(fileKey)) {
            next.delete(fileKey)
          } else {
            next.add(fileKey)
          }
          return next
        })
        return
      }

      if (e.shiftKey && selectedFile) {
        // Shift+click: select range within same section
        const allFiles =
          section === 'staged'
            ? status?.staged ?? []
            : section === 'unstaged'
              ? status?.unstaged ?? []
              : status?.untracked ?? []
        const currentIdx = allFiles.findIndex((f) => f.path === file.path)
        const prevIdx = allFiles.findIndex((f) => f.path === selectedFile.path)
        if (currentIdx >= 0 && prevIdx >= 0) {
          const start = Math.min(currentIdx, prevIdx)
          const end = Math.max(currentIdx, prevIdx)
          const newSelection = new Set<string>()
          for (let i = start; i <= end; i++) {
            newSelection.add(`${section}:${allFiles[i].path}`)
          }
          setSelectedFiles(newSelection)
          return
        }
      }

      // Regular click - clear multi-select and show diff
      setSelectedFiles(new Set())
      const fileInfo = { path: file.path, staged: file.staged, isUntracked }
      setSelectedFile(fileInfo)
      setDiffLoading(true)
      setDiffContent(null)

      try {
        if (isUntracked) {
          const result = await window.electronAPI.git.diff(repoPath, file.path, { staged: false })
          if (result.success && result.data) {
            setDiffContent(result.data as string)
          } else {
            setDiffContent(`(New untracked file: ${file.path})`)
          }
        } else {
          const result = await window.electronAPI.git.diff(repoPath, file.path, { staged: file.staged })
          if (result.success && result.data) {
            setDiffContent(result.data as string)
          } else {
            setDiffContent('(No diff available)')
          }
        }
      } catch {
        setDiffContent('(Failed to load diff)')
      } finally {
        setDiffLoading(false)
      }
    },
    [repoPath, selectedFile, status]
  )

  // ─── Drag & Drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (file: FileStatus, section: 'staged' | 'unstaged' | 'untracked', e: React.DragEvent) => {
      setDragSource(section)
      // Collect files to drag: if multi-selected, drag all; otherwise just this one
      const filePaths: string[] = []
      if (selectedFiles.size > 0 && selectedFiles.has(`${section}:${file.path}`)) {
        for (const key of selectedFiles) {
          const parts = key.split(':')
          if (parts[0] === section || (section === 'untracked' && parts[0] === 'untracked') || (section === 'unstaged' && parts[0] === 'unstaged')) {
            filePaths.push(parts.slice(1).join(':'))
          }
        }
      } else {
        filePaths.push(file.path)
      }
      e.dataTransfer.setData('text/plain', JSON.stringify({ section, filePaths }))
      e.dataTransfer.effectAllowed = 'move'
    },
    [selectedFiles]
  )

  const handleDragOver = useCallback(
    (targetSection: 'staged' | 'unstaged', e: React.DragEvent) => {
      // Allow drop only when moving between appropriate sections
      if (
        (dragSource === 'unstaged' || dragSource === 'untracked') &&
        targetSection === 'staged'
      ) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      } else if (dragSource === 'staged' && targetSection === 'unstaged') {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
    },
    [dragSource]
  )

  const handleDrop = useCallback(
    async (targetSection: 'staged' | 'unstaged', e: React.DragEvent) => {
      e.preventDefault()
      setDragSource(null)
      try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain')) as {
          section: string
          filePaths: string[]
        }
        if (
          (data.section === 'unstaged' || data.section === 'untracked') &&
          targetSection === 'staged'
        ) {
          await stageFiles(data.filePaths)
        } else if (data.section === 'staged' && targetSection === 'unstaged') {
          await unstageFiles(data.filePaths)
        }
      } catch {
        // Ignore invalid drop data
      }
    },
    [stageFiles, unstageFiles]
  )

  const handleDragEnd = useCallback(() => {
    setDragSource(null)
  }, [])

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }, [])

  const isClean =
    status &&
    status.staged.length === 0 &&
    status.unstaged.length === 0 &&
    status.untracked.length === 0

  const hasUnstagedOrUntracked =
    status && (status.unstaged.length > 0 || status.untracked.length > 0)
  const hasStaged = status && status.staged.length > 0

  if (loading && !status) {
    return (
      <div className="status-panel">
        <div className="status-panel-loading">Loading status...</div>
      </div>
    )
  }

  if (error && !status) {
    return (
      <div className="status-panel">
        <div className="status-panel-error">
          <span>⚠</span> {error}
          <button onClick={loadStatus}>Retry</button>
        </div>
      </div>
    )
  }

  return (
    <div className="status-panel" ref={panelRef} tabIndex={-1}>
      <div className="status-panel-header">
        <h3 className="status-panel-title">Working Directory</h3>
        <div className="status-panel-actions">
          {hasUnstagedOrUntracked && (
            <button
              className="status-action-btn status-action-stage-all"
              onClick={stageAll}
              disabled={operationInProgress}
              title="Stage All (add all changes)"
            >
              + Stage All
            </button>
          )}
          {hasStaged && (
            <button
              className="status-action-btn status-action-unstage-all"
              onClick={unstageAll}
              disabled={operationInProgress}
              title="Unstage All"
            >
              − Unstage All
            </button>
          )}
          <button className="status-panel-refresh" onClick={loadStatus} title="Refresh status">
            &#x21BB;
          </button>
        </div>
      </div>

      {isClean ? (
        <div className="status-panel-clean">
          <span className="status-panel-clean-icon">✓</span>
          <span className="status-panel-clean-text">Working directory clean</span>
        </div>
      ) : (
        <div className="status-panel-sections">
          {/* Staged Section */}
          <StatusSection
            title="Staged"
            count={status?.staged.length ?? 0}
            files={status?.staged ?? []}
            collapsed={!!collapsedSections['staged']}
            onToggle={() => toggleSection('staged')}
            onFileClick={(f, e) => handleFileClick(f, false, 'staged', e)}
            onStageAction={(file) => unstageFiles([file.path])}
            stageActionIcon="−"
            stageActionTitle="Unstage"
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            sectionClass="status-staged"
            sectionKey="staged"
            operationInProgress={operationInProgress}
            onDragStart={(file, e) => handleDragStart(file, 'staged', e)}
            onDragOver={(e) => handleDragOver('unstaged', e)}
            onDrop={(e) => handleDrop('unstaged', e)}
            onDragEnd={handleDragEnd}
            dropTargetSection="staged"
            dragSource={dragSource}
            handleDragOver={handleDragOver}
            handleDrop={handleDrop}
          />

          {/* Unstaged Section */}
          <StatusSection
            title="Unstaged"
            count={status?.unstaged.length ?? 0}
            files={status?.unstaged ?? []}
            collapsed={!!collapsedSections['unstaged']}
            onToggle={() => toggleSection('unstaged')}
            onFileClick={(f, e) => handleFileClick(f, false, 'unstaged', e)}
            onStageAction={(file) => stageFiles([file.path])}
            stageActionIcon="+"
            stageActionTitle="Stage"
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            sectionClass="status-unstaged"
            sectionKey="unstaged"
            operationInProgress={operationInProgress}
            onDragStart={(file, e) => handleDragStart(file, 'unstaged', e)}
            onDragOver={(e) => handleDragOver('staged', e)}
            onDrop={(e) => handleDrop('staged', e)}
            onDragEnd={handleDragEnd}
            dropTargetSection="unstaged"
            dragSource={dragSource}
            handleDragOver={handleDragOver}
            handleDrop={handleDrop}
          />

          {/* Untracked Section */}
          <StatusSection
            title="Untracked"
            count={status?.untracked.length ?? 0}
            files={status?.untracked ?? []}
            collapsed={!!collapsedSections['untracked']}
            onToggle={() => toggleSection('untracked')}
            onFileClick={(f, e) => handleFileClick(f, true, 'untracked', e)}
            onStageAction={(file) => stageFiles([file.path])}
            stageActionIcon="+"
            stageActionTitle="Stage"
            selectedFile={selectedFile}
            selectedFiles={selectedFiles}
            sectionClass="status-untracked"
            sectionKey="untracked"
            operationInProgress={operationInProgress}
            onDragStart={(file, e) => handleDragStart(file, 'untracked', e)}
            onDragOver={(e) => handleDragOver('staged', e)}
            onDrop={(e) => handleDrop('staged', e)}
            onDragEnd={handleDragEnd}
            dropTargetSection="untracked"
            dragSource={dragSource}
            handleDragOver={handleDragOver}
            handleDrop={handleDrop}
          />
        </div>
      )}

      {/* Diff Viewer */}
      {selectedFile && (
        <div className="status-diff-viewer">
          <div className="status-diff-header">
            <span className="status-diff-filename">{selectedFile.path}</span>
            <button
              className="status-diff-close"
              onClick={() => {
                setSelectedFile(null)
                setDiffContent(null)
              }}
              title="Close diff"
            >
              ✕
            </button>
          </div>
          <div className="status-diff-content">
            {diffLoading ? (
              <div className="status-diff-loading">Loading diff...</div>
            ) : diffContent ? (
              <pre className="status-diff-pre">{diffContent}</pre>
            ) : (
              <div className="status-diff-empty">No changes to display</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sub-component for each section ──────────────────────────────────────────

interface StatusSectionProps {
  title: string
  count: number
  files: FileStatus[]
  collapsed: boolean
  onToggle: () => void
  onFileClick: (file: FileStatus, e: React.MouseEvent) => void
  onStageAction: (file: FileStatus) => void
  stageActionIcon: string
  stageActionTitle: string
  selectedFile: { path: string; staged: boolean; isUntracked: boolean } | null
  selectedFiles: Set<string>
  sectionClass: string
  sectionKey: string
  operationInProgress: boolean
  onDragStart: (file: FileStatus, e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  dropTargetSection: 'staged' | 'unstaged' | 'untracked'
  dragSource: 'staged' | 'unstaged' | 'untracked' | null
  handleDragOver: (section: 'staged' | 'unstaged', e: React.DragEvent) => void
  handleDrop: (section: 'staged' | 'unstaged', e: React.DragEvent) => Promise<void>
}

function StatusSection({
  title,
  count,
  files,
  collapsed,
  onToggle,
  onFileClick,
  onStageAction,
  stageActionIcon,
  stageActionTitle,
  selectedFile,
  selectedFiles,
  sectionClass,
  sectionKey,
  operationInProgress,
  onDragStart,
  onDragEnd,
  dropTargetSection,
  dragSource,
  handleDragOver,
  handleDrop
}: StatusSectionProps): React.JSX.Element | null {
  if (count === 0) return null

  // Determine if this section can accept drops
  const isDropTarget =
    (dropTargetSection === 'staged' && (dragSource === 'unstaged' || dragSource === 'untracked')) ||
    ((dropTargetSection === 'unstaged' || dropTargetSection === 'untracked') && dragSource === 'staged')

  const dropSection: 'staged' | 'unstaged' =
    dropTargetSection === 'staged' ? 'staged' :
    dropTargetSection === 'unstaged' ? 'unstaged' :
    dropTargetSection === 'untracked' ? 'staged' : 'staged'

  return (
    <div
      className={`status-section ${sectionClass} ${isDropTarget ? 'status-drop-target' : ''}`}
      onDragOver={(e) => {
        if (isDropTarget) {
          handleDragOver(dropSection, e)
        }
      }}
      onDrop={(e) => {
        if (isDropTarget) {
          handleDrop(dropSection, e)
        }
      }}
    >
      <button className="status-section-header" onClick={onToggle}>
        <span className={`status-section-arrow ${collapsed ? '' : 'expanded'}`}>&#9654;</span>
        <span className="status-section-title">{title}</span>
        <span className="status-section-count">{count}</span>
      </button>
      {!collapsed && (
        <div className="status-section-files">
          {files.map((file) => {
            const fileKey = `${sectionKey}:${file.path}`
            const isSelected =
              selectedFiles.has(fileKey) ||
              (selectedFiles.size === 0 &&
                selectedFile?.path === file.path &&
                selectedFile?.staged === file.staged)
            return (
              <div
                key={`${file.path}-${file.staged}`}
                className={`status-file-item ${isSelected ? 'selected' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(file, e)}
                onDragEnd={onDragEnd}
              >
                <button
                  className="status-file-info"
                  onClick={(e) => onFileClick(file, e)}
                  title={`${file.path} (${STATUS_LABELS[file.status] || file.status})`}
                >
                  <span className={`status-file-icon status-icon-${file.status}`}>
                    {STATUS_ICONS[file.status] || '?'}
                  </span>
                  <span className="status-file-name">{fileName(file.path)}</span>
                  {fileDir(file.path) && (
                    <span className="status-file-dir">{fileDir(file.path)}</span>
                  )}
                </button>
                <button
                  className={`status-stage-btn ${stageActionTitle === 'Stage' ? 'stage' : 'unstage'}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStageAction(file)
                  }}
                  disabled={operationInProgress}
                  title={`${stageActionTitle} ${file.path}`}
                >
                  {stageActionIcon}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
