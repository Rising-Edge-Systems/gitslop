import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Package, ChevronLeft, ChevronRight } from 'lucide-react'
import styles from './DiffViewer.module.css'

// ─── Types ──────────────────────────────────────────────────────────────────

export type DiffViewMode = 'inline' | 'side-by-side' | 'full' | 'file'

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
      // Starting char (e.g. '@' decorator) may not match the inner identifier
      // regex, leaving word empty. Treat as a standalone symbol and advance.
      if (word.length === 0) {
        tokens.push({ text: text[i], className: '' })
        i++
        continue
      }
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

// ─── Patch builders (for hunk staging) ─────────────────────────────────────

/**
 * Build a minimal git patch containing a single hunk — suitable for
 * `git apply --cached` / `git apply --reverse --cached` / `git apply --reverse`.
 */
function buildHunkPatch(fileHeader: FileHeader, hunk: DiffHunk): string {
  // Rebuild the hunk lines verbatim from rawContent so trailing-newline markers
  // ("\ No newline at end of file") are preserved.
  const hunkBody = hunk.lines.map((l) => l.rawContent).join('\n')
  const headerStr = fileHeader.lines.join('\n')
  return headerStr + '\n' + hunk.header + '\n' + hunkBody + '\n'
}

/**
 * Build a git patch containing only the selected lines within a hunk.
 * Unselected added lines are omitted; unselected removed lines are converted
 * to context lines. The hunk header counts are recomputed to match.
 *
 * Used for line-level staging / unstaging. Returns '' if no lines remain.
 */
