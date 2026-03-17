import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FilePlus, FileEdit, FileMinus, ArrowRightLeft, Copy, HelpCircle, EyeOff, X, Pencil, Clock, Plus, Minus, RefreshCw, Check, AlertTriangle, ChevronRight, Trash2 } from 'lucide-react'
import { DiffViewer } from './DiffViewer'
import { ContextMenu, type ContextMenuEntry } from './ContextMenu'
import { openFileInEditor } from './CodeEditor'

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

const STATUS_ICONS: Record<string, React.ReactNode> = {
  added: <FilePlus size={14} />,
  modified: <FileEdit size={14} />,
  deleted: <FileMinus size={14} />,
  renamed: <ArrowRightLeft size={14} />,
  copied: <Copy size={14} />,
  untracked: <HelpCircle size={14} />,
  ignored: <EyeOff size={14} />
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
  const [fileContextMenu, setFileContextMenu] = useState<{
    x: number
    y: number
    file: FileStatus
  } | null>(null)
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

  // ─── Discard changes ────────────────────────────────────────────────────────
  const discardFile = useCallback(
    async (file: FileStatus) => {
      if (operationInProgress) return
      const isUntracked = file.status === 'untracked'
      const confirmed = window.confirm(
        `Discard changes to "${file.path}"?\n\nThis action is irreversible${isUntracked ? ' — the file will be deleted' : ''}.`
      )
      if (!confirmed) return
      setOperationInProgress(true)
      try {
        const result = await window.electronAPI.git.discardFiles(
          repoPath,
          [file.path],
          { untracked: isUntracked }
        )
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

  // ─── Discard All Changes ──────────────────────────────────────────────────
  const discardAllChanges = useCallback(async () => {
    if (operationInProgress || !status) return
    const totalFiles = status.unstaged.length + status.untracked.length
    if (totalFiles === 0) return
    const confirmed = window.confirm(
      `Discard ALL changes to ${totalFiles} file(s)?\n\nThis action is irreversible — all unstaged modifications will be lost and untracked files will be deleted.`
    )
    if (!confirmed) return
    setOperationInProgress(true)
    try {
      // Discard tracked file changes
      const trackedPaths = status.unstaged.map((f) => f.path)
      if (trackedPaths.length > 0) {
        await window.electronAPI.git.discardFiles(repoPath, trackedPaths)
      }
      // Delete untracked files
      const untrackedPaths = status.untracked.map((f) => f.path)
      if (untrackedPaths.length > 0) {
        await window.electronAPI.git.discardFiles(repoPath, untrackedPaths, { untracked: true })
      }
      await loadStatus()
      onRefresh?.()
    } finally {
      setOperationInProgress(false)
    }
  }, [operationInProgress, status, repoPath, loadStatus, onRefresh])

  // ─── File Context Menu ──────────────────────────────────────────────────────
  const handleFileContextMenu = useCallback(
    (file: FileStatus, x: number, y: number) => {
      setFileContextMenu({ x, y, file })
    },
    []
  )

  const buildFileContextMenuItems = useCallback(
    (file: FileStatus): ContextMenuEntry[] => {
      const isStaged = file.staged
      const isUntracked = file.status === 'untracked'
      const items: ContextMenuEntry[] = []

      if (isStaged) {
        items.push({
          key: 'unstage',
          label: 'Unstage',
          icon: <Minus size={14} />,
          shortcut: 'U',
          onClick: () => unstageFiles([file.path])
        })
      } else {
        items.push({
          key: 'stage',
          label: 'Stage',
          icon: <Plus size={14} />,
          shortcut: 'S',
          onClick: () => stageFiles([file.path])
        })
      }

      items.push({ key: 'sep1', separator: true })

      if (!isStaged) {
        items.push({
          key: 'discard',
          label: isUntracked ? 'Delete File' : 'Discard Changes',
          icon: <Trash2 size={14} />,
          danger: true,
          onClick: () => discardFile(file)
        })
        items.push({ key: 'sep2', separator: true })
      }

      items.push({
        key: 'openInEditor',
        label: 'Open in Editor',
        icon: <Pencil size={14} />,
        onClick: () => {
          const fullPath = repoPath + '/' + file.path
          openFileInEditor(fullPath)
        }
      })

      if (!isUntracked) {
        items.push({
          key: 'showHistory',
          label: 'Show History',
          icon: <Clock size={14} />,
          onClick: () => {
            window.dispatchEvent(
              new CustomEvent('commit-filter:file-history', { detail: { path: file.path } })
            )
          }
        })
      }

      return items
    },
    [repoPath, stageFiles, unstageFiles, discardFile]
  )

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
          <span><AlertTriangle size={14} /></span> {error}
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
              <Minus size={14} /> Unstage All
            </button>
          )}
          {hasUnstagedOrUntracked && (
            <button
              className="status-action-btn status-action-discard-all"
              onClick={discardAllChanges}
              disabled={operationInProgress}
              title="Discard All Changes (irreversible)"
            >
              <X size={14} /> Discard All
            </button>
          )}
          <button className="status-panel-refresh" onClick={loadStatus} title="Refresh status">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {isClean ? (
        <div className="status-panel-clean">
          <span className="status-panel-clean-icon"><Check size={16} /></span>
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
            stageActionIcon={<Minus size={14} />}
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
            onFileContextMenu={handleFileContextMenu}
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
            stageActionIcon={<Plus size={14} />}
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
            onFileContextMenu={handleFileContextMenu}
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
            stageActionIcon={<Plus size={14} />}
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
            onFileContextMenu={handleFileContextMenu}
          />
        </div>
      )}

      {/* Diff Viewer with Hunk/Line Staging */}
      {selectedFile && (
        <div className="status-diff-viewer">
          <div className="status-diff-header">
            <span className="status-diff-filename">
              {selectedFile.staged ? '(Staged) ' : ''}
              {selectedFile.path}
            </span>
            <button
              className="status-diff-close"
              onClick={() => {
                setSelectedFile(null)
                setDiffContent(null)
              }}
              title="Close diff"
            >
              <X size={14} />
            </button>
          </div>
          <div className="status-diff-content">
            {diffLoading ? (
              <div className="status-diff-loading">Loading diff...</div>
            ) : diffContent ? (
              <DiffViewerWithStaging
                diffContent={diffContent}
                filePath={selectedFile.path}
                staged={selectedFile.staged}
                isUntracked={selectedFile.isUntracked}
                repoPath={repoPath}
                onOperationDone={() => {
                  loadStatus()
                  onRefresh?.()
                }}
                operationInProgress={operationInProgress}
                setOperationInProgress={setOperationInProgress}
              />
            ) : (
              <div className="status-diff-empty">No changes to display</div>
            )}
          </div>
        </div>
      )}

      {/* File Context Menu */}
      {fileContextMenu && (
        <ContextMenu
          x={fileContextMenu.x}
          y={fileContextMenu.y}
          items={buildFileContextMenuItems(fileContextMenu.file)}
          onClose={() => setFileContextMenu(null)}
        />
      )}
    </div>
  )
}

