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
  const [diffContent, setDiffContent] = useState<string | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

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
      // Debounce the refresh
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

  // Load diff when a file is selected
  const handleFileClick = useCallback(
    async (file: FileStatus, isUntracked: boolean) => {
      const fileKey = { path: file.path, staged: file.staged, isUntracked }
      setSelectedFile(fileKey)
      setDiffLoading(true)
      setDiffContent(null)

      try {
        if (isUntracked) {
          // For untracked files, show file contents using git show or just indicate it's new
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
    [repoPath]
  )

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }))
  }, [])

  const isClean =
    status &&
    status.staged.length === 0 &&
    status.unstaged.length === 0 &&
    status.untracked.length === 0

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
    <div className="status-panel">
      <div className="status-panel-header">
        <h3 className="status-panel-title">Working Directory</h3>
        <button className="status-panel-refresh" onClick={loadStatus} title="Refresh status">
          &#x21BB;
        </button>
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
            onFileClick={(f) => handleFileClick(f, false)}
            selectedFile={selectedFile}
            sectionClass="status-staged"
          />

          {/* Unstaged Section */}
          <StatusSection
            title="Unstaged"
            count={status?.unstaged.length ?? 0}
            files={status?.unstaged ?? []}
            collapsed={!!collapsedSections['unstaged']}
            onToggle={() => toggleSection('unstaged')}
            onFileClick={(f) => handleFileClick(f, false)}
            selectedFile={selectedFile}
            sectionClass="status-unstaged"
          />

          {/* Untracked Section */}
          <StatusSection
            title="Untracked"
            count={status?.untracked.length ?? 0}
            files={status?.untracked ?? []}
            collapsed={!!collapsedSections['untracked']}
            onToggle={() => toggleSection('untracked')}
            onFileClick={(f) => handleFileClick(f, true)}
            selectedFile={selectedFile}
            sectionClass="status-untracked"
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
  onFileClick: (file: FileStatus) => void
  selectedFile: { path: string; staged: boolean; isUntracked: boolean } | null
  sectionClass: string
}

function StatusSection({
  title,
  count,
  files,
  collapsed,
  onToggle,
  onFileClick,
  selectedFile,
  sectionClass
}: StatusSectionProps): React.JSX.Element | null {
  if (count === 0) return null

  return (
    <div className={`status-section ${sectionClass}`}>
      <button className="status-section-header" onClick={onToggle}>
        <span className={`status-section-arrow ${collapsed ? '' : 'expanded'}`}>&#9654;</span>
        <span className="status-section-title">{title}</span>
        <span className="status-section-count">{count}</span>
      </button>
      {!collapsed && (
        <div className="status-section-files">
          {files.map((file) => {
            const isSelected =
              selectedFile?.path === file.path && selectedFile?.staged === file.staged
            return (
              <button
                key={`${file.path}-${file.staged}`}
                className={`status-file-item ${isSelected ? 'selected' : ''}`}
                onClick={() => onFileClick(file)}
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
            )
          })}
        </div>
      )}
    </div>
  )
}
