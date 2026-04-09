import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Package, ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './DiffViewer.module.css'

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiffViewMode = 'inline' | 'side-by-side'

interface DiffHunk {
  header: string
  headerSuffix: string // function name etc after @@
  lines: DiffLine[]
}

interface DiffLine {
  type: 'context' | 'added' | 'removed'
  content: string // line content WITHOUT the +/-/space prefix
  rawContent: string // original line with prefix
  oldLineNum: number | null
  newLineNum: number | null
}

interface FileHeader {
  lines: string[]
  oldFile: string
  newFile: string
  isBinary: boolean
}

interface ParsedDiff {
  fileHeader: FileHeader
  hunks: DiffHunk[]
}

interface SideBySidePair {
  left: DiffLine | null
  right: DiffLine | null
}

// ─── Word-level diff ────────────────────────────────────────────────────────

interface WordDiffSegment {
  text: string
  type: 'common' | 'added' | 'removed'
}

function computeWordDiff(oldText: string, newText: string): { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] } {
  // Tokenize into words (keeping whitespace as separate tokens)
  const tokenize = (s: string): string[] => {
    const tokens: string[] = []
    let current = ''
    for (const ch of s) {
      if (/\s/.test(ch)) {
        if (current) { tokens.push(current); current = '' }
        tokens.push(ch)
      } else if (/[{}()[\];,.<>:=+\-*/&|!~^%?@#]/.test(ch)) {
        if (current) { tokens.push(current); current = '' }
        tokens.push(ch)
      } else {
        current += ch
      }
    }
    if (current) tokens.push(current)
    return tokens
  }

  const oldTokens = tokenize(oldText)
  const newTokens = tokenize(newText)

  // Simple LCS-based diff on tokens
  const m = oldTokens.length
  const n = newTokens.length

  // For very large diffs, skip word-level (too expensive)
  if (m * n > 50000) {
    return {
      oldSegments: [{ text: oldText, type: 'removed' }],
      newSegments: [{ text: newText, type: 'added' }]
    }
  }

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldTokens[i - 1] === newTokens[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to get diff
  const oldSegs: WordDiffSegment[] = []
  const newSegs: WordDiffSegment[] = []
  let i = m, j = n
  const oldResult: WordDiffSegment[] = []
  const newResult: WordDiffSegment[] = []

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
      oldResult.unshift({ text: oldTokens[i - 1], type: 'common' })
      newResult.unshift({ text: newTokens[j - 1], type: 'common' })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      newResult.unshift({ text: newTokens[j - 1], type: 'added' })
      j--
    } else {
      oldResult.unshift({ text: oldTokens[i - 1], type: 'removed' })
      i--
    }
  }

  // Merge consecutive segments of same type
  const merge = (segs: WordDiffSegment[]): WordDiffSegment[] => {
    const merged: WordDiffSegment[] = []
    for (const s of segs) {
      if (merged.length > 0 && merged[merged.length - 1].type === s.type) {
        merged[merged.length - 1].text += s.text
      } else {
        merged.push({ ...s })
      }
    }
    return merged
  }

  return { oldSegments: merge(oldResult), newSegments: merge(newResult) }
}

// ─── Syntax Highlighting (lightweight) ──────────────────────────────────────

const LANG_EXTENSIONS: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  py: 'python', pyw: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  c: 'c', h: 'c',
  cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp', hxx: 'cpp',
  html: 'html', htm: 'html',
  css: 'css', scss: 'css', less: 'css',
  json: 'json',
  yaml: 'yaml', yml: 'yaml',
  md: 'markdown', markdown: 'markdown',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  sql: 'sql',
  xml: 'xml', svg: 'xml',
  toml: 'toml',
  vue: 'html',
  svelte: 'html'
}

interface SyntaxToken {
  text: string
  className: string
}