// ─── Diff Hunk Parser & Viewer ───────────────────────────────────────────────

interface DiffHunk {
  header: string // e.g. "@@ -10,5 +10,7 @@"
  lines: DiffLine[]
}

interface DiffLine {
  type: 'context' | 'added' | 'removed'
  content: string // full line including +/-/space prefix
  oldLineNum: number | null
  newLineNum: number | null
}

interface FileHeader {
  lines: string[] // "diff --git ...", "index ...", "--- a/...", "+++ b/..."
}

function parseDiff(diffText: string): { fileHeader: FileHeader; hunks: DiffHunk[] } {
  const allLines = diffText.split('\n')
  const fileHeaderLines: string[] = []
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let inHeader = true

  for (const line of allLines) {
    if (line.startsWith('@@')) {
      inHeader = false
      // Parse hunk header: @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLine = match ? parseInt(match[1], 10) : 1
      newLine = match ? parseInt(match[2], 10) : 1
      currentHunk = { header: line, lines: [] }
      hunks.push(currentHunk)
    } else if (inHeader) {
      fileHeaderLines.push(line)
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'added', content: line, oldLineNum: null, newLineNum: newLine })
        newLine++
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'removed', content: line, oldLineNum: oldLine, newLineNum: null })
        oldLine++
      } else if (line.startsWith('\\')) {
        // "\ No newline at end of file" — keep in hunk but don't count
        currentHunk.lines.push({ type: 'context', content: line, oldLineNum: null, newLineNum: null })
      } else {
        // Context line (starts with space or is empty)
        currentHunk.lines.push({ type: 'context', content: line, oldLineNum: oldLine, newLineNum: newLine })
        oldLine++
        newLine++
      }
    }
  }

  return { fileHeader: { lines: fileHeaderLines }, hunks }
}

