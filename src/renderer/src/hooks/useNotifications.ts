import { useState, useCallback, useRef } from 'react'

export interface Notification {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  details?: string
  timestamp: number
  dismissed: boolean
}

let nextId = 1

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
    setNotifications((prev) => prev.filter((n) => n.id !== id))
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
      setHistory((prev) => [notification, ...prev].slice(0, 100)) // Keep last 100

      // Auto-dismiss after timeout (errors stay longer)
      const timeout = type === 'error' ? 8000 : 4000
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

  return {
    notifications,
    history,
    addNotification,
    dismissNotification,
    clearHistory,
    historyOpen,
    setHistoryOpen
  }
}
