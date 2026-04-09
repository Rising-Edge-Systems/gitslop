import React, { useState, useCallback } from 'react'
import { Tag, X } from 'lucide-react'
import styles from './TagDialog.module.css'

interface TagDialogProps {
  currentRepo: string
  /** Pre-fill the target commit hash */
  defaultTarget?: string
  onClose: () => void
  onTagCreated: () => void
}

export function TagDialog({
  currentRepo,
  defaultTarget,
  onClose,
  onTagCreated
}: TagDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [target, setTarget] = useState(defaultTarget || 'HEAD')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return
    setLoading(true)
    setError(null)

    try {
      const trimmedTarget = target.trim() || undefined
      const trimmedMessage = message.trim() || undefined
      const result = await window.electronAPI.git.createTag(
        currentRepo,
        name.trim(),
        trimmedTarget,
        trimmedMessage ? { message: trimmedMessage } : undefined
      )
      if (result.success) {
        onTagCreated()
      } else {
        setError(result.error || 'Failed to create tag')
        setLoading(false)
      }
    } catch {
      setError('Unexpected error')
      setLoading(false)
    }
  }, [currentRepo, name, target, message, onTagCreated])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h3 className={styles.title}>
            <Tag size={18} />
            New Tag
          </h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Tag name</label>
            <input
              className={styles.input}
              type="text"
              placeholder="v1.0.0"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !loading) handleSubmit()
                if (e.key === 'Escape') onClose()
              }}
              autoFocus
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Target commit</label>
            <input
              className={styles.input}
              type="text"
              placeholder="HEAD"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label className={styles.fieldLabel}>Message (optional, for annotated tag)</label>
            <textarea
              className={styles.textarea}
              placeholder="Release message..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}
        </div>

        <div className={styles.footer}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            disabled={!name.trim() || loading}
            onClick={handleSubmit}
          >
            {loading ? 'Creating...' : 'Create Tag'}
          </button>
        </div>
      </div>
    </div>
  )
}
