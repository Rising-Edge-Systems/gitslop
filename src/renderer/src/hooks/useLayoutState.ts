import { useState, useCallback, useEffect, useRef } from 'react'

export interface RecentRepo {
  path: string
  name: string
  lastOpened: string
}

declare global {
  interface Window {
    electronAPI: {
      window: {
        minimize: () => Promise<void>
        maximize: () => Promise<void>
        close: () => Promise<void>
        isMaximized: () => Promise<boolean>
        onMaximizeChange: (callback: (isMaximized: boolean) => void) => () => void
      }
      dialog: {
        openDirectory: () => Promise<string | null>
      }
      git: {
        isRepo: (dirPath: string) => Promise<boolean>
        init: (dirPath: string) => Promise<{ success: boolean; error?: string }>
      }
      repos: {
        getRecent: () => Promise<RecentRepo[]>
        addRecent: (repoPath: string, repoName: string) => Promise<RecentRepo[]>
        removeRecent: (repoPath: string) => Promise<RecentRepo[]>
      }
    }
  }
}

export interface LayoutState {
  sidebarSize: number
  bottomPanelSize: number
  bottomPanelVisible: boolean
  sidebarVisible: boolean
}

const STORAGE_KEY = 'gitslop-layout-state'

const DEFAULT_LAYOUT: LayoutState = {
  sidebarSize: 20,
  bottomPanelSize: 25,
  bottomPanelVisible: false,
  sidebarVisible: true
}

function loadLayout(): LayoutState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<LayoutState>
      return { ...DEFAULT_LAYOUT, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_LAYOUT
}

function saveLayout(state: LayoutState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

export function useLayoutState(): {
  layout: LayoutState
  setSidebarSize: (size: number) => void
  setBottomPanelSize: (size: number) => void
  toggleBottomPanel: () => void
  toggleSidebar: () => void
} {
  const [layout, setLayout] = useState<LayoutState>(loadLayout)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save
  useEffect(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = setTimeout(() => {
      saveLayout(layout)
    }, 300)
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [layout])

  const setSidebarSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, sidebarSize: size }))
  }, [])

  const setBottomPanelSize = useCallback((size: number) => {
    setLayout((prev) => ({ ...prev, bottomPanelSize: size }))
  }, [])

  const toggleBottomPanel = useCallback(() => {
    setLayout((prev) => ({ ...prev, bottomPanelVisible: !prev.bottomPanelVisible }))
  }, [])

  const toggleSidebar = useCallback(() => {
    setLayout((prev) => ({ ...prev, sidebarVisible: !prev.sidebarVisible }))
  }, [])

  return {
    layout,
    setSidebarSize,
    setBottomPanelSize,
    toggleBottomPanel,
    toggleSidebar
  }
}
