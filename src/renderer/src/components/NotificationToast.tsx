import React, { useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, ChevronUp, ChevronDown, X } from 'lucide-react'
import type { Notification } from '../hooks/useNotifications'

interface NotificationToastProps {
  notifications: Notification[]
  onDismiss: (id: string) => void
}

const TOAST_ICONS: Record<string, React.ReactNode> = {
  success: <CheckCircle size={16} />,
  error: <XCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />
}

function ToastItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  return (
    <div className={`toast toast-${notification.type}`}>
      <div className="toast-main">
        <span className="toast-icon">{TOAST_ICONS[notification.type]}</span>
        <span className="toast-message">{notification.message}</span>
        <div className="toast-actions">
          {notification.details && (
            <button
              className="toast-details-btn"
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              title={detailsExpanded ? 'Hide Details' : 'Show Details'}
            >
              {detailsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            className="toast-dismiss-btn"
            onClick={() => onDismiss(notification.id)}
            title="Dismiss"
          >
            <X size={14} />
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
