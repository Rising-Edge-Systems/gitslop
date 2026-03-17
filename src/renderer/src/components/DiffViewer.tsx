import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Package } from 'lucide-react'

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

const LARGE_FILE_LINE_LIMIT = 5000
const INITIAL_DISPLAY_LIMIT = 2000

// ─── Component Props ────────────────────────────────────────────────────────

export interface DiffViewerProps {
  diffContent: string
  filePath: string
  /** If not specified, defaults to 'inline' */
  initialMode?: DiffViewMode
  /** Callback for hunk staging (from StatusPanel integration) */
  onStageHunk?: (hunkIdx: number) => void
  onUnstageHunk?: (hunkIdx: number) => void
  staged?: boolean
  isUntracked?: boolean
  className?: string
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function DiffViewer({
  diffContent,
  filePath,
  initialMode = 'inline',
  className = ''
}: DiffViewerProps): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialMode)
  const [displayLimit, setDisplayLimit] = useState(INITIAL_DISPLAY_LIMIT)
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

  // Reset display limit on new diff
  useEffect(() => {
    setDisplayLimit(INITIAL_DISPLAY_LIMIT)
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

  if (parsed.fileHeader.isBinary) {
    return (
      <div className={`diff-viewer ${className}`}>
        <div className="diff-viewer-toolbar">
          <span className="diff-viewer-filename">{filePath}</span>
        </div>
        <div className="diff-viewer-binary">
          <span className="diff-viewer-binary-icon"><Package size={18} /></span>
          <span>Binary file changed</span>
          <span className="diff-viewer-binary-hint">Binary files cannot be displayed in the diff viewer</span>
        </div>
      </div>
    )
  }

  // If no hunks, show raw (e.g. untracked file placeholder text)
  const hasValidHeader = parsed.fileHeader.lines.some((l) => l.startsWith('diff --git'))
  if (parsed.hunks.length === 0 || !hasValidHeader) {
    return (
      <div className={`diff-viewer ${className}`}>
        <div className="diff-viewer-toolbar">
          <span className="diff-viewer-filename">{filePath}</span>
        </div>
        <pre className="diff-viewer-raw">{diffContent}</pre>
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
    <div className={`diff-viewer ${className}`}>
      {/* Toolbar */}
      <div className="diff-viewer-toolbar">
        <span className="diff-viewer-filename">{filePath}</span>
        <div className="diff-viewer-controls">
          <div className="diff-viewer-mode-toggle">
            <button
              className={`diff-mode-btn ${mode === 'inline' ? 'active' : ''}`}
              onClick={() => setMode('inline')}
              title="Inline (unified) diff"
            >
              Inline
            </button>
            <button
              className={`diff-mode-btn ${mode === 'side-by-side' ? 'active' : ''}`}
              onClick={() => setMode('side-by-side')}
              title="Side-by-side diff"
            >
              Side-by-Side
            </button>
          </div>
        </div>
      </div>

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
        <div className="diff-viewer-truncated">
          <span className="diff-viewer-truncated-info">
            Showing {displayLimit.toLocaleString()} of {totalLines.toLocaleString()} lines
          </span>
          <button
            className="diff-viewer-show-more"
            onClick={() => setDisplayLimit((prev) => Math.min(prev + 2000, totalLines))}
          >
            Show More ({Math.min(2000, totalLines - displayLimit).toLocaleString()} lines)
          </button>
          <button
            className="diff-viewer-show-all"
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
    <div className="diff-inline-view">
      {hunks.map((hunk, hunkIdx) => (
        <div key={hunkIdx} className="diff-hunk">
          <div className="diff-hunk-header">
            <span className="diff-hunk-header-text">{hunk.header}</span>
            {hunk.headerSuffix && (
              <span className="diff-hunk-header-suffix">{hunk.headerSuffix}</span>
            )}
          </div>
          {hunk.lines.map((line, lineIdx) => {
            if (line.content.startsWith('\\')) {
              return (
                <div key={lineIdx} className="diff-line diff-line-meta">
                  <span className="diff-line-num diff-line-num-old" />
                  <span className="diff-line-num diff-line-num-new" />
                  <span className="diff-line-prefix" />
                  <span className="diff-line-content">{line.content}</span>
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
              <div key={lineIdx} className={`diff-line diff-line-${line.type}`}>
                <span className="diff-line-num diff-line-num-old">
                  {line.oldLineNum ?? ''}
                </span>
                <span className="diff-line-num diff-line-num-new">
                  {line.newLineNum ?? ''}
                </span>
                <span className="diff-line-prefix">{prefix}</span>
                <span className="diff-line-content">
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
    <div className="diff-sbs-view">
      {/* Left pane (old) */}
      <div
        className="diff-sbs-pane diff-sbs-left"
        ref={leftPaneRef}
        onScroll={() => onScrollSync('left')}
      >
        <div className="diff-sbs-pane-header">Old</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className="diff-sbs-hunk-header">
                  <span>{hh.header}</span>
                </div>
              )}
              <div className={`diff-sbs-line ${pair.left ? `diff-sbs-line-${pair.left.type}` : 'diff-sbs-line-empty'}`}>
                <span className="diff-sbs-line-num">
                  {pair.left?.oldLineNum ?? pair.left?.newLineNum ?? ''}
                </span>
                <span className="diff-sbs-line-content">
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
        className="diff-sbs-pane diff-sbs-right"
        ref={rightPaneRef}
        onScroll={() => onScrollSync('right')}
      >
        <div className="diff-sbs-pane-header">New</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className="diff-sbs-hunk-header">
                  <span>{hh.header}</span>
                </div>
              )}
              <div className={`diff-sbs-line ${pair.right ? `diff-sbs-line-${pair.right.type}` : 'diff-sbs-line-empty'}`}>
                <span className="diff-sbs-line-num">
                  {pair.right?.newLineNum ?? pair.right?.oldLineNum ?? ''}
                </span>
                <span className="diff-sbs-line-content">
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
          ? 'diff-word-removed'
          : 'diff-word-added'
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
