import React, { useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, Info, ChevronUp, ChevronDown, X } from 'lucide-react'
import type { Notification } from '../hooks/useNotifications'
import styles from './NotificationToast.module.css'

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

const typeClass: Record<string, string> = {
  success: styles.success,
  error: styles.error,
  warning: styles.warning,
  info: styles.info
}

function ToastItem({ notification, onDismiss }: { notification: Notification; onDismiss: (id: string) => void }): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false)

  const toastClassName = [
    styles.toast,
    typeClass[notification.type] ?? '',
    notification.exiting ? styles.toastExiting : ''
  ].filter(Boolean).join(' ')

  return (
    <div className={toastClassName}>
      <div className={styles.main}>
        <span className={styles.icon}>{TOAST_ICONS[notification.type]}</span>
        <span className={styles.message}>{notification.message}</span>
        <div className={styles.actions}>
          {notification.details && (
            <button
              className={styles.detailsBtn}
              onClick={() => setDetailsExpanded(!detailsExpanded)}
              title={detailsExpanded ? 'Hide Details' : 'Show Details'}
            >
              {detailsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          )}
          <button
            className={styles.dismissBtn}
            onClick={() => onDismiss(notification.id)}
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      {detailsExpanded && notification.details && (
        <div className={styles.details}>
          <pre className={styles.detailsText}>{notification.details}</pre>
        </div>
      )}
    </div>
  )
}

export function NotificationToast({ notifications, onDismiss }: NotificationToastProps): React.JSX.Element | null {
  if (notifications.length === 0) return null

  return (
    <div className={styles.container}>
      {notifications.map((n) => (
        <ToastItem key={n.id} notification={n} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
