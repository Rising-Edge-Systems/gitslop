import React, { useCallback } from 'react'
import { X, GitBranch } from 'lucide-react'
import type { RepoTab } from '../hooks/useRepoTabs'
import styles from './TabBar.module.css'

interface TabBarProps {
  tabs: RepoTab[]
  activeIndex: number
  onSwitchTab: (index: number) => void
  onCloseTab: (index: number) => void
}

export function TabBar({ tabs, activeIndex, onSwitchTab, onCloseTab }: TabBarProps): React.JSX.Element | null {
  // Don't render if there are 0 or 1 tabs
  if (tabs.length <= 1) return null

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
          />
        ))}
      </div>
    </div>
  )
}

interface TabItemProps {
  tab: RepoTab
  index: number
  isActive: boolean
  onSwitch: (index: number) => void
  onClose: (index: number) => void
}

function TabItem({ tab, index, isActive, onSwitch, onClose }: TabItemProps): React.JSX.Element {
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

  return (
    <div
      className={`${styles.tab} ${isActive ? styles.tabActive : ''}`}
      onClick={handleClick}
      onMouseDown={handleMiddleClick}
      title={tab.repoPath}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
    >
      <GitBranch size={13} className={styles.tabIcon} />
      <span className={styles.tabName}>{tab.name}</span>
      <button
        className={styles.tabClose}
        onClick={handleClose}
        aria-label={`Close ${tab.name}`}
        title={`Close ${tab.name}`}
      >
        <X size={12} />
      </button>
    </div>
  )
}
