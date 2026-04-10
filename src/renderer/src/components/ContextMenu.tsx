import React, { useCallback, useEffect, useRef } from 'react'
import styles from './ContextMenu.module.css'

export interface ContextMenuItem {
  /** Unique key for the item */
  key: string
  /** Label displayed in the menu */
  label: string
  /** Optional icon (Lucide icon or ReactNode) */
  icon?: React.ReactNode
  /** Optional keyboard shortcut hint (e.g. 'S', 'Ctrl+Z') */
  shortcut?: string
  /** Click handler */
  onClick: () => void
  /** Whether this is a danger/destructive action */
  danger?: boolean
  /** Whether the item is disabled */
  disabled?: boolean
}

export interface ContextMenuSeparator {
  key: string
  separator: true
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator

function isSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return 'separator' in entry && entry.separator === true
}

interface ContextMenuProps {
  /** X position (clientX) */
  x: number
  /** Y position (clientY) */
  y: number
  /** Menu items and separators */
  items: ContextMenuEntry[]
  /** Called when the menu should be closed */
  onClose: () => void
}

/**
 * Reusable context menu component.
 * Renders a fixed-position dropdown menu at the given coordinates.
 * Closes on click outside, Escape key, scroll, or item selection.
 * Automatically inserts a separator before danger items when not already preceded by one.
 */
export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null)

  // Adjust position to keep menu within viewport
  const adjustedPosition = useCallback(() => {
    const menuEl = menuRef.current
    if (!menuEl) return { left: x, top: y }

    const rect = menuEl.getBoundingClientRect()
    let left = x
    let top = y

    if (x + rect.width > window.innerWidth) {
      left = window.innerWidth - rect.width - 4
    }
    if (y + rect.height > window.innerHeight) {
      top = window.innerHeight - rect.height - 4
    }
    if (left < 0) left = 4
    if (top < 0) top = 4

    return { left, top }
  }, [x, y])

  useEffect(() => {
    const menuEl = menuRef.current
    if (menuEl) {
      const { left, top } = adjustedPosition()
      menuEl.style.left = `${left}px`
      menuEl.style.top = `${top}px`
    }
  }, [adjustedPosition])

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Close on scroll (capture phase to catch scrolls from child elements)
  useEffect(() => {
    const handleScroll = (): void => {
      onClose()
    }
    window.addEventListener('scroll', handleScroll, true)
    return () => window.removeEventListener('scroll', handleScroll, true)
  }, [onClose])

  // Build effective items list, auto-inserting separator before danger items
  const effectiveItems = React.useMemo(() => {
    const result: ContextMenuEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i]
      if (!isSeparator(entry) && entry.danger) {
        // Insert separator before danger item if previous entry isn't already a separator
        const prev = result[result.length - 1]
        if (prev && !isSeparator(prev)) {
          result.push({ key: `__danger-sep-${entry.key}`, separator: true })
        }
      }
      result.push(entry)
    }
    return result
  }, [items])

  return (
    <div
      ref={menuRef}
      className={styles.menu}
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      {effectiveItems.map((entry) => {
        if (isSeparator(entry)) {
          return <div key={entry.key} className={styles.separator} />
        }

        const item = entry as ContextMenuItem
        const classNames = [
          item.danger ? styles.itemDanger : styles.item,
          item.disabled ? styles.itemDisabled : ''
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <button
            key={item.key}
            className={classNames}
            title={item.label}
            onClick={() => {
              if (!item.disabled) {
                item.onClick()
                onClose()
              }
            }}
            disabled={item.disabled}
          >
            {item.icon && <span className={styles.icon}>{item.icon}</span>}
            <span className={styles.label}>{item.label}</span>
            {item.shortcut && (
              <span className={styles.shortcut}>{item.shortcut}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
