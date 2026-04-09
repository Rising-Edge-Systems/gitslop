import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as TerminalIcon, X } from 'lucide-react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import styles from './BottomPanel.module.css'

interface TerminalTab {
  id: string
  title: string
  terminal: XTerm
  fitAddon: FitAddon
  disposed: boolean
}

interface TerminalPanelProps {
  currentRepo: string | null
  onToggle: () => void
}

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null
  return ((...args: unknown[]) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as unknown as T
}

export function TerminalPanel({ currentRepo, onToggle }: TerminalPanelProps): React.JSX.Element {
  const [tabs, setTabs] = useState<TerminalTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const termContainerRef = useRef<HTMLDivElement>(null)
  const tabsRef = useRef<TerminalTab[]>([])
  const activeTabIdRef = useRef<string | null>(null)
  const repoChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep refs in sync
  tabsRef.current = tabs
  activeTabIdRef.current = activeTabId

  // Create a new terminal tab
  const createTab = useCallback(async () => {
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'Courier New', monospace",
      theme: {
        background: '#11111b',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#45475a',
        selectionForeground: '#cdd6f4',
        black: '#45475a',
        red: '#f38ba8',
        green: '#a6e3a1',
        yellow: '#f9e2af',
        blue: '#89b4fa',
        magenta: '#f5c2e7',
        cyan: '#94e2d5',
        white: '#bac2de',
        brightBlack: '#585b70',
        brightRed: '#f38ba8',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#f5c2e7',
        brightCyan: '#94e2d5',
        brightWhite: '#a6adc8'
      },
      allowTransparency: false,
      scrollback: 5000,
      convertEol: true
    })

    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)

    const result = await window.electronAPI.terminal.create({
      cwd: currentRepo || undefined
    })

    if (!result.success || !result.data) {
      terminal.dispose()
      return
    }

    const tabId = result.data.id
    const tabNum = tabsRef.current.length + 1

    const newTab: TerminalTab = {
      id: tabId,
      title: `Terminal ${tabNum}`,
      terminal,
      fitAddon,
      disposed: false
    }

    // Handle user input -> send to PTY
    terminal.onData((data: string) => {
      window.electronAPI.terminal.write({ id: tabId, data })
    })

    setTabs(prev => [...prev, newTab])
    setActiveTabId(tabId)
  }, [currentRepo])

  // Global data handler from PTY -> xterm
  useEffect(() => {
    const cleanupData = window.electronAPI.terminal.onData((payload) => {
      const tab = tabsRef.current.find(t => t.id === payload.id)
      if (tab && !tab.disposed) {
        tab.terminal.write(payload.data)
      }
    })

    const cleanupExit = window.electronAPI.terminal.onExit((payload) => {
      const tab = tabsRef.current.find(t => t.id === payload.id)
      if (tab) {
        tab.terminal.write(`\r\n[Process exited with code ${payload.exitCode}]\r\n`)
      }
    })

    return () => {
      cleanupData()
      cleanupExit()
    }
  }, [])

  // Debounced repo changed trigger
  useEffect(() => {
    if (!currentRepo) return

    // When terminal output happens, it may trigger file changes
    // The file watcher already handles this, but we add a debounced refresh
    // for terminal-initiated changes
    const cleanup = window.electronAPI.terminal.onData(() => {
      if (repoChangedTimerRef.current) {
        clearTimeout(repoChangedTimerRef.current)
      }
      repoChangedTimerRef.current = setTimeout(() => {
        // Trigger status refresh via custom event
        window.dispatchEvent(new CustomEvent('terminal:activity'))
      }, 2000)
    })

    return () => {
      cleanup()
      if (repoChangedTimerRef.current) {
        clearTimeout(repoChangedTimerRef.current)
      }
    }
  }, [currentRepo])

  // Auto-create first tab when repo is set
  const autoCreatedRef = useRef(false)
  useEffect(() => {
    if (currentRepo && tabs.length === 0 && !autoCreatedRef.current) {
      autoCreatedRef.current = true
      createTab()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRepo])

  // Mount/unmount active terminal to DOM
  useEffect(() => {
    const container = termContainerRef.current
    if (!container || !activeTabId) return

    const activeTab = tabs.find(t => t.id === activeTabId)
    if (!activeTab || activeTab.disposed) return

    // Clear container
    while (container.firstChild) {
      container.removeChild(container.firstChild)
    }

    // Mount terminal
    activeTab.terminal.open(container)

    // Fit after a short delay to let layout settle
    const fitTimer = setTimeout(() => {
      try {
        activeTab.fitAddon.fit()
        const dims = activeTab.fitAddon.proposeDimensions()
        if (dims) {
          window.electronAPI.terminal.resize({
            id: activeTab.id,
            cols: dims.cols,
            rows: dims.rows
          })
        }
      } catch {
        // Ignore fit errors during init
      }
    }, 50)

    // Focus terminal
    activeTab.terminal.focus()

    return () => {
      clearTimeout(fitTimer)
    }
  }, [activeTabId, tabs])

  // Handle resize
  useEffect(() => {
    if (!activeTabId) return

    const handleResize = debounce(() => {
      const activeTab = tabsRef.current.find(t => t.id === activeTabIdRef.current)
      if (!activeTab || activeTab.disposed) return
      try {
        activeTab.fitAddon.fit()
        const dims = activeTab.fitAddon.proposeDimensions()
        if (dims) {
          window.electronAPI.terminal.resize({
            id: activeTab.id,
            cols: dims.cols,
            rows: dims.rows
          })
        }
      } catch {
        // Ignore resize errors
      }
    }, 100)

    const observer = new ResizeObserver(handleResize)
    if (termContainerRef.current) {
      observer.observe(termContainerRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [activeTabId])

  // Cleanup all terminals on unmount
  useEffect(() => {
    return () => {
      for (const tab of tabsRef.current) {
        if (!tab.disposed) {
          tab.disposed = true
          tab.terminal.dispose()
          window.electronAPI.terminal.kill(tab.id)
        }
      }
    }
  }, [])

  // Close a tab
  const closeTab = useCallback((tabId: string) => {
    const tab = tabsRef.current.find(t => t.id === tabId)
    if (tab && !tab.disposed) {
      tab.disposed = true
      tab.terminal.dispose()
      window.electronAPI.terminal.kill(tabId)
    }

    setTabs(prev => {
      const filtered = prev.filter(t => t.id !== tabId)
      // If closing active tab, switch to another
      if (activeTabIdRef.current === tabId) {
        const idx = prev.findIndex(t => t.id === tabId)
        const newActive = filtered[Math.min(idx, filtered.length - 1)]
        setActiveTabId(newActive?.id || null)
      }
      return filtered
    })
  }, [])

  // Change cwd when repo changes for existing terminals
  useEffect(() => {
    if (!currentRepo) return
    for (const tab of tabsRef.current) {
      if (!tab.disposed) {
        window.electronAPI.terminal.setCwd({ id: tab.id, cwd: currentRepo })
      }
    }
  }, [currentRepo])

  return (
    <div className={styles.bottomPanel}>
      <div className={styles.bottomPanelHeader}>
        <div className={styles.terminalTabsBar}>
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`${styles.terminalTab} ${tab.id === activeTabId ? styles.terminalTabActive : ''}`}
              onClick={() => {
                setActiveTabId(tab.id)
              }}
            >
              <span className={styles.terminalTabIcon}><TerminalIcon size={12} /></span>
              <span className={styles.terminalTabTitle}>{tab.title}</span>
              <button
                className={styles.terminalTabClose}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(tab.id)
                }}
                title="Close terminal"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          <button
            className={styles.terminalNewTab}
            onClick={createTab}
            title="New Terminal"
          >
            +
          </button>
        </div>
        <button className={styles.bottomPanelClose} onClick={onToggle} title="Close Terminal (Ctrl+`)">
          <X size={14} />
        </button>
      </div>
      <div className={`${styles.bottomPanelContent} ${styles.terminalContent}`} ref={termContainerRef}>
        {tabs.length === 0 && !currentRepo && (
          <div className={styles.terminalPlaceholder}>
            <span>Open a repository to use the terminal</span>
          </div>
        )}
      </div>
    </div>
  )
}
