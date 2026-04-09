import React, { useCallback, useRef, useState } from 'react'
import { X, GitBranch, Plus } from 'lucide-react'
import type { RepoTab } from '../hooks/useRepoTabs'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: RepoTab[]
  activeIndex: number
  onSwitchTab: (index: number) => void
  onCloseTab: (index: number) => void
  onReorderTabs: (fromIndex: number, toIndex: number) => void
  onAddTab: () => void
}

export function TabBar({ tabs, activeIndex, onSwitchTab, onCloseTab, onReorderTabs, onAddTab }: TabBarProps): React.JSX.Element | null {
  // Hide tab bar when no repos are open (welcome screen with zero tabs)
  if (tabs.length === 0) return null

  const isSingleTab = tabs.length === 1

  return (
    <div className={styles.tabBar}>
      <div className={styles.tabList}>
        {tabs.map((tab, index) => (
          <TabItem
            key={tab.repoPath}
            tab={tab}
            index={index}
            isActive={index === activeIndex}
            onSwitch={onSwitchTab}
            onClose={onCloseTab}
            onReorder={onReorderTabs}
            totalTabs={tabs.length}
            showClose={!isSingleTab}
          />
        ))}
      </div>
      <button
        className={styles.addTabButton}
        onClick={onAddTab}
        aria-label="Open another repository"
        title="Open another repository"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}

interface TabItemProps {
  tab: RepoTab
  index: number
  isActive: boolean
  onSwitch: (index: number) => void
  onClose: (index: number) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  totalTabs: number
  showClose: boolean
}

function TabItem({ tab, index, isActive, onSwitch, onClose, onReorder, totalTabs, showClose }: TabItemProps): React.JSX.Element {
  const [dragOver, setDragOver] = useState<'left' | 'right' | null>(null)
  const tabRef = useRef<HTMLDivElement>(null)

  const handleClick = useCallback(() => {
    onSwitch(index)
  }, [onSwitch, index])

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onClose(index)
    },
    [onClose, index]
  )

  const handleMiddleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault()
        onClose(index)
      }
    },
    [onClose, index]
  )

  // ─── Drag-and-Drop ──────────────────────────────────────────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(index))
      // Add a slight delay to allow the drag image to render
      if (tabRef.current) {
        tabRef.current.style.opacity = '0.5'
      }
    },
    [index]
  )

  const handleDragEnd = useCallback(() => {
    if (tabRef.current) {
      tabRef.current.style.opacity = ''
    }
  }, [])

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'

      // Determine drop side based on mouse position within the tab
      if (tabRef.current) {
        const rect = tabRef.current.getBoundingClientRect()
        const midX = rect.left + rect.width / 2
        setDragOver(e.clientX < midX ? 'left' : 'right')
      }
    },
    []
  )

  const handleDragLeave = useCallback(() => {
    setDragOver(null)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(null)
      const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10)
      if (isNaN(fromIndex) || fromIndex === index) return

      // Determine target index based on drop position
      let toIndex = index
      if (tabRef.current) {
        const rect = tabRef.current.getBoundingClientRect()
        const midX = rect.left + rect.width / 2
        if (e.clientX > midX && fromIndex < index) {
          toIndex = index
        } else if (e.clientX <= midX && fromIndex > index) {
          toIndex = index
        } else if (e.clientX > midX) {
          toIndex = Math.min(index + 1, totalTabs - 1)
        } else {
          toIndex = Math.max(index - 1, 0)
        }
      }

      if (fromIndex !== toIndex) {
        onReorder(fromIndex, toIndex)
      }
    },
    [index, onReorder, totalTabs]
  )

  const dragIndicatorClass = dragOver === 'left'
    ? styles.tabDragLeft
    : dragOver === 'right'
      ? styles.tabDragRight
      : ''

  return (
    <div
      ref={tabRef}
      className={`${styles.tab} ${isActive ? styles.tabActive : ''} ${dragIndicatorClass}`}
      onClick={handleClick}
      onMouseDown={handleMiddleClick}
      title={tab.repoPath}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <GitBranch size={13} className={styles.tabIcon} />
      <span className={styles.tabName}>{tab.name}</span>
      {showClose && (
        <button
          className={styles.tabClose}
          onClick={handleClose}
          aria-label={`Close ${tab.name}`}
          title={`Close ${tab.name}`}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
