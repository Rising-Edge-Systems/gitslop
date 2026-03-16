import { useState, useCallback, useEffect } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'gitslop-theme'

function loadTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') {
      return stored
    }
  } catch {
    // Ignore storage errors
  }
  return 'dark'
}

function applyTheme(theme: Theme, animate = false): void {
  if (animate) {
    document.body.classList.add('theme-transitioning')
  }
  document.documentElement.setAttribute('data-theme', theme)
  if (animate) {
    // Remove transition class after animation completes
    setTimeout(() => {
      document.body.classList.remove('theme-transitioning')
    }, 300)
  }
}

export function useTheme(): {
  theme: Theme
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
} {
  const [theme, setThemeState] = useState<Theme>(() => {
    const t = loadTheme()
    applyTheme(t)
    return t
  })

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme)
    applyTheme(newTheme, true)
    try {
      localStorage.setItem(STORAGE_KEY, newTheme)
    } catch {
      // Ignore storage errors
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }, [theme, setTheme])

  // Keyboard shortcut: Ctrl+Shift+T to toggle theme
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key === 'T') {
        e.preventDefault()
        toggleTheme()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggleTheme])

  return { theme, toggleTheme, setTheme }
}
