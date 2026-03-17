import React, { useCallback, useEffect, useRef } from 'react'
import { X, GitCommit, User, Calendar, FileText, ShieldCheck, ShieldAlert } from 'lucide-react'
import styles from './DetailPanel.module.css'
import type { CommitDetail } from './CommitGraph'

interface DetailPanelProps {
  detail: CommitDetail
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

export function DetailPanel({ detail, onClose, overlay = false }: DetailPanelProps): React.JSX.Element {
  const { commit, files, refs } = detail
  const sigOk = commit.signatureStatus === 'good'
  const sigBad = commit.signatureStatus === 'bad' || commit.signatureStatus === 'error'
  const hasSig = commit.signatureStatus !== 'none'
  const panelRef = useRef<HTMLDivElement>(null)

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
      // Only close if clicking the backdrop itself, not the panel content
      if (e.target === e.currentTarget) {
        onClose()
      }
    },
    [onClose]
  )

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
            <code className={styles.sha}>{commit.hash}</code>
          </div>
          <div className={styles.metaRow}>
            <User size={14} className={styles.metaIcon} />
            <span>{commit.authorName} &lt;{commit.authorEmail}&gt;</span>
          </div>
          <div className={styles.metaRow}>
            <Calendar size={14} className={styles.metaIcon} />
            <span title={new Date(commit.authorDate).toLocaleString()}>
              {formatRelativeDate(commit.authorDate)}
            </span>
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
          <div className={styles.filesHeader}>
            <FileText size={14} />
            <span>Changed Files ({files.length})</span>
          </div>
          <ul className={styles.fileList}>
            {files.map((file) => (
              <li key={file} className={styles.fileItem}>
                <FileText size={12} className={styles.fileIcon} />
                <span className={styles.fileName}>{file}</span>
              </li>
            ))}
          </ul>
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
