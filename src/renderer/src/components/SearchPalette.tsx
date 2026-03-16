import React, { useState, useCallback, useRef, useEffect } from 'react'

type SearchMode = 'all' | 'commits' | 'files' | 'branches'

interface SearchResult {
  type: 'commit' | 'file' | 'branch' | 'tag'
  label: string
  description: string
  value: string // hash for commit, path for file, name for branch/tag
}

interface SearchPaletteProps {
  currentRepo: string
  onClose: () => void
  onSelectCommit?: (hash: string) => void
  onSelectFile?: (filePath: string) => void
  onCheckoutBranch?: (branchName: string) => void
}

export function SearchPalette({
  currentRepo,
  onClose,
  onSelectCommit,
  onSelectFile,
  onCheckoutBranch
}: SearchPaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('all')
  const [results, setResults] = useState<SearchResult[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [confirmCheckout, setConfirmCheckout] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Scroll selected item into view
  useEffect(() => {
    if (resultsRef.current) {
      const selected = resultsRef.current.querySelector('.search-result-item.selected')
      if (selected) {
        selected.scrollIntoView({ block: 'nearest' })
      }
    }
  }, [selectedIndex])

  const performSearch = useCallback(
    async (searchQuery: string, searchMode: SearchMode) => {
      if (!searchQuery.trim()) {
        setResults([])
        setLoading(false)
        return
      }

      setLoading(true)
      const allResults: SearchResult[] = []

      try {
        // Search commits (message, SHA, author)
        if (searchMode === 'all' || searchMode === 'commits') {
          try {
            // Search by message/SHA
            const logResult = await window.electronAPI.git.exec(
              [
                'log',
                '--all',
                '--format=%H%x00%h%x00%s%x00%an%x00%ar',
                '--max-count=20',
                '--grep=' + searchQuery,
                '-i'
              ],
              currentRepo
            )
            if (logResult.success && logResult.data?.stdout) {
              const lines = (logResult.data.stdout as string)
                .split('\n')
                .filter((l: string) => l.trim())
              for (const line of lines) {
                const [hash, shortHash, subject, author, date] = line.split('\0')
                if (hash) {
                  allResults.push({
                    type: 'commit',
                    label: `${shortHash} ${subject}`,
                    description: `${author} - ${date}`,
                    value: hash
                  })
                }
              }
            }

            // Also search by author if not too many results
            if (allResults.length < 10) {
              const authorResult = await window.electronAPI.git.exec(
                [
                  'log',
                  '--all',
                  '--format=%H%x00%h%x00%s%x00%an%x00%ar',
                  '--max-count=10',
                  '--author=' + searchQuery,
                  '-i'
                ],
                currentRepo
              )
              if (authorResult.success && authorResult.data?.stdout) {
                const lines = (authorResult.data.stdout as string)
                  .split('\n')
                  .filter((l: string) => l.trim())
                for (const line of lines) {
                  const [hash, shortHash, subject, author, date] = line.split('\0')
                  if (hash && !allResults.some((r) => r.value === hash)) {
                    allResults.push({
                      type: 'commit',
                      label: `${shortHash} ${subject}`,
                      description: `${author} - ${date}`,
                      value: hash
                    })
                  }
                }
              }
            }

            // Search by SHA prefix
            if (searchQuery.match(/^[0-9a-f]{4,40}$/i)) {
              const shaResult = await window.electronAPI.git.exec(
                [
                  'log',
                  '--all',
                  '--format=%H%x00%h%x00%s%x00%an%x00%ar',
                  '--max-count=5',
                  searchQuery
                ],
                currentRepo
              )
              if (shaResult.success && shaResult.data?.stdout) {
                const lines = (shaResult.data.stdout as string)
                  .split('\n')
                  .filter((l: string) => l.trim())
                for (const line of lines) {
                  const [hash, shortHash, subject, author, date] = line.split('\0')
                  if (hash && !allResults.some((r) => r.value === hash)) {
                    allResults.push({
                      type: 'commit',
                      label: `${shortHash} ${subject}`,
                      description: `${author} - ${date}`,
                      value: hash
                    })
                  }
                }
              }
            }
          } catch {
            // Ignore commit search errors
          }
        }

        // Search files
        if (searchMode === 'all' || searchMode === 'files') {
          try {
            const filesResult = await window.electronAPI.git.exec(
              ['ls-files', '--full-name'],
              currentRepo
            )
            if (filesResult.success && filesResult.data?.stdout) {
              const files = (filesResult.data.stdout as string)
                .split('\n')
                .filter((f: string) => f.trim())
              const lowerQuery = searchQuery.toLowerCase()
              const matched = files
                .filter((f: string) => f.toLowerCase().includes(lowerQuery))
                .slice(0, 20)
              for (const filePath of matched) {
                const parts = filePath.split('/')
                const fileName = parts[parts.length - 1]
                const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : ''
                allResults.push({
                  type: 'file',
                  label: fileName,
                  description: dir ? dir + '/' : 'root',
                  value: filePath
                })
              }
            }
          } catch {
            // Ignore file search errors
          }
        }

        // Search branches and tags
        if (searchMode === 'all' || searchMode === 'branches') {
          try {
            // Local branches
            const branchResult = await window.electronAPI.git.getBranches(currentRepo)
            if (branchResult.success && Array.isArray(branchResult.data)) {
              const lowerQuery = searchQuery.toLowerCase()
              for (const branch of branchResult.data) {
                if (branch.name.toLowerCase().includes(lowerQuery)) {
                  allResults.push({
                    type: 'branch',
                    label: branch.name,
                    description: branch.current ? 'Current branch' : `Branch${branch.upstream ? ' → ' + branch.upstream : ''}`,
                    value: branch.name
                  })
                }
              }
            }

            // Tags
            const tagResult = await window.electronAPI.git.getTags(currentRepo)
            if (tagResult.success && Array.isArray(tagResult.data)) {
              const lowerQuery = searchQuery.toLowerCase()
              for (const tag of tagResult.data) {
                if (tag.name.toLowerCase().includes(lowerQuery)) {
                  allResults.push({
                    type: 'tag',
                    label: tag.name,
                    description: `Tag → ${tag.hash?.slice(0, 7) || ''}`,
                    value: tag.name
                  })
                }
              }
            }
          } catch {
            // Ignore branch/tag search errors
          }
        }
      } catch {
        // Ignore all errors
      } finally {
        setResults(allResults)
        setSelectedIndex(0)
        setLoading(false)
      }
    },
    [currentRepo]
  )

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }
    if (!query.trim()) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      performSearch(query, mode)
    }, 150)
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [query, mode, performSearch])

  const handleSelect = useCallback(
    (result: SearchResult) => {
      switch (result.type) {
        case 'commit':
          onSelectCommit?.(result.value)
          onClose()
          break
        case 'file':
          onSelectFile?.(result.value)
          onClose()
          break
        case 'branch':
          // Show confirmation before checkout
          setConfirmCheckout(result.value)
          break
        case 'tag':
          // Scroll to tag's commit in graph
          onSelectCommit?.(result.value)
          onClose()
          break
      }
    },
    [onSelectCommit, onSelectFile, onClose]
  )

  const handleCheckoutConfirm = useCallback(async () => {
    if (!confirmCheckout) return
    try {
      await window.electronAPI.git.checkout(currentRepo, confirmCheckout)
    } catch {
      // Ignore errors
    }
    onCheckoutBranch?.(confirmCheckout)
    setConfirmCheckout(null)
    onClose()
  }, [confirmCheckout, currentRepo, onCheckoutBranch, onClose])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (confirmCheckout) {
        if (e.key === 'Escape') {
          setConfirmCheckout(null)
          return
        }
        if (e.key === 'Enter') {
          handleCheckoutConfirm()
          return
        }
        return
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault()
          onClose()
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => Math.max(prev - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex])
          }
          break
        case 'Tab':
          e.preventDefault()
          // Cycle through modes
          setMode((prev) => {
            const modes: SearchMode[] = ['all', 'commits', 'files', 'branches']
            const idx = modes.indexOf(prev)
            return modes[(idx + 1) % modes.length]
          })
          break
      }
    },
    [onClose, results, selectedIndex, handleSelect, confirmCheckout, handleCheckoutConfirm]
  )

  const getTypeIcon = (type: SearchResult['type']): string => {
    switch (type) {
      case 'commit':
        return '\u25CB' // ○
      case 'file':
        return '\u25A1' // □
      case 'branch':
        return '\u2442' // ⑂
      case 'tag':
        return '\u2691' // ⚑
    }
  }

  const getTypeLabel = (type: SearchResult['type']): string => {
    switch (type) {
      case 'commit':
        return 'Commit'
      case 'file':
        return 'File'
      case 'branch':
        return 'Branch'
      case 'tag':
        return 'Tag'
    }
  }

  // Group results by type for display
  const groupedResults: { type: SearchResult['type']; items: SearchResult[] }[] = []
  let globalIdx = 0
  const typeOrder: SearchResult['type'][] = ['branch', 'tag', 'file', 'commit']
  for (const t of typeOrder) {
    const items = results.filter((r) => r.type === t)
    if (items.length > 0) {
      groupedResults.push({ type: t, items })
    }
  }

  return (
    <div className="search-palette-overlay" onClick={onClose}>
      <div className="search-palette" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        {/* Checkout confirmation */}
        {confirmCheckout && (
          <div className="search-palette-confirm">
            <p>
              Check out branch <strong>{confirmCheckout}</strong>?
            </p>
            <div className="search-palette-confirm-actions">
              <button
                className="branch-dialog-btn branch-dialog-btn-secondary"
                onClick={() => setConfirmCheckout(null)}
              >
                Cancel
              </button>
              <button
                className="branch-dialog-btn branch-dialog-btn-primary"
                onClick={handleCheckoutConfirm}
              >
                Checkout
              </button>
            </div>
          </div>
        )}

        {/* Search input */}
        {!confirmCheckout && (
          <>
            <div className="search-palette-header">
              <span className="search-palette-icon">&#x1F50E;</span>
              <input
                ref={inputRef}
                className="search-palette-input"
                type="text"
                placeholder={`Search ${mode === 'all' ? 'everything' : mode}... (Tab to switch mode)`}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {loading && <span className="search-palette-spinner">&#x23F3;</span>}
            </div>

            {/* Mode tabs */}
            <div className="search-palette-modes">
              {(
                [
                  ['all', 'All'],
                  ['commits', 'Commits'],
                  ['files', 'Files'],
                  ['branches', 'Branches/Tags']
                ] as [SearchMode, string][]
              ).map(([m, label]) => (
                <button
                  key={m}
                  className={`search-palette-mode-btn ${mode === m ? 'active' : ''}`}
                  onClick={() => setMode(m)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Results */}
            <div className="search-palette-results" ref={resultsRef}>
              {!query.trim() && (
                <div className="search-palette-empty">
                  Type to search commits, files, branches, and tags
                </div>
              )}
              {query.trim() && results.length === 0 && !loading && (
                <div className="search-palette-empty">No results found</div>
              )}
              {(() => {
                globalIdx = 0
                return groupedResults.map((group) => (
                  <div key={group.type} className="search-palette-group">
                    <div className="search-palette-group-header">
                      {getTypeIcon(group.type)} {getTypeLabel(group.type)}s ({group.items.length})
                    </div>
                    {group.items.map((result) => {
                      const idx = globalIdx++
                      return (
                        <div
                          key={`${result.type}-${result.value}-${idx}`}
                          className={`search-result-item ${idx === selectedIndex ? 'selected' : ''}`}
                          onClick={() => handleSelect(result)}
                          onMouseEnter={() => setSelectedIndex(idx)}
                        >
                          <span className="search-result-icon">{getTypeIcon(result.type)}</span>
                          <div className="search-result-content">
                            <span className="search-result-label">{result.label}</span>
                            <span className="search-result-description">{result.description}</span>
                          </div>
                          <span className="search-result-type-badge">{getTypeLabel(result.type)}</span>
                        </div>
                      )
                    })}
                  </div>
                ))
              })()}
            </div>

            {/* Footer */}
            <div className="search-palette-footer">
              <span>
                <kbd>&#x2191;</kbd>
                <kbd>&#x2193;</kbd> navigate
              </span>
              <span>
                <kbd>Enter</kbd> select
              </span>
              <span>
                <kbd>Tab</kbd> mode
              </span>
              <span>
                <kbd>Esc</kbd> close
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
