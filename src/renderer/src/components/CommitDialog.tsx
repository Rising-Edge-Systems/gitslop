import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'
import { DEFAULT_SETTINGS, type AppSettings } from '../hooks/useSettings'
import styles from './CommitDialog.module.css'

function getAppSettings(): AppSettings {
  try {
    const stored = localStorage.getItem('gitslop-settings')
    if (stored) return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }
  } catch { /* ignore */ }
  return { ...DEFAULT_SETTINGS }
}

interface CommitDialogProps {
  repoPath: string
  stagedCount: number
  onCommitDone: () => void
}

const SUBJECT_WARN_LENGTH = 72

export function CommitDialog({ repoPath, stagedCount, onCommitDone }: CommitDialogProps): React.JSX.Element {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [amend, setAmend] = useState(false)
  const [signoff, setSignoff] = useState(false)
  const [gpgSign, setGpgSign] = useState(() => getAppSettings().signCommits)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const subjectRef = useRef<HTMLInputElement>(null)

  // Pre-fill message when amend is checked
  useEffect(() => {
    if (amend) {
      window.electronAPI.git.getLastCommitMessage(repoPath).then((result) => {
        if (result.success && result.data) {
          const msg = result.data as string
          const lines = msg.split('\n')
          setSubject(lines[0] || '')
          // Body is everything after first line (skip blank line separator)
          const bodyLines = lines.slice(1)
          // Remove leading empty line if present
          if (bodyLines.length > 0 && bodyLines[0].trim() === '') {
            bodyLines.shift()
          }
          const bodyText = bodyLines.join('\n').trim()
          setBody(bodyText)
          if (bodyText) setBodyExpanded(true)
        }
      })
    }
  }, [amend, repoPath])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  const buildMessage = useCallback((): string => {
    if (body.trim()) {
      return subject + '\n\n' + body.trim()
    }
    return subject
  }, [subject, body])

  const canCommit = (stagedCount > 0 || amend) && subject.trim().length > 0 && !committing

  const handleCommit = useCallback(async (andPush: boolean = false) => {
    if (!canCommit) return
    setCommitting(true)
    setError(null)
    setSuccess(null)

    try {
      const message = buildMessage()
      const appSettings = getAppSettings()
      const result = await window.electronAPI.git.commit(repoPath, message, {
        amend,
        signoff,
        gpgSign,
        gpgKeyId: gpgSign && appSettings.gpgKeyId ? appSettings.gpgKeyId : undefined
      })

      if (result.success) {
        // Clear fields
        setSubject('')
        setBody('')
        setBodyExpanded(false)
        setAmend(false)
        setError(null)

        if (andPush) {
          const pushResult = await window.electronAPI.git.push(repoPath)
          if (pushResult.success) {
            setSuccess('Committed and pushed successfully')
          } else {
            setSuccess('Committed successfully, but push failed: ' + (pushResult.error || 'Unknown error'))
          }
        } else {
          setSuccess('Committed successfully')
        }

        onCommitDone()
      } else {
        setError(result.error || 'Commit failed')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Commit failed')
    } finally {
      setCommitting(false)
    }
  }, [canCommit, buildMessage, repoPath, amend, signoff, gpgSign, onCommitDone])

  // Global Ctrl+Enter shortcut — scoped to commit panel focus
  const commitDialogRef = useRef<HTMLDivElement>(null)

  const stableCommit = useShortcutHandler(() => {
    const active = document.activeElement
    if (commitDialogRef.current?.contains(active) && canCommit) {
      handleCommit(false)
    }
  })

  const commitShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'commit',
        'Commit Staged Changes',
        'Git',
        'Ctrl+Enter',
        { ctrl: true, key: 'Enter' },
        stableCommit
      )
    ],
    [stableCommit]
  )

  useKeyboardShortcuts(commitShortcuts)

  const subjectLength = subject.length
  const subjectOverLimit = subjectLength > SUBJECT_WARN_LENGTH

  return (
    <div ref={commitDialogRef} className={styles.commitDialog}>
      <div className={styles.header}>
        <h3 className={styles.title}>Commit</h3>
      </div>

      {error && (
        <div className={styles.error}>{error}</div>
      )}
      {success && (
        <div className={styles.success}>{success}</div>
      )}

      {/* Subject line */}
      <div className={styles.subjectRow}>
        <input
          ref={subjectRef}
          className={`${styles.subject} ${subjectOverLimit ? styles.subjectOverLimit : ''}`}
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Commit message subject..."
          disabled={committing}
        />
        <span className={`${styles.charCount} ${subjectOverLimit ? styles.charCountOverLimit : ''}`}>
          {subjectLength}/{SUBJECT_WARN_LENGTH}
        </span>
      </div>

      {/* Body (expandable) */}
      {!bodyExpanded ? (
        <button
          className={styles.expandBody}
          onClick={() => setBodyExpanded(true)}
          disabled={committing}
        >
          + Add description
        </button>
      ) : (
        <textarea
          className={styles.body}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Extended description (optional)..."
          rows={4}
          disabled={committing}
        />
      )}

      {/* Options */}
      <div className={styles.options}>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={amend}
            onChange={(e) => setAmend(e.target.checked)}
            disabled={committing}
          />
          Amend last commit
        </label>
        <label className={styles.option}>
          <input
            type="checkbox"
            checked={signoff}
            onChange={(e) => setSignoff(e.target.checked)}
            disabled={committing}
          />
          Sign-off
        </label>
        <label className={styles.option} title="Sign this commit with GPG key">
          <input
            type="checkbox"
            checked={gpgSign}
            onChange={(e) => setGpgSign(e.target.checked)}
            disabled={committing}
          />
          GPG Sign
        </label>
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => handleCommit(false)}
          disabled={!canCommit}
          title="Commit (Ctrl+Enter)"
        >
          {committing ? 'Committing...' : amend ? 'Amend Commit' : 'Commit'}
        </button>
        <button
          className={`${styles.btn} ${styles.btnSecondary}`}
          onClick={() => handleCommit(true)}
          disabled={!canCommit}
          title="Commit and push to remote"
        >
          {committing ? '...' : 'Commit & Push'}
        </button>
      </div>

      {stagedCount === 0 && !amend && (
        <div className={styles.hint}>
          No staged changes. Stage files above to commit.
        </div>
      )}
    </div>
  )
}
