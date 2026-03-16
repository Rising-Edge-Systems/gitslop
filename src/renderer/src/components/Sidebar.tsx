import React, { useState, useCallback } from 'react'

interface SidebarSectionProps {
  title: string
  icon: string
  defaultOpen?: boolean
  children: React.ReactNode
}

function SidebarSection({
  title,
  icon,
  defaultOpen = true,
  children
}: SidebarSectionProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  return (
    <div className="sidebar-section">
      <button className="sidebar-section-header" onClick={toggle}>
        <span className={`sidebar-section-chevron ${isOpen ? 'open' : ''}`}>▶</span>
        <span className="sidebar-section-icon">{icon}</span>
        <span className="sidebar-section-title">{title}</span>
      </button>
      {isOpen && <div className="sidebar-section-content">{children}</div>}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  return (
    <div className="sidebar">
      <SidebarSection title="Branches" icon="⑂" defaultOpen={true}>
        <div className="sidebar-placeholder">No repository open</div>
      </SidebarSection>
      <SidebarSection title="Remotes" icon="☁" defaultOpen={false}>
        <div className="sidebar-placeholder">No repository open</div>
      </SidebarSection>
      <SidebarSection title="Tags" icon="🏷" defaultOpen={false}>
        <div className="sidebar-placeholder">No repository open</div>
      </SidebarSection>
      <SidebarSection title="Stashes" icon="📦" defaultOpen={false}>
        <div className="sidebar-placeholder">No repository open</div>
      </SidebarSection>
    </div>
  )
}
