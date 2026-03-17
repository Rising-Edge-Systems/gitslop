import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { Folder, FileCode, FileJson, FileText, Palette, Globe, Image, Settings, Lock, Terminal, FileType, Coffee, File, Ban, KeyRound, ChevronRight, Pencil, Clock, User, Clipboard, X } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface FileTreeProps {
  currentRepo: string | null
  onOpenFile?: (filePath: string) => void
  onShowHistory?: (filePath: string) => void
  onShowBlame?: (filePath: string) => void
}

interface FileEntry {
  path: string
  name: string
  isDirectory: boolean
  children: FileEntry[]
  status?: FileStatus
}

type FileStatus = 'modified' | 'staged' | 'untracked' | 'conflicted' | 'deleted' | 'added' | 'renamed' | null

interface FileContextMenuState {
  x: number
  y: number
  filePath: string
  isDirectory: boolean
}

// ─── File Icon Helper ────────────────────────────────────────────────────────

function getFileIcon(name: string, isDirectory: boolean): React.ReactNode {
  if (isDirectory) return <Folder size={14} />

  const ext = name.split('.').pop()?.toLowerCase() || ''
  const iconMap: Record<string, React.ReactNode> = {
    ts: <FileCode size={14} />,
    tsx: <FileCode size={14} />,
    js: <FileCode size={14} />,
    jsx: <FileCode size={14} />,
    json: <FileJson size={14} />,
    md: <FileText size={14} />,
    css: <Palette size={14} />,
    scss: <Palette size={14} />,
    html: <Globe size={14} />,
    svg: <Image size={14} />,
    png: <Image size={14} />,
    jpg: <Image size={14} />,
    jpeg: <Image size={14} />,
    gif: <Image size={14} />,
    ico: <Image size={14} />,
    yml: <Settings size={14} />,
    yaml: <Settings size={14} />,
    toml: <Settings size={14} />,
    lock: <Lock size={14} />,
    sh: <Terminal size={14} />,
    bash: <Terminal size={14} />,
    zsh: <Terminal size={14} />,
    py: <FileCode size={14} />,
    rs: <FileCode size={14} />,
    go: <FileCode size={14} />,
    java: <Coffee size={14} />,
    c: <FileCode size={14} />,
    cpp: <FileCode size={14} />,
    h: <FileCode size={14} />,
    txt: <File size={14} />,
    gitignore: <Ban size={14} />,
    env: <KeyRound size={14} />,
  }
  return iconMap[ext] || <File size={14} />
}

// ─── Status indicator ────────────────────────────────────────────────────────

function getStatusIndicator(status: FileStatus): { symbol: string; className: string; title: string } | null {
  switch (status) {
    case 'modified':
      return { symbol: 'M', className: 'file-status-modified', title: 'Modified' }
    case 'staged':
      return { symbol: 'S', className: 'file-status-staged', title: 'Staged' }
    case 'untracked':
      return { symbol: 'U', className: 'file-status-untracked', title: 'Untracked' }
    case 'conflicted':
      return { symbol: '!', className: 'file-status-conflicted', title: 'Conflicted' }
    case 'deleted':
      return { symbol: 'D', className: 'file-status-deleted', title: 'Deleted' }
    case 'added':
      return { symbol: 'A', className: 'file-status-added', title: 'Added' }
    case 'renamed':
      return { symbol: 'R', className: 'file-status-renamed', title: 'Renamed' }
    default:
      return null
  }
}

// ─── Build tree from flat file list ──────────────────────────────────────────