const KEYWORDS: Record<string, Set<string>> = {
  javascript: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined', 'void', 'delete', 'yield', 'static', 'get', 'set', 'with', 'debugger']),
  typescript: new Set(['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'super', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'true', 'false', 'null', 'undefined', 'void', 'delete', 'yield', 'static', 'get', 'set', 'type', 'interface', 'enum', 'namespace', 'as', 'is', 'keyof', 'infer', 'implements', 'abstract', 'declare', 'readonly', 'private', 'protected', 'public']),
  python: new Set(['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'yield', 'lambda', 'pass', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'del', 'global', 'nonlocal', 'assert', 'async', 'await', 'self']),
  rust: new Set(['fn', 'let', 'mut', 'const', 'if', 'else', 'match', 'for', 'while', 'loop', 'break', 'continue', 'return', 'struct', 'enum', 'impl', 'trait', 'type', 'pub', 'use', 'mod', 'self', 'super', 'crate', 'as', 'where', 'async', 'await', 'move', 'unsafe', 'true', 'false', 'ref', 'static', 'extern', 'dyn', 'box']),
  go: new Set(['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'defer', 'select', 'chan', 'map', 'struct', 'interface', 'type', 'var', 'const', 'package', 'import', 'true', 'false', 'nil', 'make', 'new', 'append', 'len', 'cap', 'close', 'delete', 'copy', 'panic', 'recover', 'fallthrough', 'goto']),
  java: new Set(['class', 'interface', 'extends', 'implements', 'new', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'public', 'private', 'protected', 'static', 'final', 'abstract', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'true', 'false', 'null', 'this', 'super', 'instanceof', 'enum', 'synchronized', 'volatile', 'transient', 'native']),
  c: new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'struct', 'union', 'enum', 'typedef', 'void', 'int', 'long', 'short', 'char', 'float', 'double', 'unsigned', 'signed', 'const', 'static', 'extern', 'volatile', 'register', 'sizeof', 'NULL', 'true', 'false', 'include', 'define', 'ifdef', 'ifndef', 'endif', 'pragma']),
  cpp: new Set(['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'class', 'struct', 'union', 'enum', 'typedef', 'void', 'int', 'long', 'short', 'char', 'float', 'double', 'unsigned', 'signed', 'const', 'static', 'extern', 'volatile', 'register', 'sizeof', 'new', 'delete', 'this', 'true', 'false', 'nullptr', 'namespace', 'using', 'template', 'typename', 'virtual', 'override', 'public', 'private', 'protected', 'auto', 'constexpr', 'noexcept', 'throw', 'try', 'catch', 'include', 'define']),
}

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return null
  return LANG_EXTENSIONS[ext] || null
}

function highlightLine(text: string, lang: string | null): SyntaxToken[] {
  if (!lang) return [{ text, className: '' }]

  const tokens: SyntaxToken[] = []
  const keywords = KEYWORDS[lang] || KEYWORDS['javascript'] || new Set()
  let i = 0

  while (i < text.length) {
    // String literals
    if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const quote = text[i]
      let j = i + 1
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j++ // skip escaped chars
        j++
      }
      if (j < text.length) j++ // include closing quote
      tokens.push({ text: text.slice(i, j), className: 'syn-string' })
      i = j
      continue
    }

    // Line comments
    if (text[i] === '/' && text[i + 1] === '/') {
      tokens.push({ text: text.slice(i), className: 'syn-comment' })
      i = text.length
      continue
    }
    if (text[i] === '#' && (lang === 'python' || lang === 'shell' || lang === 'ruby' || lang === 'yaml' || lang === 'toml')) {
      tokens.push({ text: text.slice(i), className: 'syn-comment' })
      i = text.length
      continue
    }

    // Numbers
    if (/\d/.test(text[i]) && (i === 0 || /[\s,;([\]{}<>=+\-*/!~^%&|?:]/.test(text[i - 1]))) {
      let j = i
      while (j < text.length && /[0-9a-fA-FxXoObBeE._]/.test(text[j])) j++
      tokens.push({ text: text.slice(i, j), className: 'syn-number' })
      i = j
      continue
    }

    // Identifiers / keywords
    if (/[a-zA-Z_$@]/.test(text[i])) {
      let j = i
      while (j < text.length && /[a-zA-Z0-9_$]/.test(text[j])) j++
      const word = text.slice(i, j)
      if (keywords.has(word)) {
        tokens.push({ text: word, className: 'syn-keyword' })
      } else if (j < text.length && text[j] === '(') {
        tokens.push({ text: word, className: 'syn-function' })
      } else if (word[0] === word[0].toUpperCase() && /[a-z]/.test(word.slice(1))) {
        tokens.push({ text: word, className: 'syn-type' })
      } else {
        tokens.push({ text: word, className: '' })
      }
      i = j
      continue
    }

    // Operators
    if (/[+\-*/%=<>!&|^~?:]/.test(text[i])) {
      let j = i
      while (j < text.length && /[+\-*/%=<>!&|^~?:]/.test(text[j])) j++
      tokens.push({ text: text.slice(i, j), className: 'syn-operator' })
      i = j
      continue
    }

    // Default: single char
    tokens.push({ text: text[i], className: '' })
    i++
  }

  return tokens
}

// ─── Diff Parser ────────────────────────────────────────────────────────────

function parseDiff(diffText: string): ParsedDiff {
  const allLines = diffText.split('\n')
  const fileHeaderLines: string[] = []
  const hunks: DiffHunk[] = []
  let currentHunk: DiffHunk | null = null
  let oldLine = 0
  let newLine = 0
  let inHeader = true
  let isBinary = false
  let oldFile = ''
  let newFile = ''

  for (const line of allLines) {
    // Check for binary file
    if (line.startsWith('Binary files') || line.includes('GIT binary patch')) {
      isBinary = true
    }

    // Parse filenames from header
    if (line.startsWith('--- a/')) {
      oldFile = line.slice(6)
    } else if (line.startsWith('--- /dev/null')) {
      oldFile = '/dev/null'
    }
    if (line.startsWith('+++ b/')) {
      newFile = line.slice(6)
    } else if (line.startsWith('+++ /dev/null')) {
      newFile = '/dev/null'
    }

    if (line.startsWith('@@')) {
      inHeader = false
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      oldLine = match ? parseInt(match[1], 10) : 1
      newLine = match ? parseInt(match[2], 10) : 1
      const headerSuffix = match ? match[3].trim() : ''
      currentHunk = { header: line, headerSuffix, lines: [] }
      hunks.push(currentHunk)
    } else if (inHeader) {
      fileHeaderLines.push(line)
    } else if (currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'added', content: line.slice(1), rawContent: line, oldLineNum: null, newLineNum: newLine })
        newLine++
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'removed', content: line.slice(1), rawContent: line, oldLineNum: oldLine, newLineNum: null })
        oldLine++
      } else if (line.startsWith('\\')) {
        currentHunk.lines.push({ type: 'context', content: line, rawContent: line, oldLineNum: null, newLineNum: null })
      } else {
        currentHunk.lines.push({ type: 'context', content: line.slice(1) || '', rawContent: line, oldLineNum: oldLine, newLineNum: newLine })
        oldLine++
        newLine++
      }
    }
  }

  return {
    fileHeader: { lines: fileHeaderLines, oldFile, newFile, isBinary },
    hunks
  }
}