function buildLinesPatch(
  fileHeader: FileHeader,
  hunk: DiffHunk,
  selectedLineIndices: Set<number>
): string {
  const newHunkLines: string[] = []
  let oldCount = 0
  let newCount = 0

  const headerMatch = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
  const oldStart = headerMatch ? parseInt(headerMatch[1], 10) : 1
  const newStart = headerMatch ? parseInt(headerMatch[2], 10) : 1
  const headerSuffix = headerMatch ? headerMatch[3] : ''

  // Track whether the patch contains any actual +/- lines — an all-context
  // patch is meaningless and would be rejected by git apply.
  let hasChange = false

  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]
    const isSelected = selectedLineIndices.has(i)

    // "\ No newline at end of file" marker — always preserve
    if (line.content.startsWith('\\')) {
      newHunkLines.push(line.rawContent)
      continue
    }

    if (line.type === 'context') {
      newHunkLines.push(line.rawContent)
      oldCount++
      newCount++
    } else if (line.type === 'added') {
      if (isSelected) {
        newHunkLines.push(line.rawContent)
        newCount++
        hasChange = true
      }
      // Unselected added lines are dropped (they won't exist in the target)
    } else if (line.type === 'removed') {
      if (isSelected) {
        newHunkLines.push(line.rawContent)
        oldCount++
        hasChange = true
      } else {
        // Convert to context — keep the line in both old and new
        newHunkLines.push(' ' + line.content)
        oldCount++
        newCount++
      }
    }
  }

  if (!hasChange || newHunkLines.length === 0) return ''

  const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${headerSuffix}`
  const headerStr = fileHeader.lines.join('\n')
  return headerStr + '\n' + newHeader + '\n' + newHunkLines.join('\n') + '\n'
}

// ─── Side-by-side pairing ───────────────────────────────────────────────────

/**
 * Parallel metadata for SideBySidePair[] — tells which hunk each pair belongs
 * to and (for line-level staging) which line index within that hunk each side
 * of the pair corresponds to.
 */
interface SideBySidePairMeta {
  hunkIdx: number
  leftLineIdx: number | null
  rightLineIdx: number | null
}

function pairLinesForSideBySide(hunks: DiffHunk[]): {
  pairs: SideBySidePair[]
  pairMeta: SideBySidePairMeta[]
  hunkHeaders: { index: number; header: string; suffix: string }[]
} {
  const pairs: SideBySidePair[] = []
  const pairMeta: SideBySidePairMeta[] = []
  const hunkHeaders: { index: number; header: string; suffix: string }[] = []

  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    const hunk = hunks[hunkIdx]
    hunkHeaders.push({ index: pairs.length, header: hunk.header, suffix: hunk.headerSuffix })

    let i = 0
    while (i < hunk.lines.length) {
      const line = hunk.lines[i]

      if (line.type === 'context') {
        pairs.push({ left: line, right: line })
        pairMeta.push({ hunkIdx, leftLineIdx: i, rightLineIdx: i })
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
          pairMeta.push({
            hunkIdx,
            leftLineIdx: k < removedLines.length ? removedStart + k : null,
            rightLineIdx: k < addedLines.length ? addedStart + k : null
          })
        }
      } else if (line.type === 'added') {
        pairs.push({ left: null, right: line })
        pairMeta.push({ hunkIdx, leftLineIdx: null, rightLineIdx: i })
        i++
      } else {
        i++
      }
    }
  }

  return { pairs, pairMeta, hunkHeaders }
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
  /**
   * Hunk staging callbacks. Each receives a ready-to-apply git patch string
   * built by DiffViewer itself (caller just forwards to `git.stageHunk` / etc).
   * Presence of these callbacks is what drives the Stage/Unstage/Discard buttons
   * to appear in each hunk header.
   */
  onStageHunk?: (patch: string) => void | Promise<void>
  onUnstageHunk?: (patch: string) => void | Promise<void>
  onDiscardHunk?: (patch: string) => void | Promise<void>
  /**
   * Which staging state this diff represents:
   *  - 'unstaged' → show "Stage Hunk" + "Discard Hunk"
   *  - 'staged'   → show "Unstage Hunk"
   *  - 'untracked'/undefined → no hunk actions
   */
  stagingMode?: 'unstaged' | 'staged' | 'untracked'
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
  onNavigateFile,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk,
  stagingMode
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

  // Hunk-level staging actions — only wired when caller supplies callbacks
  // and stagingMode indicates a working-tree diff.
  const hunkActions: HunkActionsConfig | null = useMemo(() => {
    if (!stagingMode || stagingMode === 'untracked') return null
    if (!onStageHunk && !onUnstageHunk && !onDiscardHunk) return null
    return {
      stagingMode,
      fileHeader: parsed.fileHeader,
      onStagePatch: onStageHunk,
      onUnstagePatch: onUnstageHunk,
      onDiscardPatch: onDiscardHunk
    }
  }, [stagingMode, onStageHunk, onUnstageHunk, onDiscardHunk, parsed.fileHeader])

  return (
    <div className={`${styles.diffViewer} ${className}`}>
      {toolbarContent}

      {/* Diff Content */}
      {mode === 'inline' ? (
        <InlineDiffView hunks={displayHunks} language={language} hunkActions={hunkActions} />
      ) : (
        <SideBySideDiffView
          hunks={displayHunks}
          language={language}
          leftPaneRef={leftPaneRef}
          rightPaneRef={rightPaneRef}
          onScrollSync={handleScrollSync}
          hunkActions={hunkActions}
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

// ─── Scrollbar Change Markers ───────────────────────────────────────────────

interface MarkerEntry {
  /** Proportional position (0..1) within the total line count */
  position: number
  /** Height as a proportion of total line count */
  height: number
  type: 'added' | 'removed'
}

/**
 * Compute marker entries from a flat list of line types.
 * Consecutive lines of the same type are merged into a single marker.
 */
function computeMarkers(lineTypes: Array<'added' | 'removed' | 'context' | null>, totalLines: number): MarkerEntry[] {
  if (totalLines === 0) return []
  const markers: MarkerEntry[] = []
  let i = 0
  while (i < lineTypes.length) {
    const t = lineTypes[i]
    if (t === 'added' || t === 'removed') {
      const start = i
      while (i < lineTypes.length && lineTypes[i] === t) i++
      const count = i - start
      markers.push({
        position: start / totalLines,
        height: count / totalLines,
        type: t
      })
    } else {
      i++
    }
  }
  return markers
}

function ScrollbarMarkers({
  markers,
  containerRef,
  minMarkerHeight = 2,
  maxMarkerHeight = 20
}: {
  markers: MarkerEntry[]
  containerRef: React.RefObject<HTMLElement | null>
  minMarkerHeight?: number
  maxMarkerHeight?: number
}): React.JSX.Element {
  const columnRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<{ top: number; height: number }>({ top: 0, height: 100 })

  // Update viewport indicator on scroll and resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let rafId: number | null = null

    const updateViewport = (): void => {
      rafId = null
      const el = containerRef.current
      if (!el) return
      const { scrollTop, scrollHeight, clientHeight } = el
      if (scrollHeight <= 0) return
      const topPct = (scrollTop / scrollHeight) * 100
      const heightPct = (clientHeight / scrollHeight) * 100
      setViewport({ top: topPct, height: heightPct })
    }

    const onScroll = (): void => {
      if (rafId == null) {
        rafId = requestAnimationFrame(updateViewport)
      }
    }

    // Initial calculation
    updateViewport()

    container.addEventListener('scroll', onScroll, { passive: true })

    // Also update on resize (content might change size)
    const ro = new ResizeObserver(() => updateViewport())
    ro.observe(container)

    return () => {
      container.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafId != null) cancelAnimationFrame(rafId)
    }
  }, [containerRef])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const col = columnRef.current
      const container = containerRef.current
      if (!col || !container) return
      const rect = col.getBoundingClientRect()
      const ratio = (e.clientY - rect.top) / rect.height
      const target = ratio * (container.scrollHeight - container.clientHeight)
      container.scrollTo({ top: target, behavior: 'smooth' })
    },
    [containerRef]
  )

  return (
    <div
      ref={columnRef}
      className={styles.scrollbarMarkerColumn}
      onClick={handleClick}
    >
      {/* Viewport indicator — behind markers (lower z-index) */}
      <div
        className={styles.scrollbarViewport}
        style={{
          top: `${viewport.top}%`,
          height: `${viewport.height}%`
        }}
      />
      {markers.map((m, i) => {
        const top = `${m.position * 100}%`
        // Clamp pixel height between min and max
        const heightPercent = m.height * 100
        const cls = m.type === 'added' ? styles.scrollbarMarkerAdded : styles.scrollbarMarkerRemoved
        return (
          <div
            key={i}
            className={`${styles.scrollbarMarker} ${cls}`}
            style={{
              top,
              height: `clamp(${minMarkerHeight}px, ${heightPercent}%, ${maxMarkerHeight}px)`
            }}
          />
        )
      })}
    </div>
  )
}

// ─── Shared line-selection hook (used by inline / split / full views) ─────

interface LineSelectionApi {
  selection: Map<number, Set<number>>
  getHunkSelection: (hunkIdx: number) => Set<number> | undefined
  toggle: (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void
  clearHunk: (hunkIdx: number) => void
  clearAll: () => void
}

function useLineSelection(resetKey: unknown, getHunk: (hunkIdx: number) => DiffHunk | undefined): LineSelectionApi {
  const [selection, setSelection] = useState<Map<number, Set<number>>>(new Map())
  const lastClickedRef = useRef<{ hunkIdx: number; lineIdx: number } | null>(null)

  useEffect(() => {
    setSelection(new Map())
    lastClickedRef.current = null
  }, [resetKey])

  const toggle = useCallback(
    (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => {
      setSelection((prev) => {
        const next = new Map(prev)
        const current = new Set(next.get(hunkIdx) ?? [])

        if (e.shiftKey && lastClickedRef.current && lastClickedRef.current.hunkIdx === hunkIdx) {
          const start = Math.min(lastClickedRef.current.lineIdx, lineIdx)
          const end = Math.max(lastClickedRef.current.lineIdx, lineIdx)
          const hunk = getHunk(hunkIdx)
          if (hunk) {
            for (let i = start; i <= end; i++) {
              const line = hunk.lines[i]
              if (line && line.type !== 'context' && !line.content.startsWith('\\')) {
                current.add(i)
              }
            }
          }
        } else {
          if (current.has(lineIdx)) current.delete(lineIdx)
          else current.add(lineIdx)
        }

        if (current.size === 0) next.delete(hunkIdx)
        else next.set(hunkIdx, current)
        lastClickedRef.current = { hunkIdx, lineIdx }
        return next
      })
    },
    [getHunk]
  )

  const clearHunk = useCallback((hunkIdx: number) => {
    setSelection((prev) => {
      if (!prev.has(hunkIdx)) return prev
      const next = new Map(prev)
      next.delete(hunkIdx)
      return next
    })
  }, [])

  const clearAll = useCallback(() => {
    setSelection(new Map())
    lastClickedRef.current = null
  }, [])

  const getHunkSelection = useCallback((hunkIdx: number) => selection.get(hunkIdx), [selection])

  return { selection, getHunkSelection, toggle, clearHunk, clearAll }
}

// ─── Hunk Actions (stage / unstage / discard) ──────────────────────────────

interface HunkActionsConfig {
  stagingMode: 'unstaged' | 'staged' | 'untracked'
  fileHeader: FileHeader
  onStagePatch?: (patch: string) => void | Promise<void>
  onUnstagePatch?: (patch: string) => void | Promise<void>
  onDiscardPatch?: (patch: string) => void | Promise<void>
}

/**
 * Renders the Stage/Unstage/Discard button group for a single hunk.
 *
 * `variant === 'floating'` wraps the buttons in a sticky bar so they hover
 * over the top-right of the hunk block and remain visible during horizontal
 * scroll — used in the inline view where each hunk has its own container.
 *
 * `variant === 'inline'` emits just the bare button group without the
 * floating chrome — used in the split view where the buttons sit inside the
 * sticky hunk header.
 */
function HunkActions({
  hunk,
  actions,
  variant,
  selectedLines,
  onClearSelection
}: {
  hunk: DiffHunk
  actions: HunkActionsConfig | null
  variant: 'floating' | 'inline'
  /** Set of line indices selected within this hunk (for line-level staging) */
  selectedLines?: Set<number>
  /** Called after a staging action completes so the parent can clear selection */
  onClearSelection?: () => void
}): React.JSX.Element | null {
  if (!actions) return null
  const { stagingMode, fileHeader, onStagePatch, onUnstagePatch, onDiscardPatch } = actions
  if (stagingMode === 'untracked') return null

  const selectionCount = selectedLines?.size ?? 0
  const hasSelection = selectionCount > 0

  const runAction = async (kind: 'stage' | 'unstage' | 'discard'): Promise<void> => {
    const patch = hasSelection
      ? buildLinesPatch(fileHeader, hunk, selectedLines!)
      : buildHunkPatch(fileHeader, hunk)
    if (!patch) return
    if (kind === 'stage') await onStagePatch?.(patch)
    else if (kind === 'unstage') await onUnstagePatch?.(patch)
    else await onDiscardPatch?.(patch)
    onClearSelection?.()
  }

  const buttons = (
    <>
      {stagingMode === 'unstaged' && onStagePatch && (
        <button
          className={`${styles.hunkActionBtn} ${styles.hunkActionStage}`}
          onClick={(e) => { e.stopPropagation(); void runAction('stage') }}
          title={hasSelection ? `Stage ${selectionCount} selected line(s)` : 'Stage this hunk'}
        >
          + {hasSelection ? `Stage ${selectionCount} Line${selectionCount > 1 ? 's' : ''}` : 'Stage Hunk'}
        </button>
      )}
      {stagingMode === 'unstaged' && onDiscardPatch && (
        <button
          className={`${styles.hunkActionBtn} ${styles.hunkActionDiscard}`}
          onClick={(e) => {
            e.stopPropagation()
            const msg = hasSelection
              ? `Discard ${selectionCount} selected line(s)?\n\nThis action is irreversible — the changes will be permanently lost.`
              : 'Discard this hunk?\n\nThis action is irreversible — the changes will be permanently lost.'
            if (window.confirm(msg)) {
              void runAction('discard')
            }
          }}
          title={hasSelection ? `Discard ${selectionCount} selected line(s)` : 'Discard this hunk (irreversible)'}
        >
          Discard
        </button>
      )}
      {stagingMode === 'staged' && onUnstagePatch && (
        <button
          className={`${styles.hunkActionBtn} ${styles.hunkActionUnstage}`}
          onClick={(e) => { e.stopPropagation(); void runAction('unstage') }}
          title={hasSelection ? `Unstage ${selectionCount} selected line(s)` : 'Unstage this hunk'}
        >
          − {hasSelection ? `Unstage ${selectionCount} Line${selectionCount > 1 ? 's' : ''}` : 'Unstage Hunk'}
        </button>
      )}
    </>
  )

  if (variant === 'floating') {
    return (
      <div className={`${styles.hunkFloatingBar} ${hasSelection ? styles.hunkFloatingBarPinned : ''}`}>
        <div className={styles.hunkFloatingInner}>{buttons}</div>
      </div>
    )
  }
  return <div className={styles.hunkInlineActions}>{buttons}</div>
}

// ─── Inline Diff View ───────────────────────────────────────────────────────

function InlineDiffView({
  hunks,
  language,
  hunkActions
}: {
  hunks: DiffHunk[]
  language: string | null
  hunkActions: HunkActionsConfig | null
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Per-hunk line selection (Map<hunkIdx, Set<lineIdx>>) — used for
  // line-level staging. Only populated when `hunkActions` is set.
  const getHunk = useCallback((hunkIdx: number) => hunks[hunkIdx], [hunks])
  const lineSel = useLineSelection(hunks, getHunk)
  const { getHunkSelection, toggle: toggleLineSelection, clearHunk: clearHunkSelection } = lineSel
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

  // Compute scrollbar change markers
  const inlineMarkers = useMemo(() => {
    const lineTypes: Array<'added' | 'removed' | 'context' | null> = []
    for (const hunk of hunks) {
      // Account for hunk header line
      lineTypes.push(null)
      for (const line of hunk.lines) {
        lineTypes.push(line.type === 'added' || line.type === 'removed' ? line.type : 'context')
      }
    }
    return computeMarkers(lineTypes, lineTypes.length)
  }, [hunks])

  return (
    <div className={styles.diffWithMarkers}>
    <div className={styles.scrollableWithMarkers} ref={scrollRef}>
      <div className={styles.inlineViewInner}>
      {hunks.map((hunk, hunkIdx) => {
        const hunkSelection = getHunkSelection(hunkIdx)
        return (
        <div key={hunkIdx} className={styles.hunk}>
          <HunkActions
            hunk={hunk}
            actions={hunkActions}
            variant="floating"
            selectedLines={hunkSelection}
            onClearSelection={() => clearHunkSelection(hunkIdx)}
          />
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
                  {hunkActions && <span className={styles.lineSelect} />}
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
            const isLineSelected = hunkSelection?.has(lineIdx) ?? false
            const canSelectLine = line.type !== 'context' && !!hunkActions

            return (
              <div
                key={lineIdx}
                className={`${styles.line} ${lineTypeClass[line.type] || ''} ${isLineSelected ? styles.lineSelected : ''}`}
              >
                {hunkActions && (
                  canSelectLine ? (
                    <span
                      className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                      onClick={(e) => { e.stopPropagation(); toggleLineSelection(hunkIdx, lineIdx, e) }}
                      title="Click to select line (shift-click for range)"
                    >
                      {isLineSelected ? '●' : '○'}
                    </span>
                  ) : (
                    <span className={styles.lineSelect} />
                  )
                )}
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
        )
      })}
      </div>
    </div>
    <ScrollbarMarkers markers={inlineMarkers} containerRef={scrollRef} />
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
  onScrollSync,
  hunkActions
}: {
  hunks: DiffHunk[]
  language: string | null
  leftPaneRef: React.RefObject<HTMLDivElement | null>
  rightPaneRef: React.RefObject<HTMLDivElement | null>
  onScrollSync: (source: 'left' | 'right') => void
  hunkActions: HunkActionsConfig | null
}): React.JSX.Element {
  const { pairs, pairMeta, hunkHeaders } = useMemo(() => pairLinesForSideBySide(hunks), [hunks])

  // Shared line-selection hook (same UX as inline view)
  const getHunk = useCallback((hunkIdx: number) => hunks[hunkIdx], [hunks])
  const { getHunkSelection, toggle: toggleLineSelection, clearHunk: clearHunkSelection } = useLineSelection(hunks, getHunk)

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
    const map = new Map<number, { header: string; suffix: string; hunk: DiffHunk; hunkIdx: number }>()
    for (let i = 0; i < hunkHeaders.length; i++) {
      const h = hunkHeaders[i]
      map.set(h.index, { header: h.header, suffix: h.suffix, hunk: hunks[i], hunkIdx: i })
    }
    return map
  }, [hunkHeaders, hunks])

  // Compute scrollbar markers for each pane from paired lines
  const sbsMarkers = useMemo(() => {
    const leftTypes: Array<'added' | 'removed' | 'context' | null> = []
    const rightTypes: Array<'added' | 'removed' | 'context' | null> = []
    for (const pair of pairs) {
      // Left pane: only show removed markers (context lines are neutral)
      if (pair.left) {
        leftTypes.push(pair.left.type === 'removed' ? 'removed' : 'context')
      } else {
        leftTypes.push(null)
      }
      // Right pane: only show added markers
      if (pair.right) {
        rightTypes.push(pair.right.type === 'added' ? 'added' : 'context')
      } else {
        rightTypes.push(null)
      }
    }
    return {
      left: computeMarkers(leftTypes, pairs.length),
      right: computeMarkers(rightTypes, pairs.length)
    }
  }, [pairs])

  return (
    <div className={styles.sbsView}>
      {/* Left pane (old) */}
      <div className={styles.diffWithMarkers}>
      <div
        className={`${styles.sbsPane} ${styles.sbsLeft}`}
        ref={leftPaneRef}
        onScroll={() => onScrollSync('left')}
      >
        <div className={styles.sbsPaneInner}>
        <div className={styles.sbsPaneHeader}>Old</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const meta = pairMeta[idx]
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          // Line-selection state for the LEFT (removed) side
          const leftSelectable =
            !!hunkActions &&
            pair.left !== null &&
            meta.leftLineIdx !== null &&
            pair.left.type !== 'context' &&
            !pair.left.content.startsWith('\\')
          const leftSelected = leftSelectable
            ? (getHunkSelection(meta.hunkIdx)?.has(meta.leftLineIdx!) ?? false)
            : false

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className={styles.sbsHunkHeader}>
                  <span className={styles.sbsHunkHeaderText}>{hh.header}</span>
                </div>
              )}
              <div
                className={`${styles.sbsLine} ${pair.left ? (sbsLineTypeClass[pair.left.type] || '') : styles.sbsLineEmpty} ${leftSelected ? styles.sbsLineSelected : ''}`}
              >
                {hunkActions && (
                  leftSelectable ? (
                    <span
                      className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                      onClick={(e) => { e.stopPropagation(); toggleLineSelection(meta.hunkIdx, meta.leftLineIdx!, e) }}
                      title="Click to select line (shift-click for range)"
                    >
                      {leftSelected ? '●' : '○'}
                    </span>
                  ) : (
                    <span className={styles.lineSelect} />
                  )
                )}
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
      </div>
      <ScrollbarMarkers markers={sbsMarkers.left} containerRef={leftPaneRef} />
      </div>

      {/* Right pane (new) */}
      <div className={styles.diffWithMarkers}>
      <div
        className={`${styles.sbsPane}`}
        ref={rightPaneRef}
        onScroll={() => onScrollSync('right')}
      >
        <div className={styles.sbsPaneInner}>
        <div className={styles.sbsPaneHeader}>New</div>
        {pairs.map((pair, idx) => {
          const hh = hunkHeaderMap.get(idx)
          const meta = pairMeta[idx]
          const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
            ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
            : undefined

          const rightSelectable =
            !!hunkActions &&
            pair.right !== null &&
            meta.rightLineIdx !== null &&
            pair.right.type !== 'context' &&
            !pair.right.content.startsWith('\\')
          const rightSelected = rightSelectable
            ? (getHunkSelection(meta.hunkIdx)?.has(meta.rightLineIdx!) ?? false)
            : false

          return (
            <React.Fragment key={idx}>
              {hh && (
                <div className={styles.sbsHunkHeader}>
                  <span className={styles.sbsHunkHeaderText}>{hh.header}</span>
                  <HunkActions
                    hunk={hh.hunk}
                    actions={hunkActions}
                    variant="inline"
                    selectedLines={getHunkSelection(hh.hunkIdx)}
                    onClearSelection={() => clearHunkSelection(hh.hunkIdx)}
                  />
                </div>
              )}
              <div
                className={`${styles.sbsLine} ${pair.right ? (sbsLineTypeClass[pair.right.type] || '') : styles.sbsLineEmpty} ${rightSelected ? styles.sbsLineSelected : ''}`}
              >
                {hunkActions && (
                  rightSelectable ? (
                    <span
                      className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                      onClick={(e) => { e.stopPropagation(); toggleLineSelection(meta.hunkIdx, meta.rightLineIdx!, e) }}
                      title="Click to select line (shift-click for range)"
                    >
                      {rightSelected ? '●' : '○'}
                    </span>
                  ) : (
                    <span className={styles.lineSelect} />
                  )
                )}
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
      <ScrollbarMarkers markers={sbsMarkers.right} containerRef={rightPaneRef} />
      </div>
    </div>
  )
}

// ─── Full Diff View (complete files side-by-side with highlights) ───────────

interface FullDiffViewProps {
  oldContent: string
  newContent: string
  diffContent: string
  filePath: string
  className?: string
  /** File change status: M, A, D, R, C */
  fileStatus?: string
  /** Original path for renamed files */
  oldPath?: string
  // Hunk staging — same semantics as DiffViewer
  stagingMode?: 'unstaged' | 'staged' | 'untracked'
  onStageHunk?: (patch: string) => void | Promise<void>
  onUnstageHunk?: (patch: string) => void | Promise<void>
  onDiscardHunk?: (patch: string) => void | Promise<void>
}

/**
 * Unified row used by FullDiffView so the left (old) and right (new) panes
 * stay line-for-line aligned. Each row either represents a context line
 * (present on both sides), a removal (left only), an addition (right only),
 * or a paired modification (both sides).
 */
interface FullDiffRow {
  left: { lineNum: number; content: string; type: 'context' | 'removed' } | null
  right: { lineNum: number; content: string; type: 'context' | 'added' } | null
  /** hunk index within parsed.hunks, or null for lines outside any hunk */
  hunkIdx: number | null
  /** Position within hunk.lines for line-level selection (null if context or outside hunk) */
  leftLineIdx: number | null
  rightLineIdx: number | null
}

/**
 * Walk the parsed hunks alongside the full old/new file contents to produce a
 * single row list. Lines outside hunks (unchanged context between hunks) are
 * emitted as 1:1 context pairs. Inside each hunk we interleave removed +
 * added blocks using the same pairing strategy as SideBySideDiffView, so
 * blank slots on either side preserve alignment between the two panes.
 */
function buildFullDiffRows(
  oldLines: string[],
  newLines: string[],
  hunks: DiffHunk[]
): FullDiffRow[] {
  const rows: FullDiffRow[] = []
  let oldIdx = 0 // 0-indexed position in oldLines
  let newIdx = 0 // 0-indexed position in newLines

  const pushContextOutsideHunk = (oldLine: number, newLine: number): void => {
    rows.push({
      left: { lineNum: oldLine + 1, content: oldLines[oldLine] ?? '', type: 'context' },
      right: { lineNum: newLine + 1, content: newLines[newLine] ?? '', type: 'context' },
      hunkIdx: null,
      leftLineIdx: null,
      rightLineIdx: null
    })
  }

  for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
    const hunk = hunks[hunkIdx]
    const m = hunk.header.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (!m) continue
    const hunkOldStart = parseInt(m[1], 10) - 1
    const hunkNewStart = parseInt(m[2], 10) - 1

    // Emit context between previous cursor and this hunk. Both files are
    // identical in this gap, so the number of lines to walk is the same.
    while (oldIdx < hunkOldStart && newIdx < hunkNewStart) {
      pushContextOutsideHunk(oldIdx, newIdx)
      oldIdx++
      newIdx++
    }
    // Ensure both cursors landed at the hunk start. If the parser produced
    // inconsistent counts, don't crash — just snap forward.
    oldIdx = hunkOldStart
    newIdx = hunkNewStart

    // Walk the hunk, interleaving removed/added into paired rows
    let i = 0
    while (i < hunk.lines.length) {
      const line = hunk.lines[i]

      // Skip "\ No newline at end of file" meta — leave as-is on whichever
      // side it belongs to, but don't advance a file cursor.
      if (line.content.startsWith('\\')) { i++; continue }

      if (line.type === 'context') {
        rows.push({
          left: { lineNum: oldIdx + 1, content: oldLines[oldIdx] ?? line.content, type: 'context' },
          right: { lineNum: newIdx + 1, content: newLines[newIdx] ?? line.content, type: 'context' },
          hunkIdx,
          leftLineIdx: i,
          rightLineIdx: i
        })
        oldIdx++
        newIdx++
        i++
      } else {
        // Collect a block of removed lines followed by a block of added lines
        const removedStart = i
        while (i < hunk.lines.length && hunk.lines[i].type === 'removed') i++
        const addedStart = i
        while (i < hunk.lines.length && hunk.lines[i].type === 'added') i++

        const removed = hunk.lines.slice(removedStart, addedStart)
        const added = hunk.lines.slice(addedStart, i)
        const maxLen = Math.max(removed.length, added.length)

        for (let k = 0; k < maxLen; k++) {
          const leftLine = removed[k]
          const rightLine = added[k]
          rows.push({
            left: leftLine
              ? {
                  lineNum: oldIdx + 1,
                  content: oldLines[oldIdx] ?? leftLine.content,
                  type: 'removed'
                }
              : null,
            right: rightLine
              ? {
                  lineNum: newIdx + 1,
                  content: newLines[newIdx] ?? rightLine.content,
                  type: 'added'
                }
              : null,
            hunkIdx,
            leftLineIdx: leftLine ? removedStart + k : null,
            rightLineIdx: rightLine ? addedStart + k : null
          })
          if (leftLine) oldIdx++
          if (rightLine) newIdx++
        }
      }
    }
  }

  // Remaining context after the last hunk
  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    rows.push({
      left: oldIdx < oldLines.length
        ? { lineNum: oldIdx + 1, content: oldLines[oldIdx], type: 'context' }
        : null,
      right: newIdx < newLines.length
        ? { lineNum: newIdx + 1, content: newLines[newIdx], type: 'context' }
        : null,
      hunkIdx: null,
      leftLineIdx: null,
      rightLineIdx: null
    })
    oldIdx++
    newIdx++
  }

  return rows
}

const LARGE_FILE_THRESHOLD = 5000

export function FullDiffView({
  oldContent,
  newContent,
  diffContent,
  filePath,
  className = '',
  fileStatus,
  oldPath,
  stagingMode,
  onStageHunk,
  onUnstageHunk,
  onDiscardHunk
}: FullDiffViewProps): React.JSX.Element {
  const leftPaneRef = useRef<HTMLDivElement>(null)
  const rightPaneRef = useRef<HTMLDivElement>(null)
  const syncingRef = useRef(false)
  const [loadLargeFile, setLoadLargeFile] = useState(false)

  const language = useMemo(() => detectLanguage(filePath), [filePath])
  const parsed = useMemo(() => parseDiff(diffContent), [diffContent])

  // Shared line-selection hook (same UX as inline/split views)
  const getHunk = useCallback((hunkIdx: number) => parsed.hunks[hunkIdx], [parsed.hunks])
  const { getHunkSelection, toggle: toggleLineSelection, clearHunk: clearHunkSelection } =
    useLineSelection(parsed.hunks, getHunk)

  // Build a HunkActionsConfig so we can reuse the shared HunkActions bar
  // instead of per-line gutter buttons. Same shape as inline/split views.
  const hunkActionsConfig: HunkActionsConfig | null = useMemo(() => {
    if (!stagingMode || stagingMode === 'untracked') return null
    if (!onStageHunk && !onUnstageHunk && !onDiscardHunk) return null
    return {
      stagingMode,
      fileHeader: parsed.fileHeader,
      onStagePatch: onStageHunk,
      onUnstagePatch: onUnstageHunk,
      onDiscardPatch: onDiscardHunk
    }
  }, [stagingMode, onStageHunk, onUnstageHunk, onDiscardHunk, parsed.fileHeader])

  // Whether the view should render line-selection checkboxes and hunk bars
  const stagingActive = !!hunkActionsConfig

  const oldLines = useMemo(() => oldContent.split('\n'), [oldContent])
  const newLines = useMemo(() => newContent.split('\n'), [newContent])

  // Remove trailing empty line from split (files typically end with newline)
  const oldDisplay = oldLines.length > 0 && oldLines[oldLines.length - 1] === '' ? oldLines.slice(0, -1) : oldLines
  const newDisplay = newLines.length > 0 && newLines[newLines.length - 1] === '' ? newLines.slice(0, -1) : newLines

  // Unified row list that keeps both panes line-for-line aligned. Each row has
  // a left side, a right side, or both — blank slots preserve alignment after
  // hunks where the two files have different line counts.
  const fullRows = useMemo(
    () => buildFullDiffRows(oldDisplay, newDisplay, parsed.hunks),
    [oldDisplay, newDisplay, parsed.hunks]
  )

  const isNewFile = fileStatus === 'A' || (oldContent === '' && newContent !== '')
  const isDeletedFile = fileStatus === 'D' || (newContent === '' && oldContent !== '')
  const isRenamed = fileStatus?.startsWith('R')
  const isBinaryOld = oldContent.includes('\0')
  const isBinaryNew = newContent.includes('\0')
  const isBinary = isBinaryOld || isBinaryNew
  const isLargeFile = !loadLargeFile && (oldDisplay.length > LARGE_FILE_THRESHOLD || newDisplay.length > LARGE_FILE_THRESHOLD)

  // Compute scrollbar markers for full diff view — aligned to the unified
  // `fullRows` so marker positions match what's actually rendered in each
  // pane (padded blank rows included).
  const fullDiffMarkers = useMemo(() => {
    const leftTypes: Array<'added' | 'removed' | 'context' | null> = []
    const rightTypes: Array<'added' | 'removed' | 'context' | null> = []
    for (const row of fullRows) {
      // Left pane markers: 'removed' on changed-left rows, else context/null
      if (row.left) {
        leftTypes.push(row.left.type === 'removed' ? 'removed' : 'context')
      } else {
        leftTypes.push(null)
      }
      // Right pane markers: 'added' on changed-right rows, else context/null
      if (row.right) {
        rightTypes.push(row.right.type === 'added' ? 'added' : 'context')
      } else {
        rightTypes.push(null)
      }
    }
    return {
      left: computeMarkers(leftTypes, leftTypes.length),
      right: computeMarkers(rightTypes, rightTypes.length)
    }
  }, [fullRows])

  // Derive pane header paths
  const leftPath = isRenamed && oldPath ? oldPath : filePath
  const rightPath = filePath

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

  // Binary file — show placeholder in both panes
  if (isBinary) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        <div className={styles.sbsView}>
          <div className={`${styles.sbsPane} ${styles.sbsLeft}`}>
            <div className={styles.sbsPaneInner}>
              <div className={styles.sbsPaneHeader}>{leftPath}</div>
              <div className={styles.fullDiffPlaceholder}>Binary file — cannot display</div>
            </div>
          </div>
          <div className={styles.sbsPane}>
            <div className={styles.sbsPaneInner}>
              <div className={styles.sbsPaneHeader}>{rightPath}</div>
              <div className={styles.fullDiffPlaceholder}>Binary file — cannot display</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Large file — show placeholder with click-to-load
  if (isLargeFile) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        <div className={styles.sbsView}>
          <div className={`${styles.sbsPane} ${styles.sbsLeft}`}>
            <div className={styles.sbsPaneInner}>
              <div className={styles.sbsPaneHeader}>{leftPath} · {oldDisplay.length} lines</div>
              <div className={styles.fullDiffPlaceholder}>
                <button className={styles.fullDiffLoadBtn} onClick={() => setLoadLargeFile(true)}>
                  Large file — click to load
                </button>
              </div>
            </div>
          </div>
          <div className={styles.sbsPane}>
            <div className={styles.sbsPaneInner}>
              <div className={styles.sbsPaneHeader}>{rightPath} · {newDisplay.length} lines</div>
              <div className={styles.fullDiffPlaceholder}>
                <button className={styles.fullDiffLoadBtn} onClick={() => setLoadLargeFile(true)}>
                  Large file — click to load
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${styles.diffViewer} ${className}`}>
      {/* Renamed file header */}
      {isRenamed && oldPath && (
        <div className={styles.fullDiffRenameHeader}>
          {oldPath} → {filePath}
        </div>
      )}
      <div className={styles.sbsView}>
        {/* Left pane (old file) */}
        <div className={styles.diffWithMarkers}>
        <div
          className={`${styles.sbsPane} ${styles.sbsLeft}`}
          ref={leftPaneRef}
          onScroll={() => handleScrollSync('left')}
        >
          <div className={styles.sbsPaneInner}>
            <div className={styles.sbsPaneHeader}>
              {leftPath} · {isNewFile ? 0 : oldDisplay.length} lines
            </div>
            {isNewFile ? (
              <div className={styles.fullDiffPlaceholder}>New file</div>
            ) : (
              fullRows.map((row, idx) => {
                const prevRow = idx > 0 ? fullRows[idx - 1] : null
                const isHunkStart =
                  stagingActive && row.hunkIdx !== null && (prevRow === null || prevRow.hunkIdx !== row.hunkIdx)
                const side = row.left
                const isChanged = side?.type === 'removed'
                const selectable = stagingActive && isChanged && row.hunkIdx !== null && row.leftLineIdx !== null
                const sel = row.hunkIdx !== null ? getHunkSelection(row.hunkIdx) : undefined
                const isSelected = selectable && sel ? sel.has(row.leftLineIdx!) : false
                return (
                  <React.Fragment key={idx}>
                    {isHunkStart && hunkActionsConfig && (
                      <div className={styles.fullHunkDivider}>
                        <span>{parsed.hunks[row.hunkIdx!].header}</span>
                        <HunkActions
                          hunk={parsed.hunks[row.hunkIdx!]}
                          actions={hunkActionsConfig}
                          variant="inline"
                          selectedLines={getHunkSelection(row.hunkIdx!)}
                          onClearSelection={() => clearHunkSelection(row.hunkIdx!)}
                        />
                      </div>
                    )}
                    <div
                      className={`${styles.sbsLine} ${
                        side
                          ? (isChanged ? styles.sbsLineRemoved : styles.sbsLineContext)
                          : styles.sbsLineEmpty
                      } ${isSelected ? styles.sbsLineSelected : ''}`}
                    >
                      {stagingActive && (
                        selectable ? (
                          <span
                            className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                            onClick={(e) => { e.stopPropagation(); toggleLineSelection(row.hunkIdx!, row.leftLineIdx!, e) }}
                            title="Click to select line (shift-click for range)"
                          >
                            {isSelected ? '●' : '○'}
                          </span>
                        ) : (
                          <span className={styles.lineSelect} />
                        )
                      )}
                      <span className={styles.sbsLineNum}>{side?.lineNum ?? ''}</span>
                      <span className={styles.sbsLineContent}>
                        {side ? <SyntaxHighlightedContent text={side.content} language={language} /> : ''}
                      </span>
                    </div>
                  </React.Fragment>
                )
              })
            )}
          </div>
        </div>
        <ScrollbarMarkers markers={fullDiffMarkers.left} containerRef={leftPaneRef} />
        </div>

        {/* Right pane (new file) */}
        <div className={styles.diffWithMarkers}>
        <div
          className={`${styles.sbsPane}`}
          ref={rightPaneRef}
          onScroll={() => handleScrollSync('right')}
        >
          <div className={styles.sbsPaneInner}>
            <div className={styles.sbsPaneHeader}>
              {rightPath} · {isDeletedFile ? 0 : newDisplay.length} lines
            </div>
            {isDeletedFile ? (
              <div className={styles.fullDiffPlaceholder}>File deleted</div>
            ) : (
              fullRows.map((row, idx) => {
                const prevRow = idx > 0 ? fullRows[idx - 1] : null
                const isHunkStart =
                  stagingActive && row.hunkIdx !== null && (prevRow === null || prevRow.hunkIdx !== row.hunkIdx)
                const side = row.right
                const isChanged = side?.type === 'added'
                const selectable = stagingActive && isChanged && row.hunkIdx !== null && row.rightLineIdx !== null
                const sel = row.hunkIdx !== null ? getHunkSelection(row.hunkIdx) : undefined
                const isSelected = selectable && sel ? sel.has(row.rightLineIdx!) : false
                return (
                  <React.Fragment key={idx}>
                    {isHunkStart && hunkActionsConfig && (
                      <div className={styles.fullHunkDivider}>
                        <span>{parsed.hunks[row.hunkIdx!].header}</span>
                        <HunkActions
                          hunk={parsed.hunks[row.hunkIdx!]}
                          actions={hunkActionsConfig}
                          variant="inline"
                          selectedLines={getHunkSelection(row.hunkIdx!)}
                          onClearSelection={() => clearHunkSelection(row.hunkIdx!)}
                        />
                      </div>
                    )}
                    <div
                      className={`${styles.sbsLine} ${
                        side
                          ? (isChanged ? styles.sbsLineAdded : styles.sbsLineContext)
                          : styles.sbsLineEmpty
                      } ${isSelected ? styles.sbsLineSelected : ''}`}
                    >
                      {stagingActive && (
                        selectable ? (
                          <span
                            className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                            onClick={(e) => { e.stopPropagation(); toggleLineSelection(row.hunkIdx!, row.rightLineIdx!, e) }}
                            title="Click to select line (shift-click for range)"
                          >
                            {isSelected ? '●' : '○'}
                          </span>
                        ) : (
                          <span className={styles.lineSelect} />
                        )
                      )}
                      <span className={styles.sbsLineNum}>{side?.lineNum ?? ''}</span>
                      <span className={styles.sbsLineContent}>
                        {side ? <SyntaxHighlightedContent text={side.content} language={language} /> : ''}
                      </span>
                    </div>
                  </React.Fragment>
                )
              })
            )}
          </div>
        </div>
        <ScrollbarMarkers markers={fullDiffMarkers.right} containerRef={rightPaneRef} />
        </div>
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