function buildFileTree(
  files: string[],
  statusMap: Map<string, FileStatus>
): FileEntry[] {
  const root: FileEntry[] = []
  const dirMap = new Map<string, FileEntry>()

  // Sort files for consistent ordering
  const sortedFiles = [...files].sort((a, b) => a.localeCompare(b))

  for (const filePath of sortedFiles) {
    const parts = filePath.split('/')
    let current = root
    let currentPath = ''

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      currentPath = currentPath ? `${currentPath}/${part}` : part
      const isLast = i === parts.length - 1

      if (isLast) {
        // File node
        current.push({
          path: filePath,
          name: part,
          isDirectory: false,
          children: [],
          status: statusMap.get(filePath) || null
        })
      } else {
        // Directory node
        let dir = dirMap.get(currentPath)
        if (!dir) {
          dir = {
            path: currentPath,
            name: part,
            isDirectory: true,
            children: [],
            status: null
          }
          dirMap.set(currentPath, dir)
          current.push(dir)
        }
        current = dir.children
      }
    }
  }

  // Propagate status up to directories
  function propagateStatus(entries: FileEntry[]): FileStatus {
    let dirStatus: FileStatus = null
    for (const entry of entries) {
      if (entry.isDirectory) {
        const childStatus = propagateStatus(entry.children)
        entry.status = childStatus
        if (childStatus) dirStatus = childStatus
      } else if (entry.status) {
        dirStatus = entry.status
      }
    }
    return dirStatus
  }
  propagateStatus(root)

  // Sort: directories first, then files, alphabetically
  function sortEntries(entries: FileEntry[]): void {
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1
      if (!a.isDirectory && b.isDirectory) return 1
      return a.name.localeCompare(b.name)
    })
    for (const entry of entries) {
      if (entry.isDirectory) {
        sortEntries(entry.children)
      }
    }
  }
  sortEntries(root)

  return root
}

// ─── Filter tree ─────────────────────────────────────────────────────────────

function filterTree(entries: FileEntry[], filter: string): FileEntry[] {
  if (!filter) return entries
  const lower = filter.toLowerCase()

  function matchesFilter(entry: FileEntry): boolean {
    if (entry.name.toLowerCase().includes(lower)) return true
    if (entry.path.toLowerCase().includes(lower)) return true
    if (entry.isDirectory) {
      return entry.children.some(matchesFilter)
    }
    return false
  }

  function filterEntries(entries: FileEntry[]): FileEntry[] {
    return entries
      .filter(matchesFilter)
      .map((entry) => {
        if (entry.isDirectory) {
          return { ...entry, children: filterEntries(entry.children) }
        }
        return entry
      })
  }

  return filterEntries(entries)
}

// ─── TreeNode Component ──────────────────────────────────────────────────────

interface TreeNodeProps {
  entry: FileEntry
  depth: number
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onDoubleClickFile: (path: string) => void
  onContextMenu: (e: React.MouseEvent, path: string, isDirectory: boolean) => void
}

