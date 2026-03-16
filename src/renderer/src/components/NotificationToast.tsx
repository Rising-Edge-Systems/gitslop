import React, { useState } from 'react'
import type { Notification } from '../hooks/useNotifications'

interface NotificationToastProps {
  notifications: Notification[]
  onDismiss: (id: string) => void
}

function ToastItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  const icons: Record<string, string> = {
    success: '✓',
    error: '✗',
    warning: '⚠',
    info: 'ℹ'
  }

  return (
    <div className={`toast toast-${notification.type}`}>
      <div className="toast-main">
        <span className="toast-icon">{icons[notification.type]}</span>
        <span className="toast-message">{notification.message}</span>
        <div className="toast-actions">
          {notification.details && (
            <button
              className="toast-details-btn"
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              title={detailsExpanded ? 'Hide Details' : 'Show Details'}
            >
              {detailsExpanded ? '▴' : '▾'}
            </button>
          )}
          <button
            className="toast-dismiss-btn"
            onClick={() => onDismiss(notification.id)}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      </div>
      {detailsExpanded && notification.details && (
        <div className="toast-details">
          <pre className="toast-details-text">{notification.details}</pre>
        </div>
      )}
    </div>
  )
}

export function NotificationToast({ notifications, onDismiss }: NotificationToastProps): React.JSX.Element | null {
  if (notifications.length === 0) return null

  return (
    <div className="toast-container">
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
