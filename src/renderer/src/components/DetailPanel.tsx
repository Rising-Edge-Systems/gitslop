import React, { useCallback, useRef, useState } from 'react'
import {
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
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import styles from './DetailPanel.module.css'
import type { CommitDetail, CommitFileDetail } from './CommitGraph'

interface DetailPanelProps {
  detail: CommitDetail | null
  repoPath: string | null
  /** Callback when a file is clicked in the changed files list */
  onFileClick?: (file: CommitFileDetail, commitHash: string) => void
  /** Path of the currently selected file (whose diff is open in center panel) */
  selectedFilePath?: string | null
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

export function DetailPanel({ detail, repoPath, onFileClick, selectedFilePath }: DetailPanelProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null)
  const [copiedSha, setCopiedSha] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(true)

  // ALL hooks must be above the early return to avoid React error #310
  // ("Rendered more hooks than during the previous render")
  const commit = detail?.commit
  const fileDetails = detail?.fileDetails ?? []
  const totalInsertions = detail?.totalInsertions ?? 0
  const totalDeletions = detail?.totalDeletions ?? 0
  const refs = detail?.refs ?? []

  const sigOk = commit?.signatureStatus === 'good'
  const sigBad = commit?.signatureStatus === 'bad' || commit?.signatureStatus === 'error'
  const hasSig = commit?.signatureStatus !== 'none' && commit?.signatureStatus !== undefined

  // Copy SHA to clipboard
  const handleCopySha = useCallback(async () => {
    if (!commit) return
    try {
      await navigator.clipboard.writeText(commit.hash)
      setCopiedSha(true)
      setTimeout(() => setCopiedSha(false), 2000)
    } catch {
      // Fallback: select all text
    }
  }, [commit?.hash])

  // Handle file click — delegate to parent via onFileClick callback
  const handleFileClick = useCallback((file: CommitFileDetail) => {
    if (!commit) return
    onFileClick?.(file, commit.hash)
  }, [onFileClick, commit?.hash])

  const fileCount = fileDetails.length

  // Show empty state when no commit is selected
  if (!detail || !commit) {
    return (
      <div ref={panelRef} className={styles.detailPanel}>
        <div className={styles.header}>
          <span className={styles.headerTitle}>Commit Details</span>
        </div>
        <div className={styles.emptyState}>
          <GitCommit size={48} className={styles.emptyStateIcon} />
          <span className={styles.emptyStateText}>Select a commit to view details</span>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className={styles.detailPanel}
    >
      <div className={styles.header}>
        <span className={styles.headerTitle}>Commit Details</span>
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
              {copiedSha ? (
                <>
                  <Check size={12} className={styles.copySuccess} />
                  <span className={styles.copiedText}>Copied!</span>
                </>
              ) : (
                <Copy size={12} />
              )}
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
                const isSelected = selectedFilePath === file.path
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
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
