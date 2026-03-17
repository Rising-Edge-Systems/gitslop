import React, { useCallback, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommitFilters {
  author: string
  since: string
  until: string
  grep: string
  path: string
}

export const EMPTY_FILTERS: CommitFilters = {
  author: '',
  since: '',
  until: '',
  grep: '',
  path: ''
}

export function hasActiveFilters(filters: CommitFilters): boolean {
  return !!(filters.author || filters.since || filters.until || filters.grep || filters.path)
}

interface CommitFilterBarProps {
  filters: CommitFilters
  onFiltersChange: (filters: CommitFilters) => void
  /** Optional: called to show history for a file from context menu */
  filePath?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CommitFilterBar({
  filters,
  onFiltersChange,
  filePath
}: CommitFilterBarProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [draft, setDraft] = useState<CommitFilters>({ ...filters })

  // Sync filePath from context menu
  React.useEffect(() => {
    if (filePath && filePath !== filters.path) {
      const updated = { ...filters, path: filePath }
      onFiltersChange(updated)
      setDraft(updated)
    }
  }, [filePath]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = hasActiveFilters(filters)

  const handleApply = useCallback(() => {
    onFiltersChange({ ...draft })
  }, [draft, onFiltersChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleApply()
      }
    },
    [handleApply]
  )

  const handleClearAll = useCallback(() => {
    const empty = { ...EMPTY_FILTERS }
    setDraft(empty)
    onFiltersChange(empty)
  }, [onFiltersChange])

  const removeFilter = useCallback(
    (key: keyof CommitFilters) => {
      const updated = { ...filters, [key]: '' }
      setDraft(updated)
      onFiltersChange(updated)
    },
    [filters, onFiltersChange]
  )

  const filterLabel = (key: keyof CommitFilters): string => {
    switch (key) {
      case 'author':
        return 'Author'
      case 'since':
        return 'Since'
      case 'until':
        return 'Until'
      case 'grep':
        return 'Message'
      case 'path':
        return 'File'
    }
  }

  // Build active filter chips
  const activeChips = (Object.keys(filters) as (keyof CommitFilters)[]).filter(
    (k) => filters[k] !== ''
  )

  return (
    <div className="commit-filter-bar">
      <div className="commit-filter-header">
        <button
          className={`commit-filter-toggle ${expanded ? 'expanded' : ''} ${active ? 'active' : ''}`}
          onClick={() => setExpanded((prev) => !prev)}
          title="Toggle commit filters"
        >
          <span className="commit-filter-icon"><ChevronDown size={14} /></span>
          <span>Filter History</span>
          {active && (
            <span className="commit-filter-badge">{activeChips.length}</span>
          )}
        </button>

        {/* Active filter chips */}
        {active && (
          <div className="commit-filter-chips">
            {activeChips.map((key) => (
              <span key={key} className="commit-filter-chip">
                <span className="commit-filter-chip-label">{filterLabel(key)}:</span>
                <span className="commit-filter-chip-value">{filters[key]}</span>
                <button
                  className="commit-filter-chip-remove"
                  onClick={() => removeFilter(key)}
                  title={`Remove ${filterLabel(key)} filter`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <button className="commit-filter-clear-all" onClick={handleClearAll}>
              Clear all
            </button>
          </div>
        )}

        {active && !expanded && (
          <div className="commit-filter-indicator">
            Showing filtered history
          </div>
        )}
      </div>

      {expanded && (
        <div className="commit-filter-form" onKeyDown={handleKeyDown}>
          <div className="commit-filter-row">
            <label className="commit-filter-label" htmlFor="filter-author">
              Author
            </label>
            <input
              id="filter-author"
              className="commit-filter-input"
              type="text"
              placeholder="e.g. John Doe or john@example.com"
              value={draft.author}
              onChange={(e) => setDraft((d) => ({ ...d, author: e.target.value }))}
            />
          </div>

          <div className="commit-filter-row">
            <label className="commit-filter-label" htmlFor="filter-message">
              Message
            </label>
            <input
              id="filter-message"
              className="commit-filter-input"
              type="text"
              placeholder="Search commit messages..."
              value={draft.grep}
              onChange={(e) => setDraft((d) => ({ ...d, grep: e.target.value }))}
            />
          </div>

          <div className="commit-filter-row commit-filter-row-dates">
            <div className="commit-filter-date-field">
              <label className="commit-filter-label" htmlFor="filter-since">
                Since
              </label>
              <input
                id="filter-since"
                className="commit-filter-input"
                type="date"
                value={draft.since}
                onChange={(e) => setDraft((d) => ({ ...d, since: e.target.value }))}
              />
            </div>
            <div className="commit-filter-date-field">
              <label className="commit-filter-label" htmlFor="filter-until">
                Until
              </label>
              <input
                id="filter-until"
                className="commit-filter-input"
                type="date"
                value={draft.until}
                onChange={(e) => setDraft((d) => ({ ...d, until: e.target.value }))}
              />
            </div>
          </div>

          <div className="commit-filter-row">
            <label className="commit-filter-label" htmlFor="filter-path">
              File Path
            </label>
            <input
              id="filter-path"
              className="commit-filter-input"
              type="text"
              placeholder="e.g. src/main/index.ts"
              value={draft.path}
              onChange={(e) => setDraft((d) => ({ ...d, path: e.target.value }))}
            />
          </div>

          <div className="commit-filter-actions">
            <button className="commit-filter-apply" onClick={handleApply}>
              Apply Filters
            </button>
            <button className="commit-filter-clear" onClick={handleClearAll}>
              Clear All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
