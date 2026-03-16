import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  useKeyboardShortcuts,
  useShortcutHandler,
  defineShortcut,
  type ShortcutDefinition
} from './useKeyboardShortcuts'

export interface AppSettings {
  // General
  defaultCloneDirectory: string
  autoFetchInterval: number // minutes, 0 = disabled
  proxyUrl: string

  // Appearance
  theme: 'dark' | 'light'
  fontFamily: string
  fontSize: number
  sidebarPosition: 'left' | 'right'

  // Git
  defaultPullStrategy: 'merge' | 'rebase'
  signCommits: boolean
  autoStashOnPull: boolean
  defaultBranchName: string

  // Editor
  tabSize: number
  wordWrap: boolean
  minimapEnabled: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  // General
  defaultCloneDirectory: '',
  autoFetchInterval: 5,
  proxyUrl: '',

  // Appearance
  theme: 'dark',
  fontFamily: '',
  fontSize: 13,
  sidebarPosition: 'left',

  // Git
  defaultPullStrategy: 'merge',
  signCommits: false,
  autoStashOnPull: false,
  defaultBranchName: 'main',

  // Editor
  tabSize: 4,
  wordWrap: true,
  minimapEnabled: true
}

const STORAGE_KEY = 'gitslop-settings'

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<AppSettings>
      return { ...DEFAULT_SETTINGS, ...parsed }
    }
  } catch {
    // Ignore parse errors
  }
  return { ...DEFAULT_SETTINGS }
}

function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Ignore storage errors
  }
}

/** Apply settings that have immediate visual effect */
function applySettings(settings: AppSettings): void {
  // Apply theme
  document.documentElement.setAttribute('data-theme', settings.theme)

  // Apply font size
  document.documentElement.style.setProperty('--app-font-size', `${settings.fontSize}px`)

  // Apply font family override (if set)
  if (settings.fontFamily) {
    document.documentElement.style.setProperty('--font-family-override', settings.fontFamily)
  } else {
    document.documentElement.style.removeProperty('--font-family-override')
  }
}

export type Theme = 'dark' | 'light'

export function useSettings(): {
  settings: AppSettings
  updateSettings: (partial: Partial<AppSettings>) => void
  resetSettings: () => void
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  toggleTheme: () => void
} {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const s = loadSettings()
    applySettings(s)
    return s
  })
  const [settingsOpen, setSettingsOpen] = useState(false)

  const updateSettings = useCallback((partial: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...partial }
      saveSettings(next)
      applySettings(next)
      return next
    })
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(() => {
      const defaults = { ...DEFAULT_SETTINGS }
      saveSettings(defaults)
      applySettings(defaults)
      return defaults
    })
  }, [])

  const openSettings = useCallback(() => setSettingsOpen(true), [])
  const closeSettings = useCallback(() => setSettingsOpen(false), [])

  const toggleTheme = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, theme: prev.theme === 'dark' ? 'light' : 'dark' as Theme }
      saveSettings(next)
      // Add transition
      document.body.classList.add('theme-transitioning')
      applySettings(next)
      setTimeout(() => {
        document.body.classList.remove('theme-transitioning')
      }, 300)
      return next
    })
  }, [])

  // Register shortcuts
  const stableOpenSettings = useShortcutHandler(openSettings)
  const stableToggleTheme = useShortcutHandler(toggleTheme)

  const settingsShortcuts: ShortcutDefinition[] = useMemo(
    () => [
      defineShortcut(
        'open-settings',
        'Open Settings',
        'General',
        'Ctrl+,',
        { ctrl: true, key: ',' },
        stableOpenSettings
      ),
      defineShortcut(
        'toggle-theme',
        'Toggle Dark/Light Theme',
        'View',
        'Ctrl+Shift+T',
        { ctrl: true, shift: true, key: 'T' },
        stableToggleTheme
      )
    ],
    [stableOpenSettings, stableToggleTheme]
  )

  useKeyboardShortcuts(settingsShortcuts)

  // Apply settings on mount
  useEffect(() => {
    applySettings(settings)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    settings,
    updateSettings,
    resetSettings,
    settingsOpen,
    openSettings,
    closeSettings,
    toggleTheme
  }
}
