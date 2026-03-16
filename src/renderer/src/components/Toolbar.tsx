import React from 'react'

export function Toolbar(): React.JSX.Element {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Pull (Ctrl+Shift+L)">
          <span className="toolbar-btn-icon">⬇</span>
          <span className="toolbar-btn-label">Pull</span>
        </button>
        <button className="toolbar-btn" title="Push (Ctrl+Shift+P)">
          <span className="toolbar-btn-icon">⬆</span>
          <span className="toolbar-btn-label">Push</span>
        </button>
        <button className="toolbar-btn" title="Fetch (Ctrl+Shift+F)">
          <span className="toolbar-btn-icon">⟳</span>
          <span className="toolbar-btn-label">Fetch</span>
        </button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Branch">
          <span className="toolbar-btn-icon">⑂</span>
          <span className="toolbar-btn-label">Branch</span>
        </button>
        <button className="toolbar-btn" title="Merge">
          <span className="toolbar-btn-icon">⤞</span>
          <span className="toolbar-btn-label">Merge</span>
        </button>
      </div>
      <div className="toolbar-separator" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Stash">
          <span className="toolbar-btn-icon">📦</span>
          <span className="toolbar-btn-label">Stash</span>
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button className="toolbar-btn" title="Settings (Ctrl+,)">
          <span className="toolbar-btn-icon">⚙</span>
        </button>
      </div>
    </div>
  )
}
