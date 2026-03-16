import { useEffect, useCallback, useRef } from 'react'

export interface ShortcutDefinition {
  /** Unique identifier for the shortcut */
  id: string
  /** Human-readable label displayed in the shortcut reference panel */
  label: string
  /** Category for grouping in the reference panel */
  category: 'General' | 'Git' | 'Navigation' | 'Editor' | 'View'
  /** Key combination string, e.g. 'Ctrl+Shift+P' */
  keys: string
  /** Whether Ctrl (or Cmd on Mac) is required */
  ctrl?: boolean
  /** Whether Shift is required */
  shift?: boolean
  /** Whether Alt is required */
  alt?: boolean
  /** The key to match (e.g. 'p', 'Enter', '`', '?') */
  key: string
  /** Handler to invoke when shortcut is triggered */
  handler: () => void
  /** Whether shortcut is currently enabled */
  enabled?: boolean
}

// Registry of all registered shortcuts — shared across hook instances
const shortcutRegistry = new Map<string, ShortcutDefinition>()

// Listeners notified on registry changes
const registryListeners = new Set<() => void>()

function notifyRegistryListeners(): void {
  registryListeners.forEach((fn) => fn())
}

/**
 * Returns a snapshot of all currently registered shortcuts, sorted by category then label.
 */
export function getRegisteredShortcuts(): ShortcutDefinition[] {
  return Array.from(shortcutRegistry.values()).sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category)
    return a.label.localeCompare(b.label)
  })
}

/**
 * Subscribe to registry changes. Returns an unsubscribe function.
 */
export function subscribeToRegistry(fn: () => void): () => void {
  registryListeners.add(fn)
  return () => registryListeners.delete(fn)
}

/**
 * Format a shortcut keys string for display (e.g. 'Ctrl+Shift+P')
 */
export function formatShortcut(def: ShortcutDefinition): string {
  return def.keys
}

/**
 * Hook to register keyboard shortcuts. Shortcuts are automatically
 * unregistered when the component unmounts.
 *
 * @param shortcuts Array of shortcut definitions to register
 */
export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void {
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    // Register all shortcuts
    const ids: string[] = []
    for (const s of shortcutsRef.current) {
      shortcutRegistry.set(s.id, s)
      ids.push(s.id)
    }
    notifyRegistryListeners()

    return () => {
      for (const id of ids) {
        shortcutRegistry.delete(id)
      }
      notifyRegistryListeners()
    }
  // Re-register whenever the shortcuts array identity changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shortcuts])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      for (const s of shortcutsRef.current) {
        if (s.enabled === false) continue

        const ctrlMatch = s.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey)
        const shiftMatch = s.shift ? e.shiftKey : !e.shiftKey
        const altMatch = s.alt ? e.altKey : !e.altKey

        // Special handling for '?' which requires shift on most keyboards
        let keyMatch: boolean
        if (s.key === '?') {
          keyMatch = (e.key === '?' || (e.shiftKey && e.key === '/'))
          // Override shift match since ? inherently requires shift
          if (keyMatch && ctrlMatch && altMatch) {
            e.preventDefault()
            s.handler()
            return
          }
          continue
        }

        keyMatch = e.key.toLowerCase() === s.key.toLowerCase()
        // Also handle special keys that don't lowercase well
        if (!keyMatch && s.key === '`') {
          keyMatch = e.key === '`'
        }

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault()
          s.handler()
          return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}

/**
 * Helper to create a shortcut definition with common defaults.
 */
export function defineShortcut(
  id: string,
  label: string,
  category: ShortcutDefinition['category'],
  keys: string,
  opts: { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string },
  handler: () => void,
  enabled = true
): ShortcutDefinition {
  return {
    id,
    label,
    category,
    keys,
    ctrl: opts.ctrl,
    shift: opts.shift,
    alt: opts.alt,
    key: opts.key,
    handler,
    enabled
  }
}

/**
 * Hook that provides a stable callback ref for a handler
 * (so shortcuts don't re-register on every render).
 */
export function useShortcutHandler(handler: () => void): () => void {
  const ref = useRef(handler)
  ref.current = handler
  return useCallback(() => ref.current(), [])
}
