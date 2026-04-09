import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Minus, Square, Copy, X, Sun, Moon } from 'lucide-react'
import styles from './MenuBar.module.css'

interface MenuBarProps {
  repoPath: string | null
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  onCloseTab?: () => void
  onOpenSettings?: () => void
  onShowKeyboardShortcuts?: () => void
}

interface MenuItem {
  label: string
  accelerator?: string
  onClick?: () => void
  separator?: boolean
  disabled?: boolean
}

interface MenuDef {
  label: string
  items: MenuItem[]
}

export function MenuBar({ repoPath, theme, onToggleTheme, onCloseTab, onOpenSettings, onShowKeyboardShortcuts }: MenuBarProps): React.JSX.Element {
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [isMaximized, setIsMaximized] = useState(false)
  const menuBarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.electronAPI.window.isMaximized().then(setIsMaximized)
    const cleanup = window.electronAPI.window.onMaximizeChange(setIsMaximized)
    return cleanup
  }, [])

  // Close menu on click outside
  useEffect(() => {
    if (!openMenu) return
    const handler = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  // Close menu on Escape
  useEffect(() => {
    if (!openMenu) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [openMenu])

  const handleMenuClick = useCallback((label: string) => {
    setOpenMenu((prev) => (prev === label ? null : label))
  }, [])

  const handleItemClick = useCallback((item: MenuItem) => {
    if (item.disabled) return
    setOpenMenu(null)
    item.onClick?.()
  }, [])

  const menus: MenuDef[] = [
    {
      label: 'File',
      items: [
        { label: 'Open Repository', accelerator: 'Ctrl+O', onClick: async () => {
          const dirPath = await window.electronAPI.dialog.openDirectory()
          if (dirPath) {
            const isRepo = await window.electronAPI.git.isRepo(dirPath)
            if (isRepo) window.dispatchEvent(new CustomEvent('open-repo', { detail: { path: dirPath } }))
          }
        }},
        { label: 'Clone Repository', accelerator: 'Ctrl+Shift+C', onClick: () => window.dispatchEvent(new CustomEvent('menu:clone-repository')) },
        { label: 'Init Repository', onClick: async () => {
          const dirPath = await window.electronAPI.dialog.openDirectory()
          if (dirPath) {
            const result = await window.electronAPI.git.init(dirPath)
            if (result.success) window.dispatchEvent(new CustomEvent('open-repo', { detail: { path: dirPath } }))
          }
        }},
        { separator: true, label: '' },
        { label: 'Close Tab', accelerator: 'Ctrl+W', onClick: () => onCloseTab?.() },
        { separator: true, label: '' },
        { label: 'Settings', accelerator: 'Ctrl+,', onClick: () => onOpenSettings?.() },
        { separator: true, label: '' },
        { label: 'Quit', accelerator: 'Ctrl+Q', onClick: () => window.electronAPI.window.close() }
      ]
    },
    {
      label: 'Edit',
      items: [
        { label: 'Undo', accelerator: 'Ctrl+Z', onClick: () => document.execCommand('undo') },
        { label: 'Redo', accelerator: 'Ctrl+Shift+Z', onClick: () => document.execCommand('redo') },
        { separator: true, label: '' },
        { label: 'Cut', accelerator: 'Ctrl+X', onClick: () => document.execCommand('cut') },
        { label: 'Copy', accelerator: 'Ctrl+C', onClick: () => document.execCommand('copy') },
        { label: 'Paste', accelerator: 'Ctrl+V', onClick: () => document.execCommand('paste') },
        { label: 'Select All', accelerator: 'Ctrl+A', onClick: () => document.execCommand('selectAll') }
      ]
    },
    {
      label: 'View',
      items: [
        { label: 'Toggle Sidebar', accelerator: 'Ctrl+B', onClick: () => window.dispatchEvent(new CustomEvent('menu:toggle-sidebar')) },
        { label: 'Toggle Terminal', accelerator: 'Ctrl+`', onClick: () => window.dispatchEvent(new CustomEvent('menu:toggle-terminal')) },
        { separator: true, label: '' },
        { label: 'Toggle Theme', onClick: onToggleTheme },
        { separator: true, label: '' },
        { label: 'Toggle Full Screen', accelerator: 'F11', onClick: () => window.electronAPI.window.maximize() },
      ]
    },
    {
      label: 'Help',
      items: [
        { label: 'Keyboard Shortcuts', accelerator: 'Ctrl+?', onClick: () => window.dispatchEvent(new CustomEvent('menu:keyboard-shortcuts')) },
        { separator: true, label: '' },
        { label: 'About GitSlop', onClick: () => {
          alert(`GitSlop\n\nA powerful, open-source Git client.`)
        }}
      ]
    }
  ]

  return (
    <div className={styles.menuBar} ref={menuBarRef}>
      <div className={styles.dragRegion}>
        <span className={styles.appTitle}>GitSlop</span>
        <div className={styles.menus}>
          {menus.map((menu) => (
            <div key={menu.label} className={styles.menuWrapper}>
              <button
                className={`${styles.menuTrigger} ${openMenu === menu.label ? styles.menuTriggerActive : ''}`}
                onClick={() => handleMenuClick(menu.label)}
                onMouseEnter={() => openMenu && setOpenMenu(menu.label)}
              >
                {menu.label}
              </button>
              {openMenu === menu.label && (
                <div className={styles.dropdown}>
                  {menu.items.map((item, idx) =>
                    item.separator ? (
                      <div key={idx} className={styles.separator} />
                    ) : (
                      <button
                        key={item.label}
                        className={`${styles.dropdownItem} ${item.disabled ? styles.dropdownItemDisabled : ''}`}
                        onClick={() => handleItemClick(item)}
                        disabled={item.disabled}
                      >
                        <span className={styles.itemLabel}>{item.label}</span>
                        {item.accelerator && (
                          <span className={styles.itemAccelerator}>{item.accelerator}</span>
                        )}
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.windowControls}>
        <button className={styles.themeBtn} onClick={onToggleTheme} title="Toggle theme">
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className={styles.controlBtn} onClick={() => window.electronAPI.window.minimize()} title="Minimize">
          <Minus size={14} />
        </button>
        <button className={styles.controlBtn} onClick={() => window.electronAPI.window.maximize()} title={isMaximized ? 'Restore' : 'Maximize'}>
          {isMaximized ? <Copy size={14} /> : <Square size={14} />}
        </button>
        <button className={`${styles.controlBtn} ${styles.closeBtn}`} onClick={() => window.electronAPI.window.close()} title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
