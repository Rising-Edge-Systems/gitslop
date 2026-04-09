import { useCallback, useEffect, useRef, useState } from 'react'

export interface AutoFetchState {
  /** Whether auto-fetch is currently running */
  fetching: boolean
  /** Last successful fetch timestamp */
  lastFetchTime: number | null
  /** Number of incoming commits detected after last fetch */
  incomingChanges: number
  /** Error from last auto-fetch attempt */
  lastError: string | null
}

interface UseAutoFetchOptions {
  /** Repo path to fetch for */
  repoPath: string | null
  /** Interval in minutes (0 = disabled) */
  intervalMinutes: number
  /** Callback for notifications */
  onNotify?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export function useAutoFetch({ repoPath, intervalMinutes, onNotify }: UseAutoFetchOptions): AutoFetchState & {
  /** Manually trigger a full refresh (re-fetch + notify repo changed) */
  manualRefresh: () => Promise<void>
} {
  const [state, setState] = useState<AutoFetchState>({
    fetching: false,
    lastFetchTime: null,
    incomingChanges: 0,
    lastError: null
  })

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isMountedRef = useRef(true)

  const doAutoFetch = useCallback(async () => {
    if (!repoPath) return

    setState((prev) => ({ ...prev, fetching: true, lastError: null }))

    try {
      const result = await window.electronAPI.git.autoFetch(repoPath)
      if (!isMountedRef.current) return

      if (result.success) {
        const behind = result.data?.behind || 0
        const prevIncoming = state.incomingChanges

        setState((prev) => ({
          ...prev,
          fetching: false,
          lastFetchTime: Date.now(),
          incomingChanges: behind,
          lastError: null
        }))

        // Notify if new incoming changes detected
        if (behind > 0 && behind !== prevIncoming && onNotify) {
          onNotify('info', `${behind} incoming commit${behind > 1 ? 's' : ''} available`)
        }
      } else {
        setState((prev) => ({
          ...prev,
          fetching: false,
          lastError: result.error || 'Auto-fetch failed'
        }))
      }
    } catch {
      if (!isMountedRef.current) return
      setState((prev) => ({
        ...prev,
        fetching: false,
        lastError: 'Auto-fetch failed'
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, onNotify])

  const manualRefresh = useCallback(async () => {
    await doAutoFetch()
  }, [doAutoFetch])

  // Set up the auto-fetch interval
  useEffect(() => {
    isMountedRef.current = true

    // Clear existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }

    // Don't set up if disabled or no repo
    if (!repoPath || intervalMinutes <= 0) {
      return () => {
        isMountedRef.current = false
      }
    }

    const intervalMs = intervalMinutes * 60 * 1000

    // Do initial fetch after a short delay (don't fetch immediately on mount)
    const initialTimer = setTimeout(() => {
      if (isMountedRef.current) {
        doAutoFetch()
      }
    }, 5000) // 5s delay before first auto-fetch

    // Set up recurring interval
    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        doAutoFetch()
      }
    }, intervalMs)

    return () => {
      isMountedRef.current = false
      clearTimeout(initialTimer)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [repoPath, intervalMinutes, doAutoFetch])

  return {
    ...state,
    manualRefresh
  }
}
