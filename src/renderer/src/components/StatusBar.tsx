import React, { useState, useEffect, useCallback } from 'react'
import type { Notification } from '../hooks/useNotifications'

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
}

export function StatusBar({
  currentRepo,
  history,
  historyOpen,
  onToggleHistory,
  onClearHistory
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
    <div className="status-bar">
      {/* Left section: branch + sync status */}
      <div className="status-bar-left">
        {currentRepo && branch && (
          <>
            <span className="status-bar-branch" title={`Current branch: ${branch}`}>
              <span className="status-bar-branch-icon">⑂</span>
              {branch}
            </span>
            {(ahead > 0 || behind > 0) && (
              <span className="status-bar-sync" title={`${ahead} ahead, ${behind} behind`}>
                {ahead > 0 && <span className="status-bar-ahead">↑{ahead}</span>}
                {behind > 0 && <span className="status-bar-behind">↓{behind}</span>}
              </span>
            )}
          </>
        )}
        {!currentRepo && (
          <span className="status-bar-text">No repository open</span>
        )}
      </div>

      {/* Center: active operation */}
      <div className="status-bar-center">
        {activeOp && (
          <div className="status-bar-operation">
            <span className="status-bar-spinner">⟳</span>
            <span className="status-bar-op-text">{activeOp.phase}</span>
            {activeOp.percent !== null && (
              <div className="status-bar-progress">
                <div
                  className="status-bar-progress-fill"
                  style={{ width: `${activeOp.percent}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right section: notification history */}
      <div className="status-bar-right">
        <button
          className={`status-bar-notif-btn ${unreadCount > 0 ? 'status-bar-notif-btn-active' : ''}`}
          onClick={onToggleHistory}
          title={`Notifications${unreadCount > 0 ? ` (${unreadCount} new)` : ''}`}
        >
          🔔
          {unreadCount > 0 && (
            <span className="status-bar-notif-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>
          )}
        </button>
      </div>

      {/* Notification history dropdown */}
      {historyOpen && (
        <>
          <div className="status-bar-history-backdrop" onClick={onToggleHistory} />
          <div className="status-bar-history">
            <div className="status-bar-history-header">
              <span className="status-bar-history-title">Notifications</span>
              {history.length > 0 && (
                <button className="status-bar-history-clear" onClick={onClearHistory}>
                  Clear All
                </button>
              )}
            </div>
            <div className="status-bar-history-list">
              {history.length === 0 ? (
                <div className="status-bar-history-empty">No notifications</div>
              ) : (
                history.map((n) => (
                  <div key={n.id} className={`status-bar-history-item status-bar-history-item-${n.type}`}>
                    <span className="status-bar-history-icon">
                      {n.type === 'success' ? '✓' : n.type === 'error' ? '✗' : n.type === 'warning' ? '⚠' : 'ℹ'}
                    </span>
                    <span className="status-bar-history-message">{n.message}</span>
                    <span className="status-bar-history-time">{formatTime(n.timestamp)}</span>
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