function TreeNode({
  entry,
  depth,
  expandedDirs,
  onToggleDir,
  onDoubleClickFile,
  onContextMenu
}: TreeNodeProps): React.JSX.Element {
  const isExpanded = expandedDirs.has(entry.path)
  const statusIndicator = getStatusIndicator(entry.status ?? null)

  const handleClick = useCallback(() => {
    if (entry.isDirectory) {
      onToggleDir(entry.path)
    }
  }, [entry.isDirectory, entry.path, onToggleDir])

  const handleDoubleClick = useCallback(() => {
    if (!entry.isDirectory) {
      onDoubleClickFile(entry.path)
    }
  }, [entry.isDirectory, entry.path, onDoubleClickFile])

  const handleContextMenuEvent = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(e, entry.path, entry.isDirectory)
    },
    [entry.path, entry.isDirectory, onContextMenu]
  )

  return (
    <>
      <div
        className={`file-tree-node ${entry.isDirectory ? 'file-tree-dir' : 'file-tree-file'} ${statusIndicator ? statusIndicator.className : ''}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenuEvent}
        title={entry.path}
      >
        {entry.isDirectory && (
          <span className={`file-tree-chevron ${isExpanded ? 'open' : ''}`}><ChevronRight size={12} /></span>
        )}
        <span className="file-tree-icon">{getFileIcon(entry.name, entry.isDirectory)}</span>
        <span className="file-tree-name">{entry.name}</span>
        {statusIndicator && (
          <span className={`file-tree-status ${statusIndicator.className}`} title={statusIndicator.title}>
            {statusIndicator.symbol}
          </span>
        )}
      </div>
      {entry.isDirectory && isExpanded && (
        <div className="file-tree-children">
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onDoubleClickFile={onDoubleClickFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ─── FileTreeContextMenu ─────────────────────────────────────────────────────

interface FileTreeContextMenuProps {
  state: FileContextMenuState
  onClose: () => void
  onOpenInEditor: (path: string) => void
  onShowHistory: (path: string) => void
  onShowBlame: (path: string) => void
  onCopyPath: (path: string) => void
}

function FileTreeContextMenu({
  state,
  onClose,
  onOpenInEditor,
  onShowHistory,
  onShowBlame,
  onCopyPath
}: FileTreeContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

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
      {!state.isDirectory && (
        <button
          className="branch-ctx-menu-item"
          onClick={() => {
            onOpenInEditor(state.filePath)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon"><Pencil size={14} /></span>
          <span className="branch-ctx-menu-label">Open in Editor</span>
        </button>
      )}
      {!state.isDirectory && (
        <button
          className="branch-ctx-menu-item"
          onClick={() => {
            onShowHistory(state.filePath)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon"><Clock size={14} /></span>
          <span className="branch-ctx-menu-label">Show History</span>
        </button>
      )}
      {!state.isDirectory && (
        <button
          className="branch-ctx-menu-item"
          onClick={() => {
            onShowBlame(state.filePath)
            onClose()
          }}
        >
          <span className="branch-ctx-menu-icon"><User size={14} /></span>
          <span className="branch-ctx-menu-label">Show Blame</span>
        </button>
      )}
      <div className="branch-ctx-menu-separator" />
      <button
        className="branch-ctx-menu-item"
        onClick={() => {
          onCopyPath(state.filePath)
          onClose()
        }}
      >
        <span className="branch-ctx-menu-icon"><Clipboard size={14} /></span>
        <span className="branch-ctx-menu-label">Copy Path</span>
      </button>
    </div>
  )
}

// ─── Main FileTree Component ─────────────────────────────────────────────────

export function FileTree({ currentRepo, onOpenFile, onShowHistory, onShowBlame }: FileTreeProps): React.JSX.Element {
  const [files, setFiles] = useState<string[]>([])
  const [statusMap, setStatusMap] = useState<Map<string, FileStatus>>(new Map())
  const [loading, setLoading] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [contextMenu, setContextMenu] = useState<FileContextMenuState | null>(null)

  // ─── Load file list ──────────────────────────────────────────────────────

  const loadFiles = useCallback(async () => {
    if (!currentRepo) {
      setFiles([])
      setStatusMap(new Map())
      return
    }
    setLoading(true)
    try {
      // Get tracked files via git ls-files
      const lsResult = await window.electronAPI.git.exec(
        ['ls-files', '--full-name'],
        currentRepo
      )
      let fileList: string[] = []
      if (lsResult.success && lsResult.data) {
        const output = typeof lsResult.data === 'string'
          ? lsResult.data
          : lsResult.data.stdout?.toString() ?? ''
        fileList = output
          .split('\n')
          .map((f: string) => f.trim())
          .filter((f: string) => f.length > 0)
      }

      // Also get untracked files
      const untrackedResult = await window.electronAPI.git.exec(
        ['ls-files', '--others', '--exclude-standard'],
        currentRepo
      )
      if (untrackedResult.success && untrackedResult.data) {
        const output = typeof untrackedResult.data === 'string'
          ? untrackedResult.data
          : untrackedResult.data.stdout?.toString() ?? ''
        const untracked = output
          .split('\n')
          .map((f: string) => f.trim())
          .filter((f: string) => f.length > 0)
        fileList = [...fileList, ...untracked]
      }

      // Get git status for status indicators
      const statusResult = await window.electronAPI.git.getStatus(currentRepo)
      const newStatusMap = new Map<string, FileStatus>()

      if (statusResult.success && statusResult.data) {
        const statusData = statusResult.data as {
          staged: { path: string; type: string }[]
          unstaged: { path: string; type: string }[]
          untracked: { path: string }[]
          conflicted?: { path: string }[]
        }

        if (statusData.staged) {
          for (const file of statusData.staged) {
            newStatusMap.set(file.path, 'staged')
          }
        }
        if (statusData.unstaged) {
          for (const file of statusData.unstaged) {
            const type = file.type?.toLowerCase()
            if (type === 'deleted' || type === 'd') {
              newStatusMap.set(file.path, 'deleted')
            } else {
              newStatusMap.set(file.path, 'modified')
            }
          }
        }
        if (statusData.untracked) {
          for (const file of statusData.untracked) {
            newStatusMap.set(file.path, 'untracked')
          }
        }
        if (statusData.conflicted) {
          for (const file of statusData.conflicted) {
            newStatusMap.set(file.path, 'conflicted')
          }
        }
      }

      // Deduplicate
      fileList = [...new Set(fileList)]

      setFiles(fileList)
      setStatusMap(newStatusMap)
    } catch {
      // Ignore errors
    } finally {
      setLoading(false)
    }
  }, [currentRepo])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  // Refresh on repo changes
  useEffect(() => {
    if (!currentRepo) return
    const cleanup = window.electronAPI.onRepoChanged(() => {
      loadFiles()
    })
    return cleanup
  }, [currentRepo, loadFiles])

  // ─── Tree data ───────────────────────────────────────────────────────────

  const tree = useMemo(() => buildFileTree(files, statusMap), [files, statusMap])
  const filteredTree = useMemo(() => filterTree(tree, filter), [tree, filter])

  // ─── Handlers ────────────────────────────────────────────────────────────

  const handleToggleDir = useCallback((path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const handleDoubleClickFile = useCallback(
    (filePath: string) => {
      if (onOpenFile) {
        onOpenFile(filePath)
      }
    },
    [onOpenFile]
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, filePath: string, isDirectory: boolean) => {
      setContextMenu({ x: e.clientX, y: e.clientY, filePath, isDirectory })
    },
    []
  )

  const handleCopyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).catch(() => {
      // Ignore clipboard errors
    })
  }, [])

  // ─── Render ──────────────────────────────────────────────────────────────

  if (!currentRepo) {
    return (
      <div className="file-tree-container">
        <div className="sidebar-placeholder">No repository open</div>
      </div>
    )
  }

  return (
    <div className="file-tree-container">
      {/* Search / filter */}
      <div className="sidebar-search-box">
        <input
          type="text"
          className="sidebar-search-input"
          placeholder="Filter files..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        {filter && (
          <button className="sidebar-search-clear" onClick={() => setFilter('')}>
            <X size={12} />
          </button>
        )}
      </div>

      {/* File tree */}
      <div className="file-tree-list">
        {loading && files.length === 0 ? (
          <div className="sidebar-placeholder">Loading files...</div>
        ) : filteredTree.length === 0 ? (
          <div className="sidebar-placeholder">
            {filter ? 'No matching files' : 'No files in repository'}
          </div>
        ) : (
          filteredTree.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
              onDoubleClickFile={handleDoubleClickFile}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <FileTreeContextMenu
          state={contextMenu}
          onClose={() => setContextMenu(null)}
          onOpenInEditor={(path) => onOpenFile?.(path)}
          onShowHistory={(path) => onShowHistory?.(path)}
          onShowBlame={(path) => onShowBlame?.(path)}
          onCopyPath={handleCopyPath}
        />
      )}
    </div>
  )
}
