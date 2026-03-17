import { useState, useCallback, useEffect, useRef } from 'react'

export interface RepoTab {
  repoPath: string
  name: string
}

export interface TabsState {
  tabs: RepoTab[]
  activeIndex: number
}

const STORAGE_KEY = 'gitslop-repo-tabs'

const DEFAULT_STATE: TabsState = {
  tabs: [],
  activeIndex: -1
}

function loadTabs(): TabsState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<TabsState>
      const tabs = Array.isArray(parsed.tabs) ? parsed.tabs : []
      const activeIndex =
        typeof parsed.activeIndex === 'number' && parsed.activeIndex >= 0 && parsed.activeIndex < tabs.length
          ? parsed.activeIndex
          : tabs.length > 0
            ? 0
            : -1
      return { tabs, activeIndex }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_STATE
}

function saveTabs(state: TabsState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

export interface UseRepoTabsReturn {
  tabs: RepoTab[]
  activeTab: RepoTab | null
  activeIndex: number
  activeRepoPath: string | null
  openTab: (repoPath: string) => void
  closeTab: (index: number) => void
  switchTab: (index: number) => void
  nextTab: () => void
  prevTab: () => void
}

export function useRepoTabs(): UseRepoTabsReturn {
  const [state, setState] = useState<TabsState>(loadTabs)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveTabs(state)
    }, 300)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [state])

  const openTab = useCallback((repoPath: string) => {
    setState((prev) => {
      // Check if this repo is already open
      const existingIndex = prev.tabs.findIndex((t) => t.repoPath === repoPath)
      if (existingIndex >= 0) {
        // Just switch to it
        return { ...prev, activeIndex: existingIndex }
      }
      // Add new tab
      const name = repoPath.split(/[/\\]/).pop() || repoPath
      const newTabs = [...prev.tabs, { repoPath, name }]
      return { tabs: newTabs, activeIndex: newTabs.length - 1 }
    })
  }, [])

  const closeTab = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.tabs.length) return prev
      const newTabs = prev.tabs.filter((_, i) => i !== index)
      let newActiveIndex: number
      if (newTabs.length === 0) {
        newActiveIndex = -1
      } else if (prev.activeIndex === index) {
        // Closing active tab — switch to previous or first
        newActiveIndex = index > 0 ? index - 1 : 0
      } else if (prev.activeIndex > index) {
        // Active tab was after the closed one — shift left
        newActiveIndex = prev.activeIndex - 1
      } else {
        newActiveIndex = prev.activeIndex
      }
      return { tabs: newTabs, activeIndex: newActiveIndex }
    })
  }, [])

  const switchTab = useCallback((index: number) => {
    setState((prev) => {
      if (index < 0 || index >= prev.tabs.length) return prev
      return { ...prev, activeIndex: index }
    })
  }, [])

  const nextTab = useCallback(() => {
    setState((prev) => {
      if (prev.tabs.length <= 1) return prev
      const next = (prev.activeIndex + 1) % prev.tabs.length
      return { ...prev, activeIndex: next }
    })
  }, [])

  const prevTab = useCallback(() => {
    setState((prev) => {
      if (prev.tabs.length <= 1) return prev
      const next = (prev.activeIndex - 1 + prev.tabs.length) % prev.tabs.length
      return { ...prev, activeIndex: next }
    })
  }, [])

  const activeTab = state.activeIndex >= 0 && state.activeIndex < state.tabs.length
    ? state.tabs[state.activeIndex]
    : null

  return {
    tabs: state.tabs,
    activeTab,
    activeIndex: state.activeIndex,
    activeRepoPath: activeTab?.repoPath ?? null,
    openTab,
    closeTab,
    switchTab,
    nextTab,
    prevTab
  }
}
