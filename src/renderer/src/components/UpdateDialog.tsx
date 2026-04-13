import React, { useState, useEffect, useCallback } from 'react'
import { ArrowRight, AlertTriangle, Download, RefreshCw, RotateCcw, X } from 'lucide-react'
import styles from './UpdateDialog.module.css'

// ─── Types ───────────────────────────────────────────────────────────────────

interface UpdateDialogProps {
  version: string
  releaseNotes: string
  onClose: () => void
}

type DialogPhase = 'idle' | 'downloading' | 'downloaded' | 'error'

interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  transferred: number
  total: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond >= 1_048_576) {
    return `${(bytesPerSecond / 1_048_576).toFixed(1)} MB/s`
  }
  return `${Math.round(bytesPerSecond / 1024)} KB/s`
}

function getCurrentVersion(): string {
  try {
    // electron exposes app version via navigator.userAgent or we can read from package
    const match = navigator.userAgent.match(/GitSlop\/(\S+)/)
    if (match) return match[1]
  } catch {
    // ignore
  }
  return 'current'
}

// ─── UpdateDialog ────────────────────────────────────────────────────────────

export function UpdateDialog({
  version,
  releaseNotes,
  onClose
}: UpdateDialogProps): React.JSX.Element {
  const [phase, setPhase] = useState<DialogPhase>('idle')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const currentVersion = getCurrentVersion()

  // Listen for download progress
  useEffect(() => {
    const cleanupProgress = window.electronAPI.updates.onDownloadProgress((data) => {
      setProgress(data)
    })
    const cleanupDownloaded = window.electronAPI.updates.onUpdateDownloaded(() => {
      setPhase('downloaded')
    })
    const cleanupError = window.electronAPI.updates.onUpdateError((data) => {
      setPhase('error')
      setErrorMessage(data.message)
    })

    return () => {
      cleanupProgress()
      cleanupDownloaded()
      cleanupError()
    }
  }, [])

  const handleDownload = useCallback(async () => {
    setPhase('downloading')
    setProgress(null)
    setErrorMessage(null)
    try {
      await window.electronAPI.updates.downloadUpdate()
    } catch {
      // Error will come through the onUpdateError listener
    }
  }, [])

  const handleInstall = useCallback(() => {
    window.electronAPI.updates.installUpdate()
  }, [])

  const handleRetry = useCallback(() => {
    setPhase('idle')
    setProgress(null)
    setErrorMessage(null)
  }, [])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            <Download size={18} />
            Update Available
          </h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Version info */}
          <div className={styles.versionRow}>
            <span className={styles.versionCurrent}>v{currentVersion}</span>
            <ArrowRight size={14} className={styles.versionArrow} />
            <span className={styles.versionNew}>v{version}</span>
          </div>

          {/* Release notes */}
          {releaseNotes && (
            <>
              <div className={styles.releaseNotesLabel}>Release Notes</div>
              <pre className={styles.releaseNotes}>{releaseNotes}</pre>
            </>
          )}

          {/* Progress bar (downloading phase) */}
          {phase === 'downloading' && (
            <div className={styles.progressSection}>
              <div className={styles.progressBarTrack}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${progress?.percent ?? 0}%` }}
                />
              </div>
              <div className={styles.progressInfo}>
                <span>{Math.round(progress?.percent ?? 0)}%</span>
                <span>{progress ? formatSpeed(progress.bytesPerSecond) : ''}</span>
              </div>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && errorMessage && (
            <div className={styles.error}>
              <AlertTriangle size={14} className={styles.errorIcon} />
              {errorMessage}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={styles.footer}>
          {phase === 'idle' && (
            <>
              <button className={styles.btnSecondary} onClick={onClose}>
                Remind Me Later
              </button>
              <button className={styles.btnPrimary} onClick={handleDownload}>
                <Download size={14} />
                Download &amp; Install
              </button>
            </>
          )}

          {phase === 'downloading' && (
            <button className={styles.btnSecondary} onClick={onClose}>
              Remind Me Later
            </button>
          )}

          {phase === 'downloaded' && (
            <>
              <button className={styles.btnSecondary} onClick={onClose}>
                Later
              </button>
              <button className={styles.btnSuccess} onClick={handleInstall}>
                <RotateCcw size={14} />
                Restart to Update
              </button>
            </>
          )}

          {phase === 'error' && (
            <>
              <button className={styles.btnSecondary} onClick={onClose}>
                Close
              </button>
              <button className={styles.btnPrimary} onClick={handleRetry}>
                <RefreshCw size={14} />
                Retry
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
