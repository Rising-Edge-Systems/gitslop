import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  GitCommit,
  User,
  Calendar,
  FileText,
  ShieldCheck,
  ShieldAlert,
  FilePlus,
  FileMinus,
  FileEdit,
  FileSymlink,
  Copy,
  Check,
  Loader2,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { DiffViewer } from './DiffViewer'
import styles from './DetailPanel.module.css'
import type { CommitDetail, CommitFileDetail } from './CommitGraph'

interface DetailPanelProps {
  detail: CommitDetail
  repoPath: string | null
  onClose: () => void
  /** When true, renders as a sliding overlay instead of an inline panel */
  overlay?: boolean
}

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay < 30) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function formatAbsoluteDate(dateStr: string): string {
  const date = new Date(dateStr)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Returns the appropriate Lucide icon for a file status */
function FileStatusIcon({ status, size = 12 }: { status: string; size?: number }): React.JSX.Element {
  switch (status) {
    case 'A':
      return <FilePlus size={size} className={styles.fileAdded} />
    case 'D':
      return <FileMinus size={size} className={styles.fileDeleted} />
    case 'R':
    case 'C':
      return <FileSymlink size={size} className={styles.fileRenamed} />
    case 'M':
    default:
      return <FileEdit size={size} className={styles.fileModified} />
  }
}

/** Extracts just the filename from a full path */
function splitPath(filePath: string): { dir: string; name: string } {
  const lastSlash = filePath.lastIndexOf('/')
  if (lastSlash === -1) return { dir: '', name: filePath }
  return { dir: filePath.substring(0, lastSlash + 1), name: filePath.substring(lastSlash + 1) }
}

export function DetailPanel({ detail, repoPath, onClose, overlay = false }: DetailPanelProps): React.JSX.Element {
  const { commit, fileDetails, totalInsertions, totalDeletions, refs } = detail
  const sigOk = commit.signatureStatus === 'good'
  const sigBad = commit.signatureStatus === 'bad' || commit.signatureStatus === 'error'
  const hasSig = commit.signatureStatus !== 'none'
  const panelRef = useRef<HTMLDivElement>(null)
  const [copiedSha, setCopiedSha] = useState(false)
  const [selectedFile, setSelectedFile] = useState<CommitFileDetail | null>(null)
  const [diffContent, setDiffContent] = useState<string>('')
  const [loadingDiff, setLoadingDiff] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(true)

  // Reset selected file when commit changes
  useEffect(() => {
    setSelectedFile(null)
    setDiffContent('')
  }, [commit.hash])

  // Close on Escape key when in overlay mode
  useEffect(() => {
    if (!overlay) return
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [overlay, onClose])

  // Click outside handler for overlay backdrop
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

  // Copy SHA to clipboard
  const handleCopySha = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(commit.hash)
      setCopiedSha(true)
      setTimeout(() => setCopiedSha(false), 2000)
    } catch {
      // Fallback: select all text
    }
  }, [commit.hash])

  // Load file diff
  const handleFileClick = useCallback(async (file: CommitFileDetail) => {
    if (!repoPath) return

    // Toggle off if same file clicked again
    if (selectedFile?.path === file.path) {
      setSelectedFile(null)
      setDiffContent('')
      return
    }

    setSelectedFile(file)
    setLoadingDiff(true)
    try {
      const result = await window.electronAPI.git.showCommitFileDiff(repoPath, commit.hash, file.path)
      if (result.success && result.data) {
        setDiffContent(result.data as string)
      } else {
        setDiffContent('')
      }
    } catch {
      setDiffContent('')
    } finally {
      setLoadingDiff(false)
    }
  }, [repoPath, commit.hash, selectedFile?.path])

  const fileCount = fileDetails.length

  const panelContent = (
    <div
      ref={panelRef}
      className={`${styles.detailPanel} ${overlay ? styles.detailPanelOverlay : ''}`}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>Commit Details</span>
        <button className={styles.closeBtn} onClick={onClose} title="Close detail panel">
          <X size={16} />
        </button>
      </div>

      <div className={styles.content}>
        {/* Commit subject */}
        <h3 className={styles.subject}>{commit.subject}</h3>

        {/* Refs (branches, tags) */}
        {refs.length > 0 && (
          <div className={styles.refs}>
            {refs.map((ref) => (
              <span key={ref.name} className={`${styles.refBadge} ${styles[`ref${ref.type.charAt(0).toUpperCase()}${ref.type.slice(1)}`] || ''}`}>
                {ref.name}
              </span>
            ))}
          </div>
        )}

        {/* Metadata */}
        <div className={styles.meta}>
          <div className={styles.metaRow}>
            <GitCommit size={14} className={styles.metaIcon} />
            <code
              className={styles.sha}
              onClick={handleCopySha}
              title="Click to copy full SHA"
            >
              {commit.hash}
            </code>
            <button className={styles.copyBtn} onClick={handleCopySha} title="Copy SHA">
              {copiedSha ? <Check size={12} className={styles.copySuccess} /> : <Copy size={12} />}
            </button>
          </div>
          <div className={styles.metaRow}>
            <User size={14} className={styles.metaIcon} />
            <span>{commit.authorName} &lt;{commit.authorEmail}&gt;</span>
          </div>
          <div className={styles.metaRow}>
            <Calendar size={14} className={styles.metaIcon} />
            <span className={styles.dateAbsolute}>{formatAbsoluteDate(commit.authorDate)}</span>
            <span className={styles.dateRelative}>({formatRelativeDate(commit.authorDate)})</span>
          </div>
          {hasSig && (
            <div className={styles.metaRow}>
              {sigOk ? <ShieldCheck size={14} className={styles.sigGood} /> : sigBad ? <ShieldAlert size={14} className={styles.sigBad} /> : <ShieldAlert size={14} className={styles.metaIcon} />}
              <span>{sigOk ? 'Verified' : sigBad ? 'Bad signature' : commit.signatureStatus}</span>
            </div>
          )}
        </div>

        {/* Body */}
        {commit.body && (
          <pre className={styles.body}>{commit.body}</pre>
        )}

        {/* Changed files */}
        <div className={styles.filesSection}>
          <button
            className={styles.filesHeader}
            onClick={() => setFilesExpanded(!filesExpanded)}
          >
            {filesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <FileText size={14} />
            <span className={styles.filesTitle}>
              {fileCount} file{fileCount !== 1 ? 's' : ''} changed
            </span>
            {(totalInsertions > 0 || totalDeletions > 0) && (
              <span className={styles.statsSummary}>
                {totalInsertions > 0 && <span className={styles.statsAdded}>+{totalInsertions}</span>}
                {totalInsertions > 0 && totalDeletions > 0 && ' '}
                {totalDeletions > 0 && <span className={styles.statsRemoved}>-{totalDeletions}</span>}
              </span>
            )}
          </button>

          {filesExpanded && (
            <ul className={styles.fileList}>
              {fileDetails.map((file) => {
                const { dir, name } = splitPath(file.path)
                const isSelected = selectedFile?.path === file.path
                return (
                  <li key={file.path}>
                    <button
                      className={`${styles.fileItem} ${isSelected ? styles.fileItemSelected : ''}`}
                      onClick={() => handleFileClick(file)}
                      title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
                    >
                      <FileStatusIcon status={file.status} />
                      <span className={styles.fileName}>
                        {dir && <span className={styles.fileDir}>{dir}</span>}
                        {name}
                      </span>
                      {(file.insertions > 0 || file.deletions > 0) && (
                        <span className={styles.fileStats}>
                          {file.insertions > 0 && <span className={styles.statsAdded}>+{file.insertions}</span>}
                          {file.deletions > 0 && <span className={styles.statsRemoved}>-{file.deletions}</span>}
                        </span>
                      )}
                    </button>

                    {/* Inline diff for selected file */}
                    {isSelected && (
                      <div className={styles.diffContainer}>
                        {loadingDiff ? (
                          <div className={styles.diffLoading}>
                            <Loader2 size={16} className={styles.spinner} />
                            <span>Loading diff...</span>
                          </div>
                        ) : diffContent ? (
                          <DiffViewer
                            diffContent={diffContent}
                            filePath={file.path}
                            className={styles.inlineDiff}
                          />
                        ) : (
                          <div className={styles.diffEmpty}>No diff available</div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )

  if (overlay) {
    return (
      <div className={styles.overlayBackdrop} onClick={handleBackdropClick}>
        {panelContent}
      </div>
    )
  }

  return panelContent
}