// ─── Side-by-side pairing ───────────────────────────────────────────────────

function pairLinesForSideBySide(hunks: DiffHunk[]): { pairs: SideBySidePair[]; hunkHeaders: { index: number; header: string; suffix: string }[] } {
  const pairs: SideBySidePair[] = []
  const hunkHeaders: { index: number; header: string; suffix: string }[] = []

  for (const hunk of hunks) {
    hunkHeaders.push({ index: pairs.length, header: hunk.header, suffix: hunk.headerSuffix })

    let i = 0
    while (i < hunk.lines.length) {
      const line = hunk.lines[i]

      if (line.type === 'context') {
        pairs.push({ left: line, right: line })
        i++
      } else if (line.type === 'removed') {
        // Collect consecutive removed lines, then pair with following added lines
        const removedStart = i
        while (i < hunk.lines.length && hunk.lines[i].type === 'removed') i++
        const addedStart = i
        while (i < hunk.lines.length && hunk.lines[i].type === 'added') i++

        const removedLines = hunk.lines.slice(removedStart, addedStart)
        const addedLines = hunk.lines.slice(addedStart, i)
        const maxLen = Math.max(removedLines.length, addedLines.length)

        for (let k = 0; k < maxLen; k++) {
          pairs.push({
            left: k < removedLines.length ? removedLines[k] : null,
            right: k < addedLines.length ? addedLines[k] : null
          })
        }
      } else if (line.type === 'added') {
        pairs.push({ left: null, right: line })
        i++
      } else {
        i++
      }
    }
  }

  return { pairs, hunkHeaders }
}

// ─── Constants ──────────────────────────────────────────────────────────────

// ─── CSS Module Lookup Maps ──────────────────────────────────────────────────

