import React, { useState, useEffect, useCallback } from 'react'
import {
  GitBranch,
  ArrowUp,
  ArrowDown,
  ArrowDownToLine,
  RefreshCw,
  Loader2,
  Bell,
  Check,
  XCircle,
  AlertTriangle,
  Info
} from 'lucide-react'
import type { Notification } from '../hooks/useNotifications'
import styles from './StatusBar.module.css'

interface ActiveOperation {
  type: string
  phase: string
  percent: number | null
}

interface StatusBarProps {
  currentRepo: string | null
  history: Notification[]
  historyOpen: boolean
  onToggleHistory: () => void
  onClearHistory: () => void
  incomingChanges?: number
  lastFetchTime?: number | null
  autoFetching?: boolean
  onManualRefresh?: () => Promise<void>
}

export function StatusBar({
  currentRepo,
  history,
  historyOpen,
  onToggleHistory,
  onClearHistory,
  incomingChanges = 0,
  lastFetchTime,
  autoFetching = false,
  onManualRefresh
}: StatusBarProps): React.JSX.Element {
  const [branch, setBranch] = useState<string | null>(null)
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [activeOp, setActiveOp] = useState<ActiveOperation | null>(null)

  // Fetch branch info
  const fetchBranchInfo = useCallback(async () => {
    if (!currentRepo) {
      setBranch(null)
      setAhead(0)
      setBehind(0)
      return
    }
    try {
      const branchResult = await window.electronAPI.git.getCurrentBranch(currentRepo)
      if (branchResult.success && branchResult.data) {
        setBranch(branchResult.data)
      }

      // Get ahead/behind from branches data
      const branchesResult = await window.electronAPI.git.getBranches(currentRepo)
      if (branchesResult.success && Array.isArray(branchesResult.data)) {
        const current = branchesResult.data.find(
          (b: { isCurrent: boolean }) => b.isCurrent
        )
        if (current) {
          setAhead(current.ahead || 0)
          setBehind(current.behind || 0)
        }
      }
    } catch {
      // Ignore errors
    }
  }, [currentRepo])

  // Refresh on repo change
  useEffect(() => {
    fetchBranchInfo()
  }, [fetchBranchInfo])

  // Listen for repo file changes to refresh
  useEffect(() => {
    if (!currentRepo) return
    const cleanup = window.electronAPI.onRepoChanged(() => {
      fetchBranchInfo()
    })
    return cleanup
  }, [currentRepo, fetchBranchInfo])

  // Listen for operation progress
  useEffect(() => {
    const cleanup = window.electronAPI.git.onOperationProgress((progress) => {
      setActiveOp({
        type: progress.operation,
        phase: progress.phase,
        percent: progress.percent
      })
    })
    return cleanup
  }, [])

  // Clear active op when progress stops (no updates for 2s)
  useEffect(() => {
    if (!activeOp) return
    const timer = setTimeout(() => {
      setActiveOp(null)
    }, 3000)
    return () => clearTimeout(timer)
  }, [activeOp])

  const unreadCount = history.filter((n) => !n.dismissed).length

  const formatTime = (ts: number): string => {
    const d = new Date(ts)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className={styles.statusBar}>
      {/* Left section: branch + sync status */}
      <div className={styles.left}>
        {currentRepo && branch && (
          <>
            <span className={styles.branch} title={`Current branch: ${branch}`}>
              <span className={styles.branchIcon}><GitBranch size={14} /></span>
              {branch}
            </span>
            {(ahead > 0 || behind > 0) && (
              <span className={styles.sync} title={`${ahead} ahead, ${behind} behind`}>
                {ahead > 0 && <span className={styles.ahead}><ArrowUp size={10} />{ahead}</span>}
                {behind > 0 && <span className={styles.behind}><ArrowDown size={10} />{behind}</span>}
              </span>
            )}
            {incomingChanges > 0 && (
              <span
                className={styles.incoming}
                title={`${incomingChanges} incoming commit${incomingChanges > 1 ? 's' : ''} — pull to update`}
              >
                <ArrowDownToLine size={12} /> {incomingChanges} incoming
              </span>
            )}
            {autoFetching && (
              <span className={styles.fetching} title="Auto-fetching...">
                <Loader2 size={12} className={styles.spinner} />
              </span>
            )}
            {lastFetchTime && (
              <span className={styles.lastFetch} title={`Last fetched at ${formatTime(lastFetchTime)}`}>
                Last fetch: {formatTime(lastFetchTime)}
              </span>
            )}
          </>
        )}
        {!currentRepo && (
          <span className={styles.text}>No repository open</span>
        )}
      </div>

      {/* Center: active operation */}
      <div className={styles.center}>
        {activeOp && (
          <div className={styles.operation}>
            <span className={styles.spinner}><Loader2 size={12} /></span>
            <span className={styles.opText}>{activeOp.phase}</span>
            {activeOp.percent !== null && (
              <div className={styles.progress}>
                <div
                  className={styles.progressFill}
                  style={{ width: `${activeOp.percent}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right section: refresh + notification history */}
      <div className={styles.right}>
        {currentRepo && onManualRefresh && (
          <button
            className={styles.refreshBtn}
            onClick={onManualRefresh}
            disabled={autoFetching}
            title="Manual refresh — fetch from remotes and reload"
          >
            {autoFetching ? (
              <span className={styles.spinner}><Loader2 size={14} /></span>
            ) : (
              <RefreshCw size={14} />
            )}
          </button>
        )}
        <button
          className={`${styles.notifBtn} ${unreadCount > 0 ? styles.notifBtnActive : ''}`}
          onClick={onToggleHistory}
          title={`Notifications${unreadCount > 0 ? ` (${unreadCount} new)` : ''}`}
        >
          <Bell size={14} />
          {unreadCount > 0 && (
            <span className={styles.notifBadge}>{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
      </div>

      {/* Notification history dropdown */}
      {historyOpen && (
        <>
          <div className={styles.historyBackdrop} onClick={onToggleHistory} />
          <div className={styles.history}>
            <div className={styles.historyHeader}>
              <span className={styles.historyTitle}>Notifications</span>
              {history.length > 0 && (
                <button className={styles.historyClear} onClick={onClearHistory}>
                  Clear All
                </button>
              )}
            </div>
            <div className={styles.historyList}>
              {history.length === 0 ? (
                <div className={styles.historyEmpty}>No notifications</div>
              ) : (
                history.map((n) => (
                  <div key={n.id} className={`${styles.historyItem} ${n.type === 'success' ? styles.historyItemSuccess : n.type === 'error' ? styles.historyItemError : n.type === 'warning' ? styles.historyItemWarning : styles.historyItemInfo}`}>
                    <span className={styles.historyIcon}>
                      {n.type === 'success' ? <Check size={14} /> : n.type === 'error' ? <XCircle size={14} /> : n.type === 'warning' ? <AlertTriangle size={14} /> : <Info size={14} />}
                    </span>
                    <span className={styles.historyMessage}>{n.message}</span>
                    <span className={styles.historyTime}>{formatTime(n.timestamp)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
