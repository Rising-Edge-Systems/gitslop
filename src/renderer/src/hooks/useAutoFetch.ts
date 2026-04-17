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

        // Refresh the graph after fetch so new remote commits are visible
        if (behind !== prevIncoming) {
          window.dispatchEvent(new CustomEvent('graph:force-refresh'))
        }

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

    // Fetch immediately on repo open so the graph shows remote state
    doAutoFetch()

    // Set up recurring interval
    intervalRef.current = setInterval(() => {
      if (isMountedRef.current) {
        doAutoFetch()
      }
    }, intervalMs)

    return () => {
      isMountedRef.current = false
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
  }, [repoPath, intervalMinutes, doAutoFetch])

  // After pull/push/fetch, re-check ahead/behind to clear stale "incoming" count
  useEffect(() => {
    if (!repoPath) return
    const handler = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.git.getBranches(repoPath)
        if (result.success && Array.isArray(result.data)) {
          const current = result.data.find((b: { current?: boolean; isCurrent?: boolean }) => b.current || b.isCurrent)
          const behind = current?.behind || 0
          setState((prev) => ({ ...prev, incomingChanges: behind }))
        }
      } catch { /* ignore */ }
    }
    window.addEventListener('graph:force-refresh', handler)
    return () => window.removeEventListener('graph:force-refresh', handler)
  }, [repoPath])

  return {
    ...state,
    manualRefresh
  }
}
