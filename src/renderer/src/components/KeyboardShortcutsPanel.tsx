import React, { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import {
  getRegisteredShortcuts,
  subscribeToRegistry,
  type ShortcutDefinition
} from '../hooks/useKeyboardShortcuts'

interface KeyboardShortcutsPanelProps {
  onClose: () => void
}

/** Group shortcuts by category */
function groupByCategory(shortcuts: ShortcutDefinition[]): Map<string, ShortcutDefinition[]> {
  const groups = new Map<string, ShortcutDefinition[]>()
  for (const s of shortcuts) {
    const list = groups.get(s.category) || []
    list.push(s)
    groups.set(s.category, list)
  }
  return groups
}

/** Render a key combination as styled kbd elements */
function KeyCombo({ keys }: { keys: string }): React.JSX.Element {
  const parts = keys.split('+')
  return (
    <span className="shortcut-keys">
      {parts.map((part, i) => (
        <React.Fragment key={part}>
          {i > 0 && <span className="shortcut-plus">+</span>}
          <kbd className="shortcut-kbd">{part}</kbd>
        </React.Fragment>
      ))}
    </span>
  )
}

const CATEGORY_ORDER = ['General', 'Git', 'Navigation', 'Editor', 'View']

export function KeyboardShortcutsPanel({ onClose }: KeyboardShortcutsPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState('')

  // Subscribe to registry changes for live updates
  const shortcuts = useSyncExternalStore(subscribeToRegistry, getRegisteredShortcuts)

  const groups = groupByCategory(shortcuts)

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [onClose]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const filterLower = filter.toLowerCase()

  return (
    <div className="branch-dialog-overlay" onClick={onClose}>
      <div className="shortcuts-panel" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-panel-header">
          <h2 className="shortcuts-panel-title">Keyboard Shortcuts</h2>
          <button className="shortcuts-panel-close" onClick={onClose} title="Close (Escape)">
            <X size={16} />
          </button>
        </div>

        <div className="shortcuts-panel-search">
          <input
            className="shortcuts-panel-filter"
            type="text"
            placeholder="Filter shortcuts..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
        </div>

        <div className="shortcuts-panel-body">
          {CATEGORY_ORDER.map((category) => {
            const items = groups.get(category)
            if (!items) return null

            const filtered = filterLower
              ? items.filter(
                  (s) =>
                    s.label.toLowerCase().includes(filterLower) ||
                    s.keys.toLowerCase().includes(filterLower)
                )
              : items

            if (filtered.length === 0) return null

            return (
              <div key={category} className="shortcuts-category">
                <h3 className="shortcuts-category-title">{category}</h3>
                <div className="shortcuts-list">
                  {filtered.map((s) => (
                    <div key={s.id} className="shortcuts-item">
                      <span className="shortcuts-item-label">{s.label}</span>
                      <KeyCombo keys={s.keys} />
                    </div>
                  ))}
                </div>
              </div>
            )
          })}

          {shortcuts.length === 0 && (
            <div className="shortcuts-empty">No shortcuts registered.</div>
          )}
        </div>
      </div>
    </div>
  )
}