const lineTypeClass: Record<string, string> = {
  added: styles.lineAdded,
  removed: styles.lineRemoved,
  context: styles.lineContext
}

const sbsLineTypeClass: Record<string, string> = {
  added: styles.sbsLineAdded,
  removed: styles.sbsLineRemoved,
  context: styles.sbsLineContext
}

const LARGE_FILE_LINE_LIMIT = 1000
const INITIAL_DISPLAY_LIMIT = 2000

// ─── Component Props ────────────────────────────────────────────────────────

export interface DiffViewerProps {
  diffContent: string
  filePath: string
  /** If not specified, defaults to 'inline' */
  initialMode?: DiffViewMode
  /** Called when user toggles between inline and side-by-side mode */
  onModeChange?: (mode: DiffViewMode) => void
  /** Callback for hunk staging (from StatusPanel integration) */
  onStageHunk?: (hunkIdx: number) => void
  onUnstageHunk?: (hunkIdx: number) => void
  staged?: boolean
  isUntracked?: boolean
  className?: string
  /** File change status: M=Modified, A=Added, D=Deleted, R=Renamed */
  fileStatus?: string
  /** Current file index (0-based) in the commit's file list */
  fileIndex?: number
  /** Total number of files in the commit */
  fileCount?: number
  /** Navigate to prev/next file */
  onNavigateFile?: (direction: 'prev' | 'next') => void
}

// ─── Main Component ─────────────────────────────────────────────────────────

/** Map file status code to a label and CSS class */
function getStatusBadge(status?: string): { label: string; className: string } {
  switch (status) {
    case 'A': return { label: 'Added', className: styles.badgeAdded }
    case 'D': return { label: 'Deleted', className: styles.badgeDeleted }
    case 'R': case 'C': return { label: 'Renamed', className: styles.badgeRenamed }
    case 'M': return { label: 'Modified', className: styles.badgeModified }
    default: return { label: 'Modified', className: styles.badgeModified }
  }
}