/**
 * Build a patch string for a single hunk suitable for `git apply --cached`.
 */
function buildHunkPatch(fileHeader: FileHeader, hunk: DiffHunk): string {
  const headerStr = fileHeader.lines.join('\n')
  const hunkLines = [hunk.header, ...hunk.lines.map((l) => l.content)].join('\n')
  return headerStr + '\n' + hunkLines + '\n'
}

/**
 * Build a patch for selected lines within a hunk.
 * For staging: keep selected added lines, convert unselected added lines to context, keep all removed lines or only selected ones.
 * For unstaging (reverse): similar but inverted.
 */
function buildLinesPatch(
  fileHeader: FileHeader,
  hunk: DiffHunk,
  selectedLineIndices: Set<number>,
  forStaging: boolean
): string {
  // We need to rebuild the hunk with only the selected lines as changes
  // Unselected added lines → removed from patch (not included)
  // Unselected removed lines → converted to context lines
  const newHunkLines: string[] = []
  let oldCount = 0
  let newCount = 0

  // Parse the original header to get the start lines
  const headerMatch = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
  const oldStart = headerMatch ? parseInt(headerMatch[1], 10) : 1
  const newStart = headerMatch ? parseInt(headerMatch[2], 10) : 1
  const headerSuffix = headerMatch ? headerMatch[3] : ''

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]
    const isSelected = selectedLineIndices.has(i)

    if (line.content.startsWith('\\')) {
      // "No newline" marker — include as-is
      newHunkLines.push(line.content)
      continue
    }

    if (line.type === 'context') {
      newHunkLines.push(line.content)
      oldCount++
      newCount++
    } else if (line.type === 'added') {
      if (isSelected) {
        // Keep as added
        newHunkLines.push(line.content)
        newCount++
      }
      // If not selected, just skip it (don't add it)
    } else if (line.type === 'removed') {
      if (isSelected) {
        // Keep as removed
        newHunkLines.push(line.content)
        oldCount++
      } else {
        // Convert to context (keep the line but as unchanged)
        newHunkLines.push(' ' + line.content.substring(1))
        oldCount++
        newCount++
      }
    }
  }

  if (newHunkLines.length === 0) return ''

  const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${headerSuffix}`
  const headerStr = fileHeader.lines.join('\n')
  return headerStr + '\n' + newHeader + '\n' + newHunkLines.join('\n') + '\n'
}

interface HunkDiffViewerProps {
  diffContent: string
  filePath: string
  staged: boolean
  isUntracked: boolean
  repoPath: string
  onOperationDone: () => void
  operationInProgress: boolean
  setOperationInProgress: (v: boolean) => void
}

function HunkDiffViewer({
  diffContent,
  filePath,
  staged,
  isUntracked,
  repoPath,
  onOperationDone,
  operationInProgress,
  setOperationInProgress
}: HunkDiffViewerProps): React.JSX.Element {
  const [selectedLines, setSelectedLines] = useState<Map<number, Set<number>>>(new Map()) // hunkIdx → set of line indices

  const { fileHeader, hunks } = React.useMemo(() => parseDiff(diffContent), [diffContent])

  // Reset selections when diff changes
  useEffect(() => {
    setSelectedLines(new Map())
  }, [diffContent])

  const hasValidHeader = fileHeader.lines.some((l) => l.startsWith('diff --git'))

  const toggleLineSelection = useCallback((hunkIdx: number, lineIdx: number, e: React.MouseEvent) => {
    setSelectedLines((prev) => {
      const next = new Map(prev)
      const hunkSet = new Set(next.get(hunkIdx) || [])

      if (e.shiftKey && hunkSet.size > 0) {
        // Range select from last selected to this one
        const arr = Array.from(hunkSet).sort((a, b) => a - b)
        const lastSelected = arr[arr.length - 1]
        const start = Math.min(lastSelected, lineIdx)
        const end = Math.max(lastSelected, lineIdx)
        for (let i = start; i <= end; i++) {
          const line = hunks[hunkIdx].lines[i]
          if (line && line.type !== 'context' && !line.content.startsWith('\\')) {
            hunkSet.add(i)
          }
        }
      } else {
        if (hunkSet.has(lineIdx)) {
          hunkSet.delete(lineIdx)
        } else {
          hunkSet.add(lineIdx)
        }
      }

      if (hunkSet.size === 0) {
        next.delete(hunkIdx)
      } else {
        next.set(hunkIdx, hunkSet)
      }
      return next
    })
  }, [hunks])

  const handleStageHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.stageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleUnstageHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleStageSelectedLines = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const lineIndices = selectedLines.get(hunkIdx)
      if (!lineIndices || lineIndices.size === 0) return

      setOperationInProgress(true)
      try {
        const patch = buildLinesPatch(fileHeader, hunks[hunkIdx], lineIndices, true)
        if (!patch) return
        const result = await window.electronAPI.git.stageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
          setSelectedLines(new Map())
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, selectedLines, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleUnstageSelectedLines = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const lineIndices = selectedLines.get(hunkIdx)
      if (!lineIndices || lineIndices.size === 0) return

      setOperationInProgress(true)
      try {
        const patch = buildLinesPatch(fileHeader, hunks[hunkIdx], lineIndices, false)
        if (!patch) return
        const result = await window.electronAPI.git.unstageHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
          setSelectedLines(new Map())
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, selectedLines, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  const handleDiscardHunk = useCallback(
    async (hunkIdx: number) => {
      if (operationInProgress || !hasValidHeader) return
      const confirmed = window.confirm(
        'Discard this hunk?\n\nThis action is irreversible — the changes will be permanently lost.'
      )
      if (!confirmed) return
      setOperationInProgress(true)
      try {
        const patch = buildHunkPatch(fileHeader, hunks[hunkIdx])
        const result = await window.electronAPI.git.discardHunk(repoPath, patch)
        if (result.success) {
          onOperationDone()
        }
      } finally {
        setOperationInProgress(false)
      }
    },
    [operationInProgress, hasValidHeader, fileHeader, hunks, repoPath, onOperationDone, setOperationInProgress]
  )

  // If it's not a parseable diff (e.g. untracked file placeholder text), show raw
  if (hunks.length === 0 || !hasValidHeader) {
    return <pre className="status-diff-pre">{diffContent}</pre>
  }

  return (
    <div className="hunk-diff-viewer">
      {hunks.map((hunk, hunkIdx) => {
        const hunkSelectedLines = selectedLines.get(hunkIdx)
        const hasSelection = hunkSelectedLines && hunkSelectedLines.size > 0
        return (
          <div key={hunkIdx} className="hunk-block">
            <div className="hunk-header">
              <span className="hunk-header-text">{hunk.header}</span>
              <div className="hunk-actions">
                {hasSelection && !staged && (
                  <button
                    className="hunk-action-btn hunk-stage-lines"
                    onClick={() => handleStageSelectedLines(hunkIdx)}
                    disabled={operationInProgress}
                    title={`Stage ${hunkSelectedLines!.size} selected line(s)`}
                  >
                    + Stage Lines ({hunkSelectedLines!.size})
                  </button>
                )}
                {hasSelection && staged && (
                  <button
                    className="hunk-action-btn hunk-unstage-lines"
                    onClick={() => handleUnstageSelectedLines(hunkIdx)}
                    disabled={operationInProgress}
                    title={`Unstage ${hunkSelectedLines!.size} selected line(s)`}
                  >
                    <Minus size={14} /> Unstage Lines ({hunkSelectedLines!.size})
                  </button>
                )}
                {!staged && !isUntracked && (
                  <button
                    className="hunk-action-btn hunk-stage"
                    onClick={() => handleStageHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Stage this hunk"
                  >
                    + Stage Hunk
                  </button>
                )}
                {!staged && !isUntracked && (
                  <button
                    className="hunk-action-btn hunk-discard"
                    onClick={() => handleDiscardHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Discard this hunk (irreversible)"
                  >
                    <X size={14} /> Discard Hunk
                  </button>
                )}
                {staged && (
                  <button
                    className="hunk-action-btn hunk-unstage"
                    onClick={() => handleUnstageHunk(hunkIdx)}
                    disabled={operationInProgress}
                    title="Unstage this hunk"
                  >
                    <Minus size={14} /> Unstage Hunk
                  </button>
                )}
              </div>
            </div>
            <div className="hunk-lines">
              {hunk.lines.map((line, lineIdx) => {
                const isSelectable = line.type !== 'context' && !line.content.startsWith('\\')
                const isSelected = hunkSelectedLines?.has(lineIdx) ?? false
                return (
                  <div
                    key={lineIdx}
                    className={[
                      'hunk-line',
                      `hunk-line-${line.type}`,
                      isSelected ? 'hunk-line-selected' : '',
                      isSelectable ? 'hunk-line-selectable' : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={isSelectable ? (e) => toggleLineSelection(hunkIdx, lineIdx, e) : undefined}
                  >
                    <span className="hunk-line-num hunk-line-num-old">
                      {line.oldLineNum ?? ''}
                    </span>
                    <span className="hunk-line-num hunk-line-num-new">
                      {line.newLineNum ?? ''}
                    </span>
                    {isSelectable && (
                      <span className={`hunk-line-checkbox ${isSelected ? 'checked' : ''}`}>
                        {isSelected ? <Check size={12} /> : <span className="hunk-line-unchecked" />}
                      </span>
                    )}
                    {!isSelectable && <span className="hunk-line-checkbox-spacer" />}
                    <span className="hunk-line-content">{line.content}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Diff Viewer with Staging Toggle ─────────────────────────────────────────

interface DiffViewerWithStagingProps {
  diffContent: string
  filePath: string
  staged: boolean
  isUntracked: boolean
  repoPath: string
  onOperationDone: () => void
  operationInProgress: boolean
  setOperationInProgress: (v: boolean) => void
}

function DiffViewerWithStaging(props: DiffViewerWithStagingProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<'staging' | 'enhanced'>('staging')

  return (
    <div className="diff-viewer-with-staging">
      <div className="diff-viewer-tab-bar">
        <button
          className={`diff-viewer-tab ${viewMode === 'staging' ? 'active' : ''}`}
          onClick={() => setViewMode('staging')}
          title="Staging view with hunk/line controls"
        >
          Staging
        </button>
        <button
          className={`diff-viewer-tab ${viewMode === 'enhanced' ? 'active' : ''}`}
          onClick={() => setViewMode('enhanced')}
          title="Enhanced diff view with side-by-side mode and syntax highlighting"
        >
          Enhanced View
        </button>
      </div>
      {viewMode === 'staging' ? (
        <HunkDiffViewer
          diffContent={props.diffContent}
          filePath={props.filePath}
          staged={props.staged}
          isUntracked={props.isUntracked}
          repoPath={props.repoPath}
          onOperationDone={props.onOperationDone}
          operationInProgress={props.operationInProgress}
          setOperationInProgress={props.setOperationInProgress}
        />
      ) : (
        <DiffViewer
          diffContent={props.diffContent}
          filePath={props.filePath}
        />
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
  stageActionIcon: React.ReactNode
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
  onFileContextMenu: (file: FileStatus, x: number, y: number) => void
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
  handleDrop,
  onFileContextMenu
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
        <span className={`status-section-arrow ${collapsed ? '' : 'expanded'}`}><ChevronRight size={14} /></span>
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
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onFileContextMenu(file, e.clientX, e.clientY)
                }}
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
