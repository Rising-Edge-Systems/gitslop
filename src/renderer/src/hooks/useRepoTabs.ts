import { useState, useCallback, useEffect, useRef } from 'react'

export interface RepoTab {
  repoPath: string
  name: string
}

export interface TabsState {
  tabs: RepoTab[]
  activeIndex: number
}

/**
 * Per-tab UI state that is preserved when switching between tabs.
 * Stored in a Map<repoPath, TabPerTabState>.
 */
export interface TabPerTabState {
  /** Selected commit hash (null = no commit selected) */
  selectedCommitHash: string | null
  /** Whether the sidebar is collapsed to icon rail */
  sidebarCollapsed: boolean
  /** Whether the detail panel is open */
  detailPanelOpen: boolean
  /** Commit graph scroll offset (pixels from top) */
  graphScrollOffset: number
}

const DEFAULT_TAB_STATE: TabPerTabState = {
  selectedCommitHash: null,
  sidebarCollapsed: false,
  detailPanelOpen: false,
  graphScrollOffset: 0
}

const STORAGE_KEY = 'gitslop-repo-tabs'
const TAB_STATE_STORAGE_KEY = 'gitslop-tab-states'

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

function loadTabStates(): Record<string, TabPerTabState> {
  try {
    const stored = localStorage.getItem(TAB_STATE_STORAGE_KEY)
    if (stored) {
      return JSON.parse(stored) as Record<string, TabPerTabState>
    }
  } catch {
    // Ignore parse errors
  }
  return {}
}

function saveTabStates(states: Record<string, TabPerTabState>): void {
  try {
    localStorage.setItem(TAB_STATE_STORAGE_KEY, JSON.stringify(states))
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
  reorderTabs: (fromIndex: number, toIndex: number) => void
  getTabState: (repoPath: string) => TabPerTabState
  saveTabState: (repoPath: string, state: Partial<TabPerTabState>) => void
}

export function useRepoTabs(): UseRepoTabsReturn {
  const [state, setState] = useState<TabsState>(loadTabs)
  const tabStatesRef = useRef<Record<string, TabPerTabState>>(loadTabStates())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveStatesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save for tab list
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

  const debouncedSaveTabStates = useCallback(() => {
    if (saveStatesTimerRef.current) {
      clearTimeout(saveStatesTimerRef.current)
    }
    saveStatesTimerRef.current = setTimeout(() => {
      saveTabStates(tabStatesRef.current)
    }, 300)
  }, [])

  // Cleanup save timer on unmount
  useEffect(() => {
    return () => {
      if (saveStatesTimerRef.current) {
        clearTimeout(saveStatesTimerRef.current)
      }
    }
  }, [])

  const getTabState = useCallback((repoPath: string): TabPerTabState => {
    return tabStatesRef.current[repoPath] ?? { ...DEFAULT_TAB_STATE }
  }, [])

  const saveTabStateForRepo = useCallback((repoPath: string, partial: Partial<TabPerTabState>) => {
    const existing = tabStatesRef.current[repoPath] ?? { ...DEFAULT_TAB_STATE }
    tabStatesRef.current = {
      ...tabStatesRef.current,
      [repoPath]: { ...existing, ...partial }
    }
    debouncedSaveTabStates()
  }, [debouncedSaveTabStates])

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
      // Clean up per-tab state for the closed tab
      const closedPath = prev.tabs[index].repoPath
      const { [closedPath]: _, ...rest } = tabStatesRef.current
      tabStatesRef.current = rest
      debouncedSaveTabStates()

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
  }, [debouncedSaveTabStates])

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

  const reorderTabs = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      if (
        fromIndex < 0 || fromIndex >= prev.tabs.length ||
        toIndex < 0 || toIndex >= prev.tabs.length ||
        fromIndex === toIndex
      ) return prev

      const newTabs = [...prev.tabs]
      const [moved] = newTabs.splice(fromIndex, 1)
      newTabs.splice(toIndex, 0, moved)

      // Update activeIndex to follow the active tab
      let newActiveIndex = prev.activeIndex
      if (prev.activeIndex === fromIndex) {
        newActiveIndex = toIndex
      } else if (fromIndex < prev.activeIndex && toIndex >= prev.activeIndex) {
        newActiveIndex = prev.activeIndex - 1
      } else if (fromIndex > prev.activeIndex && toIndex <= prev.activeIndex) {
        newActiveIndex = prev.activeIndex + 1
      }

      return { tabs: newTabs, activeIndex: newActiveIndex }
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
    prevTab,
    reorderTabs,
    getTabState,
    saveTabState: saveTabStateForRepo
  }
}
