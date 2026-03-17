import { useState, useCallback, useRef } from 'react'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  details?: string
  timestamp: number
  dismissed: boolean
  /** Set to true when the toast is animating out (fade-out before removal) */
  exiting?: boolean
}

let nextId = 1

/** Max visible toasts at once */
const MAX_VISIBLE_TOASTS = 3
/** Max items kept in notification history */
const MAX_HISTORY = 50

export interface NotificationActions {
  notifications: Notification[]
  history: Notification[]
  addNotification: (type: Notification['type'], message: string, details?: string) => void
  dismissNotification: (id: string) => void
  clearHistory: () => void
  historyOpen: boolean
  setHistoryOpen: (open: boolean) => void
}

export function useNotifications(): NotificationActions {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [history, setHistory] = useState<Notification[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissNotification = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(id)
    }
    // Start exit animation, then remove after animation completes
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, exiting: true } : n))
    )
    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
    }, 300) // Match CSS exit animation duration
  }, [])

  const addNotification = useCallback(
    (type: Notification['type'], message: string, details?: string) => {
      const id = `notif-${nextId++}`
      const notification: Notification = {
        id,
        type,
        message,
        details,
        timestamp: Date.now(),
        dismissed: false
      }

      setNotifications((prev) => [...prev, notification])
      setHistory((prev) => [notification, ...prev].slice(0, MAX_HISTORY))

      // Auto-dismiss: errors and warnings stay longer (8s), info/success shorter (4s)
      const timeout = type === 'error' || type === 'warning' ? 8000 : 4000
      const timer = setTimeout(() => {
        dismissNotification(id)
      }, timeout)
      timersRef.current.set(id, timer)
    },
    [dismissNotification]
  )

  const clearHistory = useCallback(() => {
    setHistory([])
  }, [])

  // Only show the most recent MAX_VISIBLE_TOASTS (non-exiting + exiting)
  const visibleNotifications = notifications.slice(-MAX_VISIBLE_TOASTS)

  return {
    notifications: visibleNotifications,
    history,
    addNotification,
    dismissNotification,
    clearHistory,
    historyOpen,
    setHistoryOpen
  }
}
