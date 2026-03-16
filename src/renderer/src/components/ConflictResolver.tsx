import React, { useState, useCallback, useEffect, useRef } from 'react'

interface ConflictResolverProps {
  repoPath: string
  onResolved: () => void
  onClose: () => void
}

interface ConflictFile {
  path: string
  resolved: boolean
}

interface ConflictBlock {
  id: number
  oursStart: number
  oursLines: string[]
  theirsLines: string[]
  baseLines: string[]
}

type ActiveOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null

export function ConflictResolver({
  repoPath,
  onResolved,
  onClose
}: ConflictResolverProps): React.JSX.Element {
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [oursContent, setOursContent] = useState<string | null>(null)
  const [theirsContent, setTheirsContent] = useState<string | null>(null)
  const [resultContent, setResultContent] = useState<string>('')
  const [conflicts, setConflicts] = useState<ConflictBlock[]>([])
  const [currentConflictIndex, setCurrentConflictIndex] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeOp, setActiveOp] = useState<ActiveOperation>(null)
  const [resolving, setResolving] = useState(false)
  const resultTextareaRef = useRef<HTMLTextAreaElement>(null)

  // Load conflicted files list
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const [filesResult, opResult] = await Promise.all([
        window.electronAPI.git.getConflictedFiles(repoPath),
        window.electronAPI.git.getActiveOperation(repoPath)
      ])

      if (filesResult.success && Array.isArray(filesResult.data)) {
        setFiles(filesResult.data.map((f: string) => ({ path: f, resolved: false })))
        if (filesResult.data.length > 0 && !selectedFile) {
          setSelectedFile(filesResult.data[0])
        }
      }

      if (opResult.success) {
        setActiveOp(opResult.data)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflicted files')
    } finally {
      setLoading(false)
    }
  }, [repoPath, selectedFile])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  // Parse conflict markers from merged content
  const parseConflicts = useCallback((content: string): ConflictBlock[] => {
    const lines = content.split('\n')
    const blocks: ConflictBlock[] = []
    let id = 0
    let i = 0

    while (i < lines.length) {
      if (lines[i].startsWith('<<<<<<<')) {
        const oursLines: string[] = []
        const baseLines: string[] = []
        const theirsLines: string[] = []
        const oursStart = i
        i++
        let section: 'ours' | 'base' | 'theirs' = 'ours'

        while (i < lines.length) {
          if (lines[i].startsWith('|||||||')) {
            section = 'base'
            i++
            continue
          }
          if (lines[i].startsWith('=======')) {
            section = 'theirs'
            i++
            continue
          }
          if (lines[i].startsWith('>>>>>>>')) {
            i++
            break
          }
          if (section === 'ours') oursLines.push(lines[i])
          else if (section === 'base') baseLines.push(lines[i])
          else theirsLines.push(lines[i])
          i++
        }

        blocks.push({ id: id++, oursStart, oursLines, theirsLines, baseLines })
      } else {
        i++
      }
    }

    return blocks
  }, [])

  // Load file content when selected
  useEffect(() => {
    if (!selectedFile) return

    const loadContent = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      try {
        const result = await window.electronAPI.git.getConflictContent(repoPath, selectedFile)
        if (result.success && result.data) {
          setOursContent(result.data.ours)
          setTheirsContent(result.data.theirs)
          setResultContent(result.data.merged)
          setConflicts(parseConflicts(result.data.merged))
          setCurrentConflictIndex(0)
        } else {
          setError(result.error || 'Failed to load conflict content')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conflict content')
      } finally {
        setLoading(false)
      }
    }

    loadContent()
  }, [selectedFile, repoPath, parseConflicts])

  // Apply resolution for a specific conflict block
  const resolveConflictBlock = useCallback(
    (conflictId: number, choice: 'ours' | 'theirs' | 'both') => {
      const lines = resultContent.split('\n')
      const newLines: string[] = []
      let i = 0
      let blockId = 0

      while (i < lines.length) {
        if (lines[i].startsWith('<<<<<<<')) {
          const oursLines: string[] = []
          const theirsLines: string[] = []
          i++
          let section: 'ours' | 'base' | 'theirs' = 'ours'

          while (i < lines.length) {
            if (lines[i].startsWith('|||||||')) {
              section = 'base'
              i++
              continue
            }
            if (lines[i].startsWith('=======')) {
              section = 'theirs'
              i++
              continue
            }
            if (lines[i].startsWith('>>>>>>>')) {
              i++
              break
            }
            if (section === 'ours') oursLines.push(lines[i])
            else if (section === 'theirs') theirsLines.push(lines[i])
            i++
          }

          if (blockId === conflictId) {
            if (choice === 'ours') newLines.push(...oursLines)
            else if (choice === 'theirs') newLines.push(...theirsLines)
            else {
              newLines.push(...oursLines)
              newLines.push(...theirsLines)
            }
          } else {
            // Re-emit the conflict block unchanged
            newLines.push(`<<<<<<< ours`)
            newLines.push(...oursLines)
            newLines.push('=======')
            newLines.push(...theirsLines)
            newLines.push('>>>>>>> theirs')
          }
          blockId++
        } else {
          newLines.push(lines[i])
          i++
        }
      }

      const newContent = newLines.join('\n')
      setResultContent(newContent)
      const newConflicts = parseConflicts(newContent)
      setConflicts(newConflicts)
      if (currentConflictIndex >= newConflicts.length && newConflicts.length > 0) {
        setCurrentConflictIndex(newConflicts.length - 1)
      }
    },
    [resultContent, parseConflicts, currentConflictIndex]
  )

  // Navigate to next/prev conflict
  const goToConflict = useCallback(
    (direction: 'next' | 'prev') => {
      if (conflicts.length === 0) return
      if (direction === 'next') {
        setCurrentConflictIndex((i) => Math.min(i + 1, conflicts.length - 1))
      } else {
        setCurrentConflictIndex((i) => Math.max(i - 1, 0))
      }
    },
    [conflicts.length]
  )

  // Scroll result textarea to current conflict
  useEffect(() => {
    if (!resultTextareaRef.current || conflicts.length === 0) return
    const textarea = resultTextareaRef.current
    const lines = resultContent.split('\n')
    const conflict = conflicts[currentConflictIndex]
    if (!conflict) return

    // Find the position of the conflict in the text
    let charPos = 0
    for (let i = 0; i < Math.min(conflict.oursStart, lines.length); i++) {
      charPos += lines[i].length + 1
    }

    // Approximate scroll position
    const lineHeight = textarea.scrollHeight / Math.max(lines.length, 1)
    textarea.scrollTop = Math.max(0, conflict.oursStart * lineHeight - textarea.clientHeight / 3)
  }, [currentConflictIndex, conflicts, resultContent])

  // Mark file as resolved
  const markFileResolved = useCallback(async () => {
    if (!selectedFile) return
    setResolving(true)
    try {
      const result = await window.electronAPI.git.resolveConflictFile(
        repoPath,
        selectedFile,
        resultContent
      )
      if (result.success) {
        setFiles((prev) =>
          prev.map((f) => (f.path === selectedFile ? { ...f, resolved: true } : f))
        )
        // Auto-select next unresolved file
        const nextUnresolved = files.find((f) => f.path !== selectedFile && !f.resolved)
        if (nextUnresolved) {
          setSelectedFile(nextUnresolved.path)
        }
      } else {
        setError(result.error || 'Failed to mark file as resolved')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve file')
    } finally {
      setResolving(false)
    }
  }, [selectedFile, repoPath, resultContent, files])

  // Accept ours/theirs for entire file
  const resolveFileWith = useCallback(
    async (choice: 'ours' | 'theirs') => {
      if (!selectedFile) return
      setResolving(true)
      try {
        const result = await window.electronAPI.git.resolveConflictFileWith(
          repoPath,
          selectedFile,
          choice
        )
        if (result.success) {
          setFiles((prev) =>
            prev.map((f) => (f.path === selectedFile ? { ...f, resolved: true } : f))
          )
          const nextUnresolved = files.find((f) => f.path !== selectedFile && !f.resolved)
          if (nextUnresolved) {
            setSelectedFile(nextUnresolved.path)
          }
        } else {
          setError(result.error || 'Failed to resolve file')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to resolve file')
      } finally {
        setResolving(false)
      }
    },
    [selectedFile, repoPath, files]
  )

  // Continue the operation after all files resolved
  const continueOperation = useCallback(async () => {
    setResolving(true)
    try {
      let result
      if (activeOp === 'merge') {
        // For merge, we just need to commit — all files should be staged
        result = await window.electronAPI.git.commit(repoPath, '')
      } else if (activeOp === 'rebase') {
        result = await window.electronAPI.git.rebaseContinue(repoPath)
      } else if (activeOp === 'cherry-pick') {
        result = await window.electronAPI.git.cherryPickContinue(repoPath)
      } else if (activeOp === 'revert') {
        result = await window.electronAPI.git.revertContinue(repoPath)
      }

      if (result?.success) {
        onResolved()
      } else {
        // Check if there are new conflicts
        const newFiles = await window.electronAPI.git.getConflictedFiles(repoPath)
        if (newFiles.success && Array.isArray(newFiles.data) && newFiles.data.length > 0) {
          setFiles(newFiles.data.map((f: string) => ({ path: f, resolved: false })))
          setSelectedFile(newFiles.data[0])
          setError('More conflicts found. Please resolve them and continue.')
        } else {
          setError(result?.error || 'Failed to continue operation')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue operation')
    } finally {
      setResolving(false)
    }
  }, [activeOp, repoPath, onResolved])

  // Abort the operation
  const abortOperation = useCallback(async () => {
    setResolving(true)
    try {
      let result
      if (activeOp === 'merge') {
        result = await window.electronAPI.git.mergeAbort(repoPath)
      } else if (activeOp === 'rebase') {
        result = await window.electronAPI.git.rebaseAbort(repoPath)
      } else if (activeOp === 'cherry-pick') {
        result = await window.electronAPI.git.cherryPickAbort(repoPath)
      } else if (activeOp === 'revert') {
        result = await window.electronAPI.git.revertAbort(repoPath)
      }

      if (result?.success) {
        onClose()
      } else {
        setError(result?.error || 'Failed to abort operation')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abort operation')
    } finally {
      setResolving(false)
    }
  }, [activeOp, repoPath, onClose])

  const allResolved = files.length > 0 && files.every((f) => f.resolved)
  const unresolvedCount = files.filter((f) => !f.resolved).length
  const hasConflictMarkers = resultContent.includes('<<<<<<<')

  // Syntax-highlight a line for display
  const highlightLine = (line: string, type: 'ours' | 'theirs' | 'base' | 'result'): string => {
    const typeClass =
      type === 'ours'
        ? 'conflict-line-ours'
        : type === 'theirs'
          ? 'conflict-line-theirs'
          : type === 'base'
            ? 'conflict-line-base'
            : ''
    return typeClass
  }

  const opLabel = activeOp
    ? activeOp.charAt(0).toUpperCase() + activeOp.slice(1)
    : 'Operation'

  return (
    <div className="conflict-resolver-overlay">
      <div className="conflict-resolver">
        {/* Header */}
        <div className="conflict-resolver-header">
          <div className="conflict-resolver-title">
            <span className="conflict-resolver-icon">&#9888;</span>
            <h3>{opLabel} Conflict Resolution</h3>
            <span className="conflict-resolver-file-count">
              {unresolvedCount} of {files.length} file{files.length !== 1 ? 's' : ''} unresolved
            </span>
          </div>
          <div className="conflict-resolver-header-actions">
            <button
              className="conflict-resolver-btn conflict-resolver-btn-abort"
              onClick={abortOperation}
              disabled={resolving}
              title={`Abort ${opLabel}`}
            >
              Abort {opLabel}
            </button>
            <button
              className="conflict-resolver-btn conflict-resolver-btn-close"
              onClick={onClose}
              title="Close (keep conflicts)"
            >
              &#x2715;
            </button>
          </div>
        </div>

        {error && (
          <div className="conflict-resolver-error">
            <span>&#9888;</span> {error}
            <button onClick={() => setError(null)}>&#x2715;</button>
          </div>
        )}

        <div className="conflict-resolver-body">
          {/* File List Sidebar */}
          <div className="conflict-resolver-file-list">
            <div className="conflict-resolver-file-list-header">Conflicted Files</div>
            {files.map((file) => (
              <button
                key={file.path}
                className={`conflict-resolver-file-item ${selectedFile === file.path ? 'active' : ''} ${file.resolved ? 'resolved' : ''}`}
                onClick={() => setSelectedFile(file.path)}
                title={file.path}
              >
                <span className={`conflict-file-status ${file.resolved ? 'resolved' : 'unresolved'}`}>
                  {file.resolved ? '\u2713' : '\u25CF'}
                </span>
                <span className="conflict-file-name">
                  {file.path.split('/').pop()}
                </span>
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          {selectedFile && !loading && (
            <div className="conflict-resolver-content">
              {/* Conflict Navigation Bar */}
              <div className="conflict-resolver-nav">
                <span className="conflict-nav-info">
                  {conflicts.length > 0
                    ? `Conflict ${currentConflictIndex + 1} of ${conflicts.length}`
                    : 'No conflict markers remaining'}
                </span>
                <div className="conflict-nav-buttons">
                  <button
                    className="conflict-nav-btn"
                    onClick={() => goToConflict('prev')}
                    disabled={conflicts.length === 0 || currentConflictIndex === 0}
                  >
                    &#9664; Prev
                  </button>
                  <button
                    className="conflict-nav-btn"
                    onClick={() => goToConflict('next')}
                    disabled={
                      conflicts.length === 0 || currentConflictIndex >= conflicts.length - 1
                    }
                  >
                    Next &#9654;
                  </button>
                </div>
                {conflicts.length > 0 && (
                  <div className="conflict-nav-resolve-btns">
                    <button
                      className="conflict-nav-btn conflict-accept-ours"
                      onClick={() => resolveConflictBlock(currentConflictIndex, 'ours')}
                      title="Accept Ours for this conflict"
                    >
                      Accept Ours
                    </button>
                    <button
                      className="conflict-nav-btn conflict-accept-theirs"
                      onClick={() => resolveConflictBlock(currentConflictIndex, 'theirs')}
                      title="Accept Theirs for this conflict"
                    >
                      Accept Theirs
                    </button>
                    <button
                      className="conflict-nav-btn conflict-accept-both"
                      onClick={() => resolveConflictBlock(currentConflictIndex, 'both')}
                      title="Accept Both for this conflict"
                    >
                      Accept Both
                    </button>
                  </div>
                )}
              </div>

              {/* 3-Pane View */}
              <div className="conflict-panes">
                {/* Ours Pane (left) */}
                <div className="conflict-pane conflict-pane-ours">
                  <div className="conflict-pane-header">
                    <span className="conflict-pane-label">Ours (Current)</span>
                    <button
                      className="conflict-pane-action"
                      onClick={() => resolveFileWith('ours')}
                      title="Accept entire ours version"
                    >
                      Accept All Ours
                    </button>
                  </div>
                  <div className="conflict-pane-content">
                    <pre className="conflict-pane-code">
                      {oursContent !== null ? (
                        oursContent.split('\n').map((line, idx) => (
                          <div key={idx} className={`conflict-code-line ${highlightLine(line, 'ours')}`}>
                            <span className="conflict-line-num">{idx + 1}</span>
                            <span className="conflict-line-text">{line}</span>
                          </div>
                        ))
                      ) : (
                        <div className="conflict-pane-empty">File not available on ours side</div>
                      )}
                    </pre>
                  </div>
                </div>

                {/* Theirs Pane (right) */}
                <div className="conflict-pane conflict-pane-theirs">
                  <div className="conflict-pane-header">
                    <span className="conflict-pane-label">Theirs (Incoming)</span>
                    <button
                      className="conflict-pane-action"
                      onClick={() => resolveFileWith('theirs')}
                      title="Accept entire theirs version"
                    >
                      Accept All Theirs
                    </button>
                  </div>
                  <div className="conflict-pane-content">
                    <pre className="conflict-pane-code">
                      {theirsContent !== null ? (
                        theirsContent.split('\n').map((line, idx) => (
                          <div key={idx} className={`conflict-code-line ${highlightLine(line, 'theirs')}`}>
                            <span className="conflict-line-num">{idx + 1}</span>
                            <span className="conflict-line-text">{line}</span>
                          </div>
                        ))
                      ) : (
                        <div className="conflict-pane-empty">
                          File not available on theirs side
                        </div>
                      )}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Result Pane (bottom) */}
              <div className="conflict-pane conflict-pane-result">
                <div className="conflict-pane-header">
                  <span className="conflict-pane-label">
                    Result
                    {hasConflictMarkers && (
                      <span className="conflict-markers-warning">
                        {' '}
                        &#9888; Contains conflict markers
                      </span>
                    )}
                  </span>
                  <button
                    className="conflict-pane-action conflict-mark-resolved"
                    onClick={markFileResolved}
                    disabled={resolving || hasConflictMarkers}
                    title={
                      hasConflictMarkers
                        ? 'Resolve all conflicts before marking as resolved'
                        : 'Mark this file as resolved'
                    }
                  >
                    {resolving ? 'Resolving...' : '\u2713 Mark as Resolved'}
                  </button>
                </div>
                <textarea
                  ref={resultTextareaRef}
                  className="conflict-result-editor"
                  value={resultContent}
                  onChange={(e) => {
                    setResultContent(e.target.value)
                    setConflicts(parseConflicts(e.target.value))
                  }}
                  spellCheck={false}
                />
              </div>
            </div>
          )}

          {loading && (
            <div className="conflict-resolver-loading">Loading conflict data...</div>
          )}
        </div>

        {/* Footer */}
        {allResolved && (
          <div className="conflict-resolver-footer">
            <div className="conflict-resolver-footer-msg">
              All conflicts resolved! Continue the {opLabel.toLowerCase()} operation?
            </div>
            <button
              className="conflict-resolver-btn conflict-resolver-btn-continue"
              onClick={continueOperation}
              disabled={resolving}
            >
              {resolving ? 'Processing...' : `Continue ${opLabel}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
