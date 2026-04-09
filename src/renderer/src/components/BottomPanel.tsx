import React from 'react'
import { X } from 'lucide-react'
import styles from './BottomPanel.module.css'

interface BottomPanelProps {
  onToggle: () => void
}

export function BottomPanel({ onToggle }: BottomPanelProps): React.JSX.Element {
  return (
    <div className={styles.bottomPanel}>
      <div className={styles.bottomPanelHeader}>
        <span className={styles.bottomPanelTitle}>Terminal</span>
        <button className={styles.bottomPanelClose} onClick={onToggle} title="Close Terminal">
          <X size={14} />
        </button>
      </div>
      <div className={styles.bottomPanelContent}>
        <div className={styles.terminalPlaceholder}>
          <span>Terminal will be available when a repository is open</span>
        </div>
      </div>
    </div>
  )
}
