import React from 'react'

interface BottomPanelProps {
  onToggle: () => void
}

export function BottomPanel({ onToggle }: BottomPanelProps): React.JSX.Element {
  return (
    <div className="bottom-panel">
      <div className="bottom-panel-header">
        <span className="bottom-panel-title">Terminal</span>
        <button className="bottom-panel-close" onClick={onToggle} title="Close Terminal">
          ✕
        </button>
      </div>
      <div className="bottom-panel-content">
        <div className="terminal-placeholder">
          <span>Terminal will be available when a repository is open</span>
        </div>
      </div>
    </div>
  )
}