export function DiffViewer({
  diffContent,
  filePath,
  initialMode = 'inline',
  onModeChange,
  className = '',
  fileStatus,
  fileIndex,
  fileCount,
  onNavigateFile
}: DiffViewerProps): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialMode)
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
  const [largeDiffExpanded, setLargeDiffExpanded] = useState(false)
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)

  const parsed = useMemo(() => parseDiff(diffContent), [diffContent])
  const language = useMemo(() => detectLanguage(filePath), [filePath])

  const totalLines = useMemo(
    () => parsed.hunks.reduce((sum, h) => sum + h.lines.length, 0),
    [parsed.hunks]
  )
  const isLargeFile = totalLines > LARGE_FILE_LINE_LIMIT
  const isTruncated = isLargeFile && displayLimit < totalLines

  // Reset display limit and collapse state on new diff
  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
    setLargeDiffExpanded(false)
  }, [diffContent])

  // ─── Scroll Sync (side-by-side) ─────────────────────────────────────────

  const handleScrollSync = useCallback((source: 'left' | 'right') => {
    if (syncingRef.current) return
    syncingRef.current = true

    const sourceEl = source === 'left' ? leftPaneRef.current : rightPaneRef.current
    const targetEl = source === 'left' ? rightPaneRef.current : leftPaneRef.current

    if (sourceEl && targetEl) {
      targetEl.scrollTop = sourceEl.scrollTop
    }

    requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }, [])

  // ─── Binary file ────────────────────────────────────────────────────────

  const statusBadge = getStatusBadge(fileStatus)

  // Shared toolbar for all views
  const toolbarContent = (
    <div className={styles.toolbar}>
      <div className={styles.toolbarLeft}>
        <span className={styles.filename}>{filePath}</span>
        {fileStatus && (
          <span className={`${styles.statusBadge} ${statusBadge.className}`}>
            {statusBadge.label}
          </span>
        )}
      </div>
      <div className={styles.toolbarRight}>
        {fileCount != null && fileCount > 1 && (
          <div className={styles.fileNav}>
            <button
              className={styles.fileNavBtn}
              onClick={() => onNavigateFile?.('prev')}
              title="Previous file ([)"
            >
              <ChevronLeft size={14} />
            </button>
            <span className={styles.fileCounter}>
              {(fileIndex ?? 0) + 1}/{fileCount}
            </span>
            <button
              className={styles.fileNavBtn}
              onClick={() => onNavigateFile?.('next')}
              title="Next file (])"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        )}
        <div className={styles.modeToggle}>
          <button
            className={`${styles.modeBtn} ${mode === 'inline' ? styles.modeBtnActive : ''}`}
            onClick={() => { setMode('inline'); onModeChange?.('inline') }}
            title="Inline (unified) diff"
          >
            Inline
          </button>
          <button
            className={`${styles.modeBtn} ${mode === 'side-by-side' ? styles.modeBtnActive : ''}`}
            onClick={() => { setMode('side-by-side'); onModeChange?.('side-by-side') }}
            title="Side-by-side diff"
          >
            Split
          </button>
        </div>
      </div>
    </div>
  )

  if (parsed.fileHeader.isBinary) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        {toolbarContent}
        <div className={styles.binary}>
          <span className={styles.binaryIcon}><Package size={18} /></span>
          <span>Binary file changed</span>
          <span className={styles.binaryHint}>Binary files cannot be displayed in the diff viewer</span>
        </div>
      </div>
    )
  }

  // If no hunks, show raw (e.g. untracked file placeholder text)
  const hasValidHeader = parsed.fileHeader.lines.some((l) => l.startsWith('diff --git'))
  if (parsed.hunks.length === 0 || !hasValidHeader) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        {toolbarContent}
        <pre className={styles.raw}>{diffContent}</pre>
      </div>
    )
  }

  // Large diff (1000+ lines): collapsed by default with placeholder
  if (isLargeFile && !largeDiffExpanded) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        {toolbarContent}
        <div className={styles.largeDiffPlaceholder}>
          <span className={styles.largeDiffText}>
            Large diff — {totalLines.toLocaleString()} lines
          </span>
          <button
            className={styles.largeDiffExpandBtn}
            onClick={() => setLargeDiffExpanded(true)}
          >
            Click to expand
          </button>
        </div>
      </div>
    )
  }

  // ─── Truncation ─────────────────────────────────────────────────────────

  // Build truncated hunks if needed
  let displayHunks = parsed.hunks
  if (isLargeFile) {
    let lineCount = 0
    const truncated: DiffHunk[] = []
    for (const hunk of parsed.hunks) {
      if (lineCount >= displayLimit) break
      if (lineCount + hunk.lines.length <= displayLimit) {
        truncated.push(hunk)
        lineCount += hunk.lines.length
      } else {
        // Partial hunk
        const remaining = displayLimit - lineCount
        truncated.push({
          header: hunk.header,
          headerSuffix: hunk.headerSuffix,
          lines: hunk.lines.slice(0, remaining)
        })
        lineCount += remaining
      }
    }
    displayHunks = truncated
  }

  return (
    <div className={`${styles.diffViewer} ${className}`}>
      {toolbarContent}

      {/* Diff Content */}
      {mode === 'inline' ? (
        <InlineDiffView hunks={displayHunks} language={language} />
      ) : (
        <SideBySideDiffView
          hunks={displayHunks}
          language={language}
          leftPaneRef={leftPaneRef}
          rightPaneRef={rightPaneRef}
          onScrollSync={handleScrollSync}
        />
      )}

      {/* Show More button for large files */}
      {isTruncated && (
        <div className={styles.truncated}>
          <span className={styles.truncatedInfo}>
            Showing {displayLimit.toLocaleString()} of {totalLines.toLocaleString()} lines
          </span>
          <button
            className={styles.showMore}
            onClick={() => setDisplayLimit((prev) => Math.min(prev + 2000, totalLines))}
          >
            Show More ({Math.min(2000, totalLines - displayLimit).toLocaleString()} lines)
          </button>
          <button
            className={styles.showAll}
            onClick={() => setDisplayLimit(totalLines)}
          >
            Show All
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Inline Diff View ───────────────────────────────────────────────────────

function InlineDiffView({ hunks, language }: { hunks: DiffHunk[]; language: string | null }): React.JSX.Element {
  // Build word-level diff cache for adjacent removed/added pairs
  const wordDiffCache = useMemo(() => {
    const cache = new Map<string, { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] }>()
    for (const hunk of hunks) {
      let i = 0
      while (i < hunk.lines.length) {
        if (hunk.lines[i].type === 'removed') {
          const removedStart = i
          while (i < hunk.lines.length && hunk.lines[i].type === 'removed') i++
          const addedStart = i
          while (i < hunk.lines.length && hunk.lines[i].type === 'added') i++
          // Pair up removed/added for word diff
          const removedLines = hunk.lines.slice(removedStart, addedStart)
          const addedLines = hunk.lines.slice(addedStart, i)
          const pairCount = Math.min(removedLines.length, addedLines.length)
          for (let k = 0; k < pairCount; k++) {
            const key = `${removedLines[k].oldLineNum}:${addedLines[k].newLineNum}`
            cache.set(key, computeWordDiff(removedLines[k].content, addedLines[k].content))
          }
        } else {
          i++
        }
      }
    }
    return cache
  }, [hunks])

  return (
    <div className={styles.inlineView}>
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className={styles.hunk}>
          <div className={styles.hunkHeader}>
            <span className={styles.hunkHeaderText}>{hunk.header}</span>
            {hunk.headerSuffix && (
              <span className={styles.hunkHeaderSuffix}>{hunk.headerSuffix}</span>
            )}
          </div>
          {hunk.lines.map((line, lineIdx) => {
            if (line.content.startsWith('\\')) {
              return (
                <div key={lineIdx} className={`${styles.line} ${styles.lineMeta}`}>
                  <span className={styles.lineNum} />
                  <span className={styles.lineNum} />
                  <span className={styles.linePrefix} />
                  <span className={styles.lineContent}>{line.content}</span>
                </div>
              )
            }

            // Word-level diff for paired removed/added lines
            let wordDiffInfo: { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] } | undefined
            if (line.type === 'removed' || line.type === 'added') {
              // Find the paired line
              const pairKey = line.type === 'removed'
                ? findAddedPairKey(hunk, lineIdx)
                : findRemovedPairKey(hunk, lineIdx)
              if (pairKey) {
                wordDiffInfo = wordDiffCache.get(pairKey)
              }
            }

            const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '

            return (
              <div key={lineIdx} className={`${styles.line} ${lineTypeClass[line.type] || ''}`}>
                <span className={styles.lineNum}>
                  {line.oldLineNum ?? ''}
                </span>
                <span className={styles.lineNum}>
                  {line.newLineNum ?? ''}
                </span>
                <span className={styles.linePrefix}>{prefix}</span>
                <span className={styles.lineContent}>
                  {wordDiffInfo ? (
                    <WordDiffContent
                      segments={line.type === 'removed' ? wordDiffInfo.oldSegments : wordDiffInfo.newSegments}
                      lineType={line.type}
                    />
                  ) : (
                    <SyntaxHighlightedContent text={line.content} language={language} />
                  )}
                </span>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// Helper to find the paired added line key for a removed line
function findAddedPairKey(hunk: DiffHunk, removedIdx: number): string | null {
  // Count how many removed lines before this one in the current block
  let blockStart = removedIdx
  while (blockStart > 0 && hunk.lines[blockStart - 1].type === 'removed') blockStart--
  const posInBlock = removedIdx - blockStart

  // Find start of added block
  let addedStart = removedIdx + 1
  while (addedStart < hunk.lines.length && hunk.lines[addedStart].type === 'removed') addedStart++

  const addedIdx = addedStart + posInBlock
  if (addedIdx < hunk.lines.length && hunk.lines[addedIdx].type === 'added') {
    return `${hunk.lines[removedIdx].oldLineNum}:${hunk.lines[addedIdx].newLineNum}`
  }
  return null
}

function findRemovedPairKey(hunk: DiffHunk, addedIdx: number): string | null {
  // Find start of added block
  let addedBlockStart = addedIdx
  while (addedBlockStart > 0 && hunk.lines[addedBlockStart - 1].type === 'added') addedBlockStart--
  const posInBlock = addedIdx - addedBlockStart

  // Find removed block (just before added block)
  let removedEnd = addedBlockStart - 1
  while (removedEnd >= 0 && hunk.lines[removedEnd].type !== 'removed') removedEnd--
  if (removedEnd < 0) return null

  let removedStart = removedEnd
  while (removedStart > 0 && hunk.lines[removedStart - 1].type === 'removed') removedStart--

  const removedIdx = removedStart + posInBlock
  if (removedIdx <= removedEnd && hunk.lines[removedIdx].type === 'removed') {
    return `${hunk.lines[removedIdx].oldLineNum}:${hunk.lines[addedIdx].newLineNum}`
  }
  return null
}

// ─── Side-by-Side Diff View ─────────────────────────────────────────────────

function SideBySideDiffView({
  hunks,
  language,
  leftPaneRef,
  rightPaneRef,
  onScrollSync
}: {
  hunks: DiffHunk[]
  language: string | null
  leftPaneRef: React.RefObject<HTMLDivElement | null>
  rightPaneRef: React.RefObject<HTMLDivElement | null>
  onScrollSync: (source: 'left' | 'right') => void
}): React.JSX.Element {
  const { pairs, hunkHeaders } = useMemo(() => pairLinesForSideBySide(hunks), [hunks])

  // Word diff cache for paired lines
  const wordDiffCache = useMemo(() => {
    const cache = new Map<string, { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] }>()
    for (const pair of pairs) {
      if (pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added') {
        const key = `${pair.left.oldLineNum}:${pair.right.newLineNum}`
        cache.set(key, computeWordDiff(pair.left.content, pair.right.content))
      }
    }
    return cache
  }, [pairs])

  // Track hunk header positions for display
  const hunkHeaderSet = useMemo(() => new Set(hunkHeaders.map((h) => h.index)), [hunkHeaders])
  const hunkHeaderMap = useMemo(() => {
    const map = new Map<number, { header: string; suffix: string }>()
    for (const h of hunkHeaders) map.set(h.index, { header: h.header, suffix: h.suffix })
    return map
  }, [hunkHeaders])

  return (
    <div className={styles.sbsView}>
      {/* Left pane (old) */}
      <div
        className={`${styles.sbsPane} ${styles.sbsLeft}`}
        ref={leftPaneRef}
        onScroll={() => onScrollSync('left')}
      >
        <div className={styles.sbsPaneHeader}>Old</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className={styles.sbsHunkHeader}>
                  <span>{hh.header}</span>
                </div>
              )}
              <div className={`${styles.sbsLine} ${pair.left ? (sbsLineTypeClass[pair.left.type] || '') : styles.sbsLineEmpty}`}>
                <span className={styles.sbsLineNum}>
                  {pair.left?.oldLineNum ?? pair.left?.newLineNum ?? ''}
                </span>
                <span className={styles.sbsLineContent}>
                  {pair.left ? (
                    wordDiff ? (
                      <WordDiffContent segments={wordDiff.oldSegments} lineType="removed" />
                    ) : (
                      <SyntaxHighlightedContent text={pair.left.content} language={language} />
                    )
                  ) : ''}
                </span>
              </div>
            </React.Fragment>
          )
        })}
      </div>

      {/* Right pane (new) */}
      <div
        className={`${styles.sbsPane}`}
        ref={rightPaneRef}
        onScroll={() => onScrollSync('right')}
      >
        <div className={styles.sbsPaneHeader}>New</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className={styles.sbsHunkHeader}>
                  <span>{hh.header}</span>
                </div>
              )}
              <div className={`${styles.sbsLine} ${pair.right ? (sbsLineTypeClass[pair.right.type] || '') : styles.sbsLineEmpty}`}>
                <span className={styles.sbsLineNum}>
                  {pair.right?.newLineNum ?? pair.right?.oldLineNum ?? ''}
                </span>
                <span className={styles.sbsLineContent}>
                  {pair.right ? (
                    wordDiff ? (
                      <WordDiffContent segments={wordDiff.newSegments} lineType="added" />
                    ) : (
                      <SyntaxHighlightedContent text={pair.right.content} language={language} />
                    )
                  ) : ''}
                </span>
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function WordDiffContent({ segments, lineType }: { segments: WordDiffSegment[]; lineType: string }): React.JSX.Element {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'common') {
          return <span key={i}>{seg.text}</span>
        }
        const cls = lineType === 'removed'
          ? styles.wordRemoved
          : styles.wordAdded
        return (
          <span key={i} className={cls}>
            {seg.text}
          </span>
        )
      })}
    </>
  )
}

function SyntaxHighlightedContent({ text, language }: { text: string; language: string | null }): React.JSX.Element {
  const tokens = useMemo(() => highlightLine(text, language), [text, language])
  return (
    <>
      {tokens.map((token, i) =>
        token.className ? (
          <span key={i} className={token.className}>{token.text}</span>
        ) : (
          <span key={i}>{token.text}</span>
        )
      )}
    </>
  )
}
