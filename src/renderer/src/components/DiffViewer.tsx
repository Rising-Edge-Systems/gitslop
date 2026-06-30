import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { List, useListCallbackRef } from 'react-window'
import { Package, ChevronLeft, ChevronRight, Pencil } from 'lucide-react'
import styles from './DiffViewer.module.css'
import { renderTextWithWhitespace } from '../utils/whitespaceMarkers'
import { renderWithHighlights, computeFindMarks, computeMatches, mergeColumnMatches, type HighlightRange, type FindMark } from '../utils/textHighlight'
import { FindWidget } from './FindWidget'
import { useFindController } from '../hooks/useFindController'
import { useSelectionHighlight } from '../hooks/useSelectionHighlight'
import { buildEditableTargets } from '../utils/inlineEditNav'
import { useInlineLineEdit, type UseInlineLineEdit } from './useInlineLineEdit'

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

export function detectLanguage(filePath: string): string | null {
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

  // `diff.split('\n')` adds a spurious empty entry when the diff text ends
  // with '\n', which is the common case. Without trimming, the last hunk
  // gets a phantom empty context line that throws off buildLinesPatch's
  // recomputed pre/post counts (buildHunkPatch dodges this because it
  // reuses the original header verbatim).
  for (const h of hunks) {
    while (
      h.lines.length > 0 &&
      h.lines[h.lines.length - 1].type === 'context' &&
      h.lines[h.lines.length - 1].rawContent === ''
    ) {
      h.lines.pop()
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
  selectedLineIndices: Set<number>,
  // Pass `true` when the patch will be applied with --reverse (i.e. unstage
  // or discard). In that mode the patch's POST side must match the live
  // index / working tree, which has the unselected -/+ changes already
  // applied — so we drop those lines instead of converting them to context.
  forApplyReverse = false
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
      } else if (forApplyReverse) {
        // Reverse apply: unselected added lines are present in the live
        // index/worktree, so they must appear as context in both pre and
        // post sides for the patch to match.
        newHunkLines.push(' ' + line.content)
        oldCount++
        newCount++
      }
      // Forward apply (stage): drop unselected added — they're worktree
      // only and we're not bringing them into the index.
    } else if (line.type === 'removed') {
      if (isSelected) {
        newHunkLines.push(line.rawContent)
        oldCount++
        hasChange = true
      } else if (!forApplyReverse) {
        // Forward apply (stage): unselected removed lines are still present
        // in the live state, keep as context.
        newHunkLines.push(' ' + line.content)
        oldCount++
        newCount++
      }
      // Reverse apply (unstage/discard): the line was already removed
      // from the live state, so it's not in pre or post. Drop entirely.
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
  /** Whether the Find widget is open (Ctrl+F). Owned by the parent (RepoView). */
  findOpen?: boolean
  /** Close the Find widget (Esc / close button). */
  onCloseFind?: () => void
  /**
   * When present, enables in-place single-line editing in the inline view
   * (working-tree files only). Absent for commit/index/blame diffs, which
   * stay read-only (no pencil, no input).
   */
  inlineEdit?: { absPath: string; onSaved: () => void }
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
  stagingMode,
  findOpen,
  onCloseFind,
  inlineEdit
}: DiffViewerProps): React.JSX.Element {
  const [mode, setMode] = useState<DiffViewMode>(initialMode)

  const parsed = useMemo(() => parseDiff(diffContent), [diffContent])
  const language = useMemo(() => detectLanguage(filePath), [filePath])

  // Hunk-level staging actions — must be above early returns (React hooks rules)
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

  return (
    <div className={`${styles.diffViewer} ${className}`}>
      {toolbarContent}

      {/* Diff Content */}
      {mode === 'inline' ? (
        <InlineDiffView
          hunks={parsed.hunks}
          language={language}
          hunkActions={hunkActions}
          findOpen={!!findOpen}
          onCloseFind={onCloseFind ?? ((): void => {})}
          inlineEdit={inlineEdit}
        />
      ) : (
        <SideBySideDiffView
          hunks={parsed.hunks}
          language={language}
          hunkActions={hunkActions}
          findOpen={!!findOpen}
          onCloseFind={onCloseFind ?? ((): void => {})}
          inlineEdit={inlineEdit}
        />
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

/** Tracks the scroll container's visible window as {top, height} percentages,
 *  plus a click-to-scroll handler. Shared by the single and dual marker gutters. */
function useScrollbarViewport(
  containerRef: React.RefObject<HTMLElement | null>
): {
  viewport: { top: number; height: number }
  handleClick: (e: React.MouseEvent<HTMLDivElement>) => void
} {
  const [viewport, setViewport] = useState<{ top: number; height: number }>({ top: 0, height: 100 })

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
      setViewport({
        top: (scrollTop / scrollHeight) * 100,
        height: (clientHeight / scrollHeight) * 100
      })
    }

    const onScroll = (): void => {
      if (rafId == null) rafId = requestAnimationFrame(updateViewport)
    }

    updateViewport()
    container.addEventListener('scroll', onScroll, { passive: true })
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
      const container = containerRef.current
      if (!container) return
      const rect = e.currentTarget.getBoundingClientRect()
      const ratio = (e.clientY - rect.top) / rect.height
      const target = ratio * (container.scrollHeight - container.clientHeight)
      container.scrollTo({ top: target, behavior: 'smooth' })
    },
    [containerRef]
  )

  return { viewport, handleClick }
}

/** Render the absolutely-positioned change markers for one column. Height is a
 *  raw proportion of the file (only floored to a min for visibility) — a block
 *  that's half the file fills half the gutter, no upper clamp. */
function renderMarkerBars(markers: MarkerEntry[], minMarkerHeight: number): React.JSX.Element[] {
  return markers.map((m, i) => {
    const cls = m.type === 'added' ? styles.scrollbarMarkerAdded : styles.scrollbarMarkerRemoved
    return (
      <div
        key={i}
        className={`${styles.scrollbarMarker} ${cls}`}
        style={{
          top: `${m.position * 100}%`,
          height: `max(${minMarkerHeight}px, ${m.height * 100}%)`
        }}
      />
    )
  })
}

function ScrollbarMarkers({
  markers,
  containerRef,
  minMarkerHeight = 2,
  findMarks
}: {
  markers: MarkerEntry[]
  containerRef: React.RefObject<HTMLElement | null>
  minMarkerHeight?: number
  findMarks?: FindMark[]
}): React.JSX.Element {
  const { viewport, handleClick } = useScrollbarViewport(containerRef)

  return (
    <div className={styles.scrollbarMarkerColumn} onClick={handleClick}>
      {/* Viewport indicator — behind markers (lower z-index) */}
      <div
        className={styles.scrollbarViewport}
        style={{ top: `${viewport.top}%`, height: `${viewport.height}%` }}
      />
      {renderMarkerBars(markers, minMarkerHeight)}
      {findMarks?.map((m, i) => (
        <div
          key={`f${i}`}
          className={`${styles.scrollbarFindMarker} ${m.current ? styles.scrollbarFindMarkerCurrent : ''}`}
          style={{ top: `${m.position * 100}%` }}
        />
      ))}
    </div>
  )
}

/**
 * Two side-by-side marker gutters for old-left/new-right diffs: the left strip
 * shows the old file's removals (red), the right strip shows the new file's
 * additions (green). A single shared viewport indicator spans both, and the
 * whole strip is click-to-scroll.
 */
function DualScrollbarMarkers({
  leftMarkers,
  rightMarkers,
  containerRef,
  minMarkerHeight = 2,
  findMarks
}: {
  leftMarkers: MarkerEntry[]
  rightMarkers: MarkerEntry[]
  containerRef: React.RefObject<HTMLElement | null>
  minMarkerHeight?: number
  findMarks?: FindMark[]
}): React.JSX.Element {
  const { viewport, handleClick } = useScrollbarViewport(containerRef)

  return (
    <div className={styles.scrollbarDualColumn} onClick={handleClick}>
      {/* Shared viewport indicator — behind markers, spans both strips */}
      <div
        className={styles.scrollbarViewport}
        style={{ top: `${viewport.top}%`, height: `${viewport.height}%` }}
      />
      <div className={styles.scrollbarSubColumn}>
        {renderMarkerBars(leftMarkers, minMarkerHeight)}
      </div>
      <div className={styles.scrollbarSubColumn}>
        {renderMarkerBars(rightMarkers, minMarkerHeight)}
      </div>
      {/* Find ticks span both sub-columns (matches live in either pane). */}
      {findMarks?.map((m, i) => (
        <div
          key={`f${i}`}
          className={`${styles.scrollbarFindMarker} ${m.current ? styles.scrollbarFindMarkerCurrent : ''}`}
          style={{ top: `${m.position * 100}%` }}
        />
      ))}
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

/** Drives a single per-file horizontal scrollbar that's shared by both
 * panes of a side-by-side diff. The scrollbar strip is the source of truth
 * for `--diff-scroll-x`, which every line's translateX consumes via CSS
 * variable inheritance (so no React re-render on scroll). Wheel events on
 * the diff body are forwarded to the strip's scrollLeft. */
function useDiffHorizontalScroll(): {
  containerRef: React.RefObject<HTMLDivElement | null>
  hScrollRef: React.RefObject<HTMLDivElement | null>
  onHScroll: () => void
} {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const hScrollRef = useRef<HTMLDivElement | null>(null)

  const onHScroll = useCallback(() => {
    const x = hScrollRef.current?.scrollLeft ?? 0
    containerRef.current?.style.setProperty('--diff-scroll-x', `${x}px`)
  }, [])

  // Forward wheel deltaX (trackpad horizontal + shift+wheel) from the diff
  // body into the strip's scrollLeft so the user doesn't have to drag the
  // scrollbar manually.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      const strip = hScrollRef.current
      if (!strip) return
      const dx = e.deltaX !== 0 ? e.deltaX : (e.shiftKey ? e.deltaY : 0)
      if (dx === 0) return
      const before = strip.scrollLeft
      const max = strip.scrollWidth - strip.clientWidth
      const next = Math.max(0, Math.min(max, before + dx))
      if (next === before) return
      strip.scrollLeft = next
      e.preventDefault()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return { containerRef, hScrollRef, onHScroll }
}

/** Pixel width to size the scrollbar's inner spacer. Two panes side-by-side,
 * each with line-num/line-select gutters plus the longest line's content. */
function diffContentPixelWidth(maxChars: number): number {
  if (maxChars <= 0) return 0
  const CHAR_PX = 8
  const LINE_SELECT_GUTTER = 18
  const LINE_NUM_GUTTER = 56
  const PANE_PADDING = 32
  const cellWidth = LINE_SELECT_GUTTER + LINE_NUM_GUTTER + maxChars * CHAR_PX + PANE_PADDING
  return cellWidth * 2
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
    const forApplyReverse = kind !== 'stage'
    const patch = hasSelection
      ? buildLinesPatch(fileHeader, hunk, selectedLines!, forApplyReverse)
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

const INLINE_ROW_HEIGHT = 20
const INLINE_HUNK_HEIGHT = 28

/** True when the active edit spans more than one line (anchor ≠ focus). */
function isMultiLine(editing: { anchorLine: number; focusLine: number } | null): boolean {
  return !!editing && editing.anchorLine !== editing.focusLine
}

/**
 * Display-index span for an active multi-line edit. `topIdx`/`botIdx` are the
 * flat-row indices of the new-side lines `lo`/`hi`; the rows between them may
 * include removed rows, so the span is tracked by display index (not file line)
 * to keep the virtualized geometry exact.
 */
interface InlineEditSpan {
  lo: number
  hi: number
  topIdx: number
  botIdx: number
}

/**
 * Shared key handler for the inline-edit `<input>` and `<textarea>`.
 * stopPropagation keeps window-level handlers (close file/diff, close find)
 * from firing mid-edit. Shift+Enter inserts a literal newline (no commit).
 */
function handleInlineEditKeyDown(
  e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
  c: UseInlineLineEdit
): void {
  if (e.key === 'Enter' && e.shiftKey) {
    e.stopPropagation()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopPropagation()
    void c.moveDown()
    return
  }
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    c.cancel()
    return
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    c.extendDown()
    return
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'ArrowUp') {
    e.preventDefault()
    e.stopPropagation()
    c.extendUp()
    return
  }
  const t = e.currentTarget
  if (!e.shiftKey && e.key === 'ArrowUp' && t.selectionStart === 0) {
    e.preventDefault()
    e.stopPropagation()
    void c.moveUp()
  } else if (!e.shiftKey && e.key === 'ArrowDown' && t.selectionStart === t.value.length) {
    e.preventDefault()
    e.stopPropagation()
    void c.moveDown()
  }
}

// Flattened inline row — either a hunk header or a diff line
interface InlineVirtualItem {
  type: 'hunkHeader' | 'line'
  hunkIdx: number
  lineIdx: number // -1 for hunk headers
  line: DiffLine | null
  hunk: DiffHunk
}

interface InlineVirtualRowProps {
  items: InlineVirtualItem[]
  language: string | null
  hunkActions: HunkActionsConfig | null
  wordDiffCache: Map<string, { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] }>
  getHunkSelection: (hunkIdx: number) => Set<number> | undefined
  toggleLineSelection: (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void
  clearHunkSelection: (hunkIdx: number) => void
  rangesByLine: Map<number, HighlightRange[]>
  selByLine: Map<number, HighlightRange[]>
  findOpen: boolean
  /**
   * In-place editing (working-tree inline diff only). Undefined ⇒ read-only
   * (commit/index/blame diffs): no pencil, no input.
   */
  edit?: {
    controller: UseInlineLineEdit
    editableLines: Set<number> // new-side fileLines that may show a pencil
  }
  /**
   * Active multi-line edit span by display index, or null when single-line /
   * not editing. The top-of-span row hosts the textarea; interior rows collapse.
   */
  editSpan?: InlineEditSpan | null
}

function InlineVirtualRow(props: {
  ariaAttributes: Record<string, unknown>
  index: number
  style: React.CSSProperties
} & InlineVirtualRowProps): React.ReactElement {
  const { index, style, items, language, hunkActions, wordDiffCache, getHunkSelection, toggleLineSelection, clearHunkSelection, rangesByLine, selByLine, findOpen, edit, editSpan } = props
  const item = items[index]
  if (!item) return <div style={style} />

  // Interior of a multi-line edit span (below the top-of-span host row): the
  // host's textarea covers these rows and getRowHeight collapses them to 0, so
  // render a bare div WITHOUT the .line class (whose min-height would force 20px).
  if (editSpan && index > editSpan.topIdx && index <= editSpan.botIdx) {
    return <div style={style} />
  }

  if (item.type === 'hunkHeader') {
    const hunkSelection = getHunkSelection(item.hunkIdx)
    return (
      <div style={style} className={styles.hunk}>
        <div className={styles.hunkHeader}>
          <span className={styles.hunkHeaderText}>{item.hunk.header}</span>
          {item.hunk.headerSuffix && (
            <span className={styles.hunkHeaderSuffix}>{item.hunk.headerSuffix}</span>
          )}
          <HunkActions
            hunk={item.hunk}
            actions={hunkActions}
            variant="inline"
            selectedLines={hunkSelection}
            onClearSelection={() => clearHunkSelection(item.hunkIdx)}
          />
        </div>
      </div>
    )
  }

  const { line, hunkIdx, lineIdx, hunk } = item
  if (!line) return <div style={style} />

  if (line.content.startsWith('\\')) {
    return (
      <div style={style} className={`${styles.line} ${styles.lineMeta}`}>
        {hunkActions && <span className={styles.lineSelect} />}
        <span className={styles.lineNum} />
        <span className={styles.lineNum} />
        <span className={styles.linePrefix} />
        <span className={styles.lineContent}>{line.content}</span>
      </div>
    )
  }

  let wordDiffInfo: { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] } | undefined
  if (line.type === 'removed' || line.type === 'added') {
    const pairKey = line.type === 'removed'
      ? findAddedPairKey(hunk, lineIdx)
      : findRemovedPairKey(hunk, lineIdx)
    if (pairKey) wordDiffInfo = wordDiffCache.get(pairKey)
  }

  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '
  const hunkSelection = getHunkSelection(hunkIdx)
  const isLineSelected = hunkSelection?.has(lineIdx) ?? false
  const canSelectLine = line.type !== 'context' && !!hunkActions

  const inlineRanges = findOpen ? (rangesByLine.get(index) ?? []) : (selByLine.get(index) ?? [])

  // In-place editing (working-tree inline diff only). A row is editable when it
  // carries a new-side line number (context + added rows); removed rows and
  // hunk headers never qualify, matching buildEditableTargets. The pencil shows
  // for every editable row; the input replaces the content only on the row that
  // currently has edit focus (so all other rows render byte-identically).
  // Single-line edit: the focus row hosts an <input>. Multi-line edit: the
  // top-of-span row hosts a <textarea> covering the whole span (editSpan).
  const isMultiHost = !!edit && !!editSpan && index === editSpan.topIdx
  const isEditing =
    !!edit && !editSpan && !!edit.controller.editing && line.newLineNum != null &&
    edit.controller.editing.focusLine === line.newLineNum
  const showPencil = !!edit && line.newLineNum != null && edit.editableLines.has(line.newLineNum)

  return (
    <div
      style={style}
      data-find-line={index}
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
      <span className={styles.lineNum}>{line.oldLineNum ?? ''}</span>
      <span className={styles.lineNum}>{line.newLineNum ?? ''}</span>
      <span className={styles.linePrefix}>{prefix}</span>
      <span className={styles.lineContent}>
        {isMultiHost && edit && editSpan ? (
          <textarea
            className={styles.inlineEditTextarea}
            autoFocus
            rows={editSpan.hi - editSpan.lo + 1}
            value={edit.controller.buffer}
            onChange={(e) => edit.controller.setBuffer(e.target.value)}
            onKeyDown={(e) => handleInlineEditKeyDown(e, edit.controller)}
          />
        ) : isEditing && edit ? (
          <input
            className={styles.inlineEditInput}
            autoFocus
            value={edit.controller.buffer}
            onChange={(e) => edit.controller.setBuffer(e.target.value)}
            onKeyDown={(e) => handleInlineEditKeyDown(e, edit.controller)}
          />
        ) : (
          <>
            {wordDiffInfo ? (
              <WordDiffContent
                segments={line.type === 'removed' ? wordDiffInfo.oldSegments : wordDiffInfo.newSegments}
                lineType={line.type}
              />
            ) : (
              <RangeHighlightedContent text={line.content} language={language} ranges={inlineRanges} baseClass={findOpen ? 'findMatch' : 'selectionHighlight'} />
            )}
            {showPencil && edit && (
              <button
                className={styles.editPencil}
                title="Edit this line"
                onClick={() => edit.controller.enter(line.newLineNum as number)}
              >
                <Pencil size={11} />
              </button>
            )}
          </>
        )}
      </span>
    </div>
  )
}

function InlineDiffView({
  hunks,
  language,
  hunkActions,
  findOpen,
  onCloseFind,
  inlineEdit
}: {
  hunks: DiffHunk[]
  language: string | null
  hunkActions: HunkActionsConfig | null
  findOpen: boolean
  onCloseFind: () => void
  inlineEdit?: { absPath: string; onSaved: () => void }
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [listRef, setListRef] = useListCallbackRef()
  const [containerHeight, setContainerHeight] = useState(400)

  const getHunk = useCallback((hunkIdx: number) => hunks[hunkIdx], [hunks])
  const lineSel = useLineSelection(hunks, getHunk)
  const { getHunkSelection, toggle: toggleLineSelection, clearHunk: clearHunkSelection } = lineSel

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

  // Flatten hunks into a flat row array for virtualization
  const items = useMemo(() => {
    const flat: InlineVirtualItem[] = []
    for (let hunkIdx = 0; hunkIdx < hunks.length; hunkIdx++) {
      const hunk = hunks[hunkIdx]
      flat.push({ type: 'hunkHeader', hunkIdx, lineIdx: -1, line: null, hunk })
      for (let lineIdx = 0; lineIdx < hunk.lines.length; lineIdx++) {
        flat.push({ type: 'line', hunkIdx, lineIdx, line: hunk.lines[lineIdx], hunk })
      }
    }
    return flat
  }, [hunks])

  // ─── In-place line editing (working-tree inline diff only) ────────────────
  // Targets are the editable rows (context + added) in DISPLAY order, so arrow
  // navigation crosses hunk boundaries: arrowing past a hunk's last editable
  // row lands on the next hunk's first editable row (nextEditable walks the
  // flat list, not raw file-line numbers). The controller state lives here,
  // above the virtualized List, so it survives row unmount/remount on scroll.
  const editTargets = useMemo(() => buildEditableTargets(items), [items])
  const editLineText = useMemo(() => {
    const m = new Map<number, string>()
    for (const it of items) {
      if (it.type === 'line' && it.line && it.line.type !== 'removed' && it.line.newLineNum != null) {
        m.set(it.line.newLineNum, it.line.content)
      }
    }
    return m
  }, [items])
  const editController = useInlineLineEdit({
    absPath: inlineEdit?.absPath ?? '',
    targets: editTargets,
    lineText: editLineText,
    onSaved: inlineEdit?.onSaved ?? ((): void => {})
  })
  const editForRows = useMemo(
    () =>
      inlineEdit
        ? { controller: editController, editableLines: new Set(editTargets.map((t) => t.fileLine)) }
        : undefined,
    [inlineEdit, editController, editTargets]
  )
  // new-side fileLine -> flat display index (context + added rows carry one).
  const newLineToIndex = useMemo(() => {
    const m = new Map<number, number>()
    items.forEach((it, i) => {
      if (it.type === 'line' && it.line && it.line.newLineNum != null) m.set(it.line.newLineNum, i)
    })
    return m
  }, [items])
  // Display-index span of an active multi-line edit (null when single-line).
  // Spans are file-line-contiguous but may straddle removed rows in the diff,
  // so the visual span is tracked by display index to keep geometry exact.
  const editing = editController.editing
  const editSpan = useMemo<InlineEditSpan | null>(() => {
    if (!inlineEdit || !isMultiLine(editing) || !editing) return null
    const lo = Math.min(editing.anchorLine, editing.focusLine)
    const hi = Math.max(editing.anchorLine, editing.focusLine)
    const topIdx = newLineToIndex.get(lo)
    const botIdx = newLineToIndex.get(hi)
    if (topIdx == null || botIdx == null) return null
    return { lo, hi, topIdx, botIdx }
  }, [inlineEdit, editing, newLineToIndex])

  // ─── Find (Ctrl+F) ────────────────────────────────────────────────────────
  const [findQuery, setFindQuery] = useState('')
  const [findCase, setFindCase] = useState(false)
  const [findWord, setFindWord] = useState(false)
  const findOptsMemo = useMemo(() => ({ caseSensitive: findCase, wholeWord: findWord }), [findCase, findWord])
  const lineModel = useMemo(
    () => items.map((it) => ({ text: it.type === 'line' && it.line ? it.line.content : '' })),
    [items]
  )
  const find = useFindController(lineModel, findOpen ? findQuery : '', findOptsMemo)
  const rangesByLine = useMemo(() => {
    const map = new Map<number, HighlightRange[]>()
    find.matches.forEach((m, i) => {
      const cls = i === find.currentIndex ? 'findMatchCurrent' : 'findMatch'
      const arr = map.get(m.lineIndex) ?? []
      arr.push({ ...m, className: cls })
      map.set(m.lineIndex, arr)
    })
    return map
  }, [find.matches, find.currentIndex])

  // ─── Selection highlight (Part 4) — mutually exclusive with Find ──────────
  // When Find is open it owns the highlight layer; otherwise highlight all
  // occurrences of the current selection (VSCode-style) using `lineModel`.
  const selHl = useSelectionHighlight(lineModel, containerRef, !findOpen)
  const selByLine = useMemo(() => {
    const map = new Map<number, HighlightRange[]>()
    for (const r of selHl) {
      const arr = map.get(r.lineIndex) ?? []
      arr.push({ ...r, className: 'selectionHighlight' })
      map.set(r.lineIndex, arr)
    }
    return map
  }, [selHl])

  // Guard: currentIndex can momentarily exceed matches.length for one render
  // after the match set shrinks (clamp runs in an effect inside the controller).
  const current = find.matches[find.currentIndex]
  useEffect(() => {
    if (findOpen && current && listRef) listRef.scrollToRow({ index: current.lineIndex, align: 'smart', behavior: 'smooth' })
  }, [findOpen, current, listRef])
  const findMarks = useMemo(
    () => computeFindMarks(find.matches.map((m) => m.lineIndex), items.length, find.currentIndex),
    [find.matches, items.length, find.currentIndex]
  )

  const inlineMarkers = useMemo(() => {
    const lineTypes: Array<'added' | 'removed' | 'context' | null> = []
    for (const item of items) {
      if (item.type === 'hunkHeader') {
        lineTypes.push(null)
      } else if (item.line) {
        lineTypes.push(item.line.type === 'added' || item.line.type === 'removed' ? item.line.type : 'context')
      }
    }
    return computeMarkers(lineTypes, lineTypes.length)
  }, [items])

  // Track container height
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setContainerHeight(entry.contentRect.height)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const rowProps: InlineVirtualRowProps = useMemo(() => ({
    items,
    language,
    hunkActions,
    wordDiffCache,
    getHunkSelection,
    toggleLineSelection,
    clearHunkSelection,
    rangesByLine,
    selByLine,
    findOpen,
    edit: editForRows,
    editSpan
  }), [items, language, hunkActions, wordDiffCache, getHunkSelection, toggleLineSelection, clearHunkSelection, rangesByLine, selByLine, findOpen, editForRows, editSpan])

  // Variable row height: hunk headers are taller than data rows so their
  // padding + border fit without overflowing into the line below. During a
  // multi-line edit the top-of-span row grows to host the textarea over the
  // whole span and the interior rows collapse to 0 — so the List geometry stays
  // exact and the textarea is never clipped by a later (lower) row painting over
  // it. The bounds cache re-measures whenever editSpan/rowProps change identity.
  const getRowHeight = useCallback(
    (index: number) => {
      if (items[index]?.type === 'hunkHeader') return INLINE_HUNK_HEIGHT
      if (editSpan) {
        if (index === editSpan.topIdx) return (editSpan.botIdx - editSpan.topIdx + 1) * INLINE_ROW_HEIGHT
        if (index > editSpan.topIdx && index <= editSpan.botIdx) return 0
      }
      return INLINE_ROW_HEIGHT
    },
    [items, editSpan]
  )

  return (
    <div className={styles.diffWithMarkers}>
      {findOpen && (
        <FindWidget
          query={findQuery}
          onQueryChange={setFindQuery}
          caseSensitive={findCase}
          wholeWord={findWord}
          onToggleCase={() => setFindCase((v) => !v)}
          onToggleWholeWord={() => setFindWord((v) => !v)}
          count={find.count}
          currentIndex={find.currentIndex}
          onNext={find.next}
          onPrev={find.prev}
          onClose={onCloseFind}
        />
      )}
      <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>
        <List<InlineVirtualRowProps>
          listRef={setListRef}
          rowComponent={InlineVirtualRow}
          rowCount={items.length}
          rowHeight={getRowHeight}
          rowProps={rowProps}
          overscanCount={15}
          style={{ height: containerHeight }}
        />
      </div>
      <ScrollbarMarkers markers={inlineMarkers} findMarks={findMarks} containerRef={listRef ? { current: (listRef as unknown as { outerElement: HTMLElement }).outerElement } : containerRef} />
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

// ─── Virtual list types for SideBySideDiffView ─────────────────────────────

const SBS_ROW_HEIGHT = 20
const SBS_HUNK_HEIGHT = 28

type VirtualSbsItem =
  | { kind: 'data'; pair: SideBySidePair; meta: SideBySidePairMeta }
  | { kind: 'hunkDivider'; hunkIdx: number; header: string; suffix: string }

interface SbsVirtualRowProps {
  virtualRows: VirtualSbsItem[]
  language: string | null
  hunkActions: HunkActionsConfig | null
  hunks: DiffHunk[]
  wordDiffCache: Map<string, { oldSegments: WordDiffSegment[]; newSegments: WordDiffSegment[] }>
  getHunkSelection: (hunkIdx: number) => Set<number> | undefined
  toggleLineSelection: (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void
  clearHunkSelection: (hunkIdx: number) => void
  leftRangesByLine: Map<number, HighlightRange[]>
  rightRangesByLine: Map<number, HighlightRange[]>
  leftSelByLine: Map<number, HighlightRange[]>
  rightSelByLine: Map<number, HighlightRange[]>
  findOpen: boolean
  /**
   * In-place editing of the RIGHT (new) pane (working-tree split diff only).
   * Undefined ⇒ read-only (commit/historical split): no pencil, no input.
   * The LEFT (old) pane is always read-only.
   */
  edit?: {
    controller: UseInlineLineEdit
    editableLines: Set<number> // new-side fileLines that may show a pencil
  }
  /**
   * Active multi-line edit span by virtual-row index, or null when single-line /
   * not editing. The top-of-span row hosts the textarea; interior rows collapse.
   */
  editSpan?: InlineEditSpan | null
}

function SbsVirtualRow(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & SbsVirtualRowProps): React.ReactElement {
  const {
    index, style, virtualRows, language, hunkActions, hunks,
    wordDiffCache, getHunkSelection, toggleLineSelection, clearHunkSelection,
    leftRangesByLine, rightRangesByLine, leftSelByLine, rightSelByLine, findOpen,
    edit, editSpan
  } = props
  const item = virtualRows[index]

  // Interior of a multi-line edit span (below the top-of-span host row): the
  // host's textarea covers these rows and getRowHeight collapses them to 0, so
  // render a bare div WITHOUT .fullDiffRow/.sbsLine (whose min-heights would
  // otherwise force the rows back open).
  if (editSpan && index > editSpan.topIdx && index <= editSpan.botIdx) {
    return <div style={style} />
  }

  if (item.kind === 'hunkDivider') {
    return (
      <div style={style} className={styles.fullHunkDividerVirtual}>
        <span className={styles.sbsHunkHeaderText}>{item.header}</span>
        {item.suffix && <span className={styles.hunkHeaderSuffix}>{item.suffix}</span>}
        {hunkActions && (
          <HunkActions
            hunk={hunks[item.hunkIdx]}
            actions={hunkActions}
            variant="inline"
            selectedLines={getHunkSelection(item.hunkIdx)}
            onClearSelection={() => clearHunkSelection(item.hunkIdx)}
          />
        )}
      </div>
    )
  }

  const { pair, meta } = item
  const wordDiff = pair.left && pair.right && pair.left.type === 'removed' && pair.right.type === 'added'
    ? wordDiffCache.get(`${pair.left.oldLineNum}:${pair.right.newLineNum}`)
    : undefined
  const leftRanges = findOpen ? (leftRangesByLine.get(index) ?? []) : (leftSelByLine.get(index) ?? [])
  const rightRanges = findOpen ? (rightRangesByLine.get(index) ?? []) : (rightSelByLine.get(index) ?? [])
  const baseClass = findOpen ? 'findMatch' : 'selectionHighlight'

  // Line-selection state for LEFT (removed) side
  const leftSelectable =
    !!hunkActions &&
    pair.left !== null &&
    meta.leftLineIdx !== null &&
    pair.left.type !== 'context' &&
    !pair.left.content.startsWith('\\')
  const leftSelected = leftSelectable
    ? (getHunkSelection(meta.hunkIdx)?.has(meta.leftLineIdx!) ?? false)
    : false

  // Line-selection state for RIGHT (added) side
  const rightSelectable =
    !!hunkActions &&
    pair.right !== null &&
    meta.rightLineIdx !== null &&
    pair.right.type !== 'context' &&
    !pair.right.content.startsWith('\\')
  const rightSelected = rightSelectable
    ? (getHunkSelection(meta.hunkIdx)?.has(meta.rightLineIdx!) ?? false)
    : false

  // ─── Right-pane in-place editing (working-tree split diff only) ───────────
  // The RIGHT cell is editable when it carries a new-side line number (context
  // + added rows; removed lines live on the left and never qualify). The LEFT
  // cell is always read-only. Mirrors buildEditableTargets + InlineVirtualRow:
  // single-line edits host an <input> on the focus row; a multi-line edit hosts
  // a <textarea> on the top-of-span row, with interior rows collapsed above.
  const rightLineNum = pair.right?.newLineNum ?? null
  const isMultiHost = !!edit && !!editSpan && index === editSpan.topIdx
  const isEditing =
    !!edit && !editSpan && !!edit.controller.editing && rightLineNum != null &&
    edit.controller.editing.focusLine === rightLineNum
  const showPencil = !!edit && rightLineNum != null && edit.editableLines.has(rightLineNum)

  return (
    <div style={style} className={styles.fullDiffRow}>
      {/* Left cell (old) */}
      <div className={styles.fullDiffCellLeft}>
        <div
          data-find-line={index * 2}
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
            <span className={styles.sbsLineContentInner}>
              {pair.left ? (
                wordDiff && leftRanges.length === 0 ? (
                  <WordDiffContent segments={wordDiff.oldSegments} lineType="removed" />
                ) : (
                  <RangeHighlightedContent text={pair.left.content} language={language} ranges={leftRanges} baseClass={baseClass} />
                )
              ) : ''}
            </span>
          </span>
        </div>
      </div>

      {/* Right cell (new) */}
      <div className={styles.fullDiffCellRight}>
        <div
          data-find-line={index * 2 + 1}
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
            {isMultiHost && edit && editSpan ? (
              <textarea
                className={styles.inlineEditTextarea}
                autoFocus
                rows={editSpan.hi - editSpan.lo + 1}
                value={edit.controller.buffer}
                onChange={(e) => edit.controller.setBuffer(e.target.value)}
                onKeyDown={(e) => handleInlineEditKeyDown(e, edit.controller)}
              />
            ) : isEditing && edit ? (
              <input
                className={styles.inlineEditInput}
                autoFocus
                value={edit.controller.buffer}
                onChange={(e) => edit.controller.setBuffer(e.target.value)}
                onKeyDown={(e) => handleInlineEditKeyDown(e, edit.controller)}
              />
            ) : (
              <span className={styles.sbsLineContentInner}>
                {pair.right ? (
                  wordDiff && rightRanges.length === 0 ? (
                    <WordDiffContent segments={wordDiff.newSegments} lineType="added" />
                  ) : (
                    <RangeHighlightedContent text={pair.right.content} language={language} ranges={rightRanges} baseClass={baseClass} />
                  )
                ) : ''}
                {showPencil && edit && (
                  <button
                    className={styles.editPencil}
                    title="Edit this line"
                    onClick={() => edit.controller.enter(rightLineNum as number)}
                  >
                    <Pencil size={11} />
                  </button>
                )}
              </span>
            )}
          </span>
        </div>
      </div>
    </div>
  )
}

function SideBySideDiffView({
  hunks,
  language,
  hunkActions,
  findOpen,
  onCloseFind,
  inlineEdit
}: {
  hunks: DiffHunk[]
  language: string | null
  hunkActions: HunkActionsConfig | null
  findOpen: boolean
  onCloseFind: () => void
  inlineEdit?: { absPath: string; onSaved: () => void }
}): React.JSX.Element {
  const [listRef, setListRef] = useListCallbackRef()
  const listWrapperRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)

  // Track the List's outer element for ScrollbarMarkers
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    scrollContainerRef.current = listRef?.element ?? null
  }, [listRef])

  // ResizeObserver to measure available height for the virtual list
  useEffect(() => {
    const el = listWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const { pairs, pairMeta, hunkHeaders } = useMemo(() => pairLinesForSideBySide(hunks), [hunks])

  // Widest line across both panes — drives the scrollbar's inner spacer.
  const maxRowCharWidth = useMemo(() => {
    let max = 0
    for (const p of pairs) {
      if (p.left && p.left.content.length > max) max = p.left.content.length
      if (p.right && p.right.content.length > max) max = p.right.content.length
    }
    return max
  }, [pairs])
  const scrollInnerWidth = diffContentPixelWidth(maxRowCharWidth)

  // Per-file horizontal scroll plumbing (CSS var + wheel forwarding).
  const { containerRef: hScrollContainerRef, hScrollRef, onHScroll } = useDiffHorizontalScroll()

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

  // Build flat virtual-row list, inserting hunk divider items at hunk boundaries
  const virtualRows = useMemo(() => {
    const items: VirtualSbsItem[] = []
    // Build a map from pair index to hunk header info
    const hunkHeaderMap = new Map<number, { header: string; suffix: string; hunkIdx: number }>()
    for (let i = 0; i < hunkHeaders.length; i++) {
      const h = hunkHeaders[i]
      hunkHeaderMap.set(h.index, { header: h.header, suffix: h.suffix, hunkIdx: i })
    }

    for (let idx = 0; idx < pairs.length; idx++) {
      const hh = hunkHeaderMap.get(idx)
      if (hh) {
        items.push({ kind: 'hunkDivider', hunkIdx: hh.hunkIdx, header: hh.header, suffix: hh.suffix })
      }
      items.push({ kind: 'data', pair: pairs[idx], meta: pairMeta[idx] })
    }
    return items
  }, [pairs, pairMeta, hunkHeaders])

  // ─── Right-pane in-place line editing (working-tree split diff only) ───────
  // The new-side (RIGHT) pane is editable; the old-side (LEFT) pane stays
  // read-only. Targets/lineText key on the right-side new-file line number, so
  // they share file-line identity with the inline view's editor — arrow nav
  // crosses hunk boundaries the same way. The controller state lives here, above
  // the virtualized List, so it survives row unmount/remount on scroll.
  const editLineText = useMemo(() => {
    const m = new Map<number, string>()
    for (const h of hunks) {
      for (const l of h.lines) {
        if (l.type !== 'removed' && l.newLineNum != null) m.set(l.newLineNum, l.content)
      }
    }
    return m
  }, [hunks])
  const editTargets = useMemo(
    () =>
      buildEditableTargets(
        hunks.flatMap((h) => [
          { type: 'hunkHeader' as const, line: null },
          ...h.lines.map((l) => ({ type: 'line' as const, line: { type: l.type, newLineNum: l.newLineNum } }))
        ])
      ),
    [hunks]
  )
  const editController = useInlineLineEdit({
    absPath: inlineEdit?.absPath ?? '',
    targets: editTargets,
    lineText: editLineText,
    onSaved: inlineEdit?.onSaved ?? ((): void => {})
  })
  const editForRows = useMemo(
    () =>
      inlineEdit
        ? { controller: editController, editableLines: new Set(editTargets.map((t) => t.fileLine)) }
        : undefined,
    [inlineEdit, editController, editTargets]
  )
  // new-side fileLine -> virtual-row index (only data rows whose right side
  // carries a new-file line number qualify).
  const newLineToRowIndex = useMemo(() => {
    const m = new Map<number, number>()
    virtualRows.forEach((it, i) => {
      if (it.kind === 'data' && it.pair.right && it.pair.right.newLineNum != null) {
        m.set(it.pair.right.newLineNum, i)
      }
    })
    return m
  }, [virtualRows])
  // Virtual-row span of an active multi-line edit (null when single-line). In
  // the split model consecutive new-file lines map to consecutive data rows
  // (removed lines pair onto the same row's left cell), so the span is exact.
  const editing = editController.editing
  const editSpan = useMemo<InlineEditSpan | null>(() => {
    if (!inlineEdit || !isMultiLine(editing) || !editing) return null
    const lo = Math.min(editing.anchorLine, editing.focusLine)
    const hi = Math.max(editing.anchorLine, editing.focusLine)
    const topIdx = newLineToRowIndex.get(lo)
    const botIdx = newLineToRowIndex.get(hi)
    if (topIdx == null || botIdx == null) return null
    return { lo, hi, topIdx, botIdx }
  }, [inlineEdit, editing, newLineToRowIndex])

  // ─── Find (Ctrl+F) ────────────────────────────────────────────────────────
  // Two-column find: search the left (old) and right (new) panes independently,
  // then merge into one document-ordered list so the counter + next/prev cycle
  // across both panes (left before right within a row). Each model is indexed
  // by virtual-row index so a match's lineIndex == its row index.
  const [findQuery, setFindQuery] = useState('')
  const [findCase, setFindCase] = useState(false)
  const [findWord, setFindWord] = useState(false)
  const findOptsMemo = useMemo(() => ({ caseSensitive: findCase, wholeWord: findWord }), [findCase, findWord])
  const leftModel = useMemo(
    () => virtualRows.map((it) => ({ text: it.kind === 'data' ? (it.pair.left?.content ?? '') : '' })),
    [virtualRows]
  )
  const rightModel = useMemo(
    () => virtualRows.map((it) => ({ text: it.kind === 'data' ? (it.pair.right?.content ?? '') : '' })),
    [virtualRows]
  )
  const findActiveQuery = findOpen ? findQuery : ''
  const leftMatches = useMemo(
    () => computeMatches(leftModel, findActiveQuery, findOptsMemo),
    [leftModel, findActiveQuery, findOptsMemo]
  )
  const rightMatches = useMemo(
    () => computeMatches(rightModel, findActiveQuery, findOptsMemo),
    [rightModel, findActiveQuery, findOptsMemo]
  )
  const merged = useMemo(() => mergeColumnMatches(leftMatches, rightMatches), [leftMatches, rightMatches])
  // Drive selection state (currentIndex/next/prev/clamp/reset) with the shared
  // controller. Feed it an interleaved [left,right,left,right,…] model so its
  // match count equals merged.length and its currentIndex indexes `merged`
  // in the same document order.
  const combinedModel = useMemo(() => {
    const m: { text: string }[] = []
    for (let i = 0; i < leftModel.length; i++) {
      m.push(leftModel[i])
      m.push(rightModel[i])
    }
    return m
  }, [leftModel, rightModel])
  const find = useFindController(combinedModel, findActiveQuery, findOptsMemo)
  const { leftRangesByLine, rightRangesByLine } = useMemo(() => {
    const left = new Map<number, HighlightRange[]>()
    const right = new Map<number, HighlightRange[]>()
    merged.forEach((m, i) => {
      const cls = i === find.currentIndex ? 'findMatchCurrent' : 'findMatch'
      const target = m.column === 'left' ? left : right
      const arr = target.get(m.lineIndex) ?? []
      arr.push({ lineIndex: m.lineIndex, start: m.start, end: m.end, className: cls })
      target.set(m.lineIndex, arr)
    })
    return { leftRangesByLine: left, rightRangesByLine: right }
  }, [merged, find.currentIndex])

  // ─── Selection highlight (Part 4) — mutually exclusive with Find ──────────
  // Run over the interleaved `combinedModel` (index 2r = left, 2r+1 = right) so
  // occurrences in either pane are found; decode back to per-pane row maps.
  const selHl = useSelectionHighlight(combinedModel, listWrapperRef, !findOpen)
  const { leftSelByLine, rightSelByLine } = useMemo(() => {
    const left = new Map<number, HighlightRange[]>()
    const right = new Map<number, HighlightRange[]>()
    for (const r of selHl) {
      const row = Math.floor(r.lineIndex / 2)
      const target = r.lineIndex % 2 === 0 ? left : right
      const arr = target.get(row) ?? []
      arr.push({ lineIndex: row, start: r.start, end: r.end, className: 'selectionHighlight' })
      target.set(row, arr)
    }
    return { leftSelByLine: left, rightSelByLine: right }
  }, [selHl])

  // Guard: currentIndex can momentarily exceed merged.length for one render
  // after the match set shrinks (clamp runs in an effect inside the controller).
  const current = merged[find.currentIndex]
  useEffect(() => {
    if (findOpen && current && listRef) listRef.scrollToRow({ index: current.lineIndex, align: 'smart', behavior: 'smooth' })
  }, [findOpen, current, listRef])
  const findMarks = useMemo(
    () => computeFindMarks(merged.map((m) => m.lineIndex), virtualRows.length, find.currentIndex),
    [merged, virtualRows.length, find.currentIndex]
  )

  // Variable row height: hunk dividers are taller than data rows. During a
  // multi-line edit the top-of-span row grows to host the textarea over the
  // whole span and the interior rows collapse to 0 — so the List geometry stays
  // exact and the textarea is never clipped by a later (lower) row painting over
  // it. The bounds cache re-measures whenever editSpan/rowProps change identity.
  const getRowHeight = useCallback(
    (index: number) => {
      const item = virtualRows[index]
      if (item.kind === 'hunkDivider') return SBS_HUNK_HEIGHT
      if (editSpan) {
        if (index === editSpan.topIdx) return (editSpan.botIdx - editSpan.topIdx + 1) * SBS_ROW_HEIGHT
        if (index > editSpan.topIdx && index <= editSpan.botIdx) return 0
      }
      return SBS_ROW_HEIGHT
    },
    [virtualRows, editSpan]
  )

  // Separate left/right scrollbar markers: left gutter tracks the old pane's
  // removals, right gutter tracks the new pane's additions. Both share the
  // pair-index denominator so they line up with the synchronized scroll.
  const leftMarkers = useMemo(
    () => computeMarkers(
      pairs.map((p) => (p.left?.type === 'removed' ? 'removed' : p.left ? 'context' : null)),
      pairs.length
    ),
    [pairs]
  )
  const rightMarkers = useMemo(
    () => computeMarkers(
      pairs.map((p) => (p.right?.type === 'added' ? 'added' : p.right ? 'context' : null)),
      pairs.length
    ),
    [pairs]
  )

  // Props passed to every virtual row
  const rowProps: SbsVirtualRowProps = useMemo(() => ({
    virtualRows,
    language,
    hunkActions,
    hunks,
    wordDiffCache,
    getHunkSelection,
    toggleLineSelection: toggleLineSelection as (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void,
    clearHunkSelection,
    leftRangesByLine,
    rightRangesByLine,
    leftSelByLine,
    rightSelByLine,
    findOpen,
    edit: editForRows,
    editSpan
  }), [
    virtualRows, language, hunkActions, hunks, wordDiffCache,
    getHunkSelection, toggleLineSelection, clearHunkSelection,
    leftRangesByLine, rightRangesByLine, leftSelByLine, rightSelByLine, findOpen,
    editForRows, editSpan
  ])

  return (
    <div className={styles.diffWithMarkers}>
      {findOpen && (
        <FindWidget
          query={findQuery}
          onQueryChange={setFindQuery}
          caseSensitive={findCase}
          wholeWord={findWord}
          onToggleCase={() => setFindCase((v) => !v)}
          onToggleWholeWord={() => setFindWord((v) => !v)}
          count={find.count}
          currentIndex={find.currentIndex}
          onNext={find.next}
          onPrev={find.prev}
          onClose={onCloseFind}
        />
      )}
      <div className={styles.fullDiffVirtualContainer} ref={hScrollContainerRef}>
        {/* Sticky column headers */}
        <div className={styles.fullDiffStickyHeaders}>
          <div className={styles.sbsPaneHeader}>Old</div>
          <div className={styles.sbsPaneHeader}>New</div>
        </div>

        {/* Virtual list fills remaining space */}
        <div ref={listWrapperRef} style={{ flex: 1, minHeight: 0 }}>
          <List<SbsVirtualRowProps>
            listRef={setListRef}
            rowComponent={SbsVirtualRow}
            rowCount={virtualRows.length}
            rowHeight={getRowHeight}
            rowProps={rowProps}
            overscanCount={15}
            style={{ height: containerHeight }}
          />
        </div>

        {/* Single per-file horizontal scrollbar at the bottom. Its
            scrollLeft drives --diff-scroll-x for every line in both panes. */}
        {scrollInnerWidth > 0 && (
          <div
            ref={hScrollRef}
            className={styles.fullDiffHScrollStrip}
            onScroll={onHScroll}
          >
            <div
              className={styles.fullDiffHScrollInner}
              style={{ width: scrollInnerWidth }}
            />
          </div>
        )}
      </div>
      <DualScrollbarMarkers
        leftMarkers={leftMarkers}
        rightMarkers={rightMarkers}
        containerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
        findMarks={findMarks}
      />
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
  /** Whether the Find widget is open (Ctrl+F). Owned by the parent (RepoView). */
  findOpen?: boolean
  /** Close the Find widget (Esc / close button). */
  onCloseFind?: () => void
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
export function buildFullDiffRows(
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
    // Pure-add hunks use `@@ -0,0 +N,M @@` and pure-delete use `@@ -N,M +0,0 @@`.
    // The 0 means "no lines on this side" — subtracting 1 would produce -1 and
    // trip the final cleanup loop into reading oldLines[-1] / newLines[-1].
    const hunkOldStart = Math.max(0, parseInt(m[1], 10) - 1)
    const hunkNewStart = Math.max(0, parseInt(m[2], 10) - 1)

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

// ─── Virtual list types for FullDiffView ──────────────────────────────────

const FULL_DIFF_ROW_HEIGHT = 20
const FULL_DIFF_HUNK_HEIGHT = 28

type VirtualFullDiffItem =
  | { kind: 'data'; row: FullDiffRow }
  | { kind: 'hunkDivider'; hunkIdx: number }

interface FullDiffVirtualRowProps {
  virtualRows: VirtualFullDiffItem[]
  language: string | null
  stagingActive: boolean
  hunkActionsConfig: HunkActionsConfig | null
  parsedHunks: DiffHunk[]
  getHunkSelection: (hunkIdx: number) => Set<number> | undefined
  toggleLineSelection: (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void
  clearHunkSelection: (hunkIdx: number) => void
  isNewFile: boolean
  isDeletedFile: boolean
  leftRangesByLine: Map<number, HighlightRange[]>
  rightRangesByLine: Map<number, HighlightRange[]>
  leftSelByLine: Map<number, HighlightRange[]>
  rightSelByLine: Map<number, HighlightRange[]>
  findOpen: boolean
}

function FullDiffVirtualRow(props: {
  ariaAttributes: { 'aria-posinset': number; 'aria-setsize': number; role: 'listitem' }
  index: number
  style: React.CSSProperties
} & FullDiffVirtualRowProps): React.ReactElement {
  const {
    index, style, virtualRows, language, stagingActive, hunkActionsConfig,
    parsedHunks, getHunkSelection, toggleLineSelection, clearHunkSelection,
    isNewFile, isDeletedFile, leftRangesByLine, rightRangesByLine,
    leftSelByLine, rightSelByLine, findOpen
  } = props
  const item = virtualRows[index]

  if (item.kind === 'hunkDivider') {
    return (
      <div style={style} className={styles.fullHunkDividerVirtual}>
        <span>{parsedHunks[item.hunkIdx].header}</span>
        {hunkActionsConfig && (
          <HunkActions
            hunk={parsedHunks[item.hunkIdx]}
            actions={hunkActionsConfig}
            variant="inline"
            selectedLines={getHunkSelection(item.hunkIdx)}
            onClearSelection={() => clearHunkSelection(item.hunkIdx)}
          />
        )}
      </div>
    )
  }

  const { row } = item

  const renderSide = (
    side: FullDiffRow['left'] | FullDiffRow['right'],
    type: 'left' | 'right'
  ): React.JSX.Element => {
    const isLeft = type === 'left'

    // New file: left side always empty
    if (isNewFile && isLeft) {
      return (
        <div className={styles.fullDiffCellLeft}>
          <div className={`${styles.sbsLine} ${styles.sbsLineEmpty}`}>
            <span className={styles.sbsLineNum} />
            <span className={styles.sbsLineContent} />
          </div>
        </div>
      )
    }
    // Deleted file: right side always empty
    if (isDeletedFile && !isLeft) {
      return (
        <div className={styles.fullDiffCellRight}>
          <div className={`${styles.sbsLine} ${styles.sbsLineEmpty}`}>
            <span className={styles.sbsLineNum} />
            <span className={styles.sbsLineContent} />
          </div>
        </div>
      )
    }

    const isChanged = isLeft ? side?.type === 'removed' : side?.type === 'added'
    const lineIdx = isLeft ? row.leftLineIdx : row.rightLineIdx
    const selectable = stagingActive && isChanged && row.hunkIdx !== null && lineIdx !== null
    const sel = row.hunkIdx !== null ? getHunkSelection(row.hunkIdx) : undefined
    const isSelected = selectable && sel ? sel.has(lineIdx!) : false
    const sideRanges = findOpen
      ? ((isLeft ? leftRangesByLine : rightRangesByLine).get(index) ?? [])
      : ((isLeft ? leftSelByLine : rightSelByLine).get(index) ?? [])

    return (
      <div className={isLeft ? styles.fullDiffCellLeft : styles.fullDiffCellRight}>
        <div
          data-find-line={isLeft ? index * 2 : index * 2 + 1}
          className={`${styles.sbsLine} ${
            side
              ? (isChanged
                  ? (isLeft ? styles.sbsLineRemoved : styles.sbsLineAdded)
                  : styles.sbsLineContext)
              : styles.sbsLineEmpty
          } ${isSelected ? styles.sbsLineSelected : ''}`}
        >
          {stagingActive && (
            selectable ? (
              <span
                className={`${styles.lineSelect} ${styles.lineSelectActive}`}
                onClick={(e) => { e.stopPropagation(); toggleLineSelection(row.hunkIdx!, lineIdx!, e) }}
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
            <span className={styles.sbsLineContentInner}>
              {side ? (
                <RangeHighlightedContent
                  text={side.content}
                  language={language}
                  ranges={sideRanges}
                  baseClass={findOpen ? 'findMatch' : 'selectionHighlight'}
                />
              ) : ''}
            </span>
          </span>
        </div>
      </div>
    )
  }

  return (
    <div style={style} className={styles.fullDiffRow}>
      {renderSide(row.left, 'left')}
      {renderSide(row.right, 'right')}
    </div>
  )
}

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
  onDiscardHunk,
  findOpen = false,
  onCloseFind = (): void => {}
}: FullDiffViewProps): React.JSX.Element {
  const [listRef, setListRef] = useListCallbackRef()
  const listWrapperRef = useRef<HTMLDivElement>(null)
  const [containerHeight, setContainerHeight] = useState(400)

  // Track the List's outer element for ScrollbarMarkers
  const scrollContainerRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    scrollContainerRef.current = listRef?.element ?? null
  }, [listRef])

  // ResizeObserver to measure available height for the virtual list
  useEffect(() => {
    const el = listWrapperRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

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

  // Widest line — drives the per-file horizontal scrollbar's inner spacer.
  const maxRowCharWidth = useMemo(() => {
    let max = 0
    for (const r of fullRows) {
      if (r.left && r.left.content.length > max) max = r.left.content.length
      if (r.right && r.right.content.length > max) max = r.right.content.length
    }
    return max
  }, [fullRows])
  const scrollInnerWidth = diffContentPixelWidth(maxRowCharWidth)

  const { containerRef: hScrollContainerRef, hScrollRef, onHScroll } = useDiffHorizontalScroll()

  const isNewFile = fileStatus === 'A' || (oldContent === '' && newContent !== '')
  const isDeletedFile = fileStatus === 'D' || (newContent === '' && oldContent !== '')
  const isRenamed = fileStatus?.startsWith('R')
  const isBinaryOld = oldContent.includes('\0')
  const isBinaryNew = newContent.includes('\0')
  const isBinary = isBinaryOld || isBinaryNew
  // Derive pane header paths
  const leftPath = isRenamed && oldPath ? oldPath : filePath
  const rightPath = filePath

  // Separate left/right scrollbar markers: the left gutter tracks the old
  // file's removals (red), the right gutter the new file's additions (green).
  // Both use the same row-index denominator so they align with the shared scroll.
  const leftMarkers = useMemo(
    () => computeMarkers(
      fullRows.map((r) => (r.left?.type === 'removed' ? 'removed' : r.left ? 'context' : null)),
      fullRows.length
    ),
    [fullRows]
  )
  const rightMarkers = useMemo(
    () => computeMarkers(
      fullRows.map((r) => (r.right?.type === 'added' ? 'added' : r.right ? 'context' : null)),
      fullRows.length
    ),
    [fullRows]
  )

  // Build flat virtual-row list, inserting hunk divider items at hunk boundaries
  const virtualRows = useMemo(() => {
    const items: VirtualFullDiffItem[] = []
    for (let idx = 0; idx < fullRows.length; idx++) {
      const row = fullRows[idx]
      const prevRow = idx > 0 ? fullRows[idx - 1] : null
      if (stagingActive && row.hunkIdx !== null && (prevRow === null || prevRow.hunkIdx !== row.hunkIdx)) {
        items.push({ kind: 'hunkDivider', hunkIdx: row.hunkIdx })
      }
      items.push({ kind: 'data', row })
    }
    return items
  }, [fullRows, stagingActive])

  // ─── Find (Ctrl+F) ────────────────────────────────────────────────────────
  // Same two-column strategy as SideBySideDiffView: search each pane, merge
  // into one document-ordered list, and drive selection via the shared
  // controller fed an interleaved model. Models are indexed by virtual-row
  // index so a match's lineIndex == its row index.
  const [findQuery, setFindQuery] = useState('')
  const [findCase, setFindCase] = useState(false)
  const [findWord, setFindWord] = useState(false)
  const findOptsMemo = useMemo(() => ({ caseSensitive: findCase, wholeWord: findWord }), [findCase, findWord])
  const leftModel = useMemo(
    () => virtualRows.map((it) => ({ text: it.kind === 'data' ? (it.row.left?.content ?? '') : '' })),
    [virtualRows]
  )
  const rightModel = useMemo(
    () => virtualRows.map((it) => ({ text: it.kind === 'data' ? (it.row.right?.content ?? '') : '' })),
    [virtualRows]
  )
  const findActiveQuery = findOpen ? findQuery : ''
  const leftMatches = useMemo(
    () => computeMatches(leftModel, findActiveQuery, findOptsMemo),
    [leftModel, findActiveQuery, findOptsMemo]
  )
  const rightMatches = useMemo(
    () => computeMatches(rightModel, findActiveQuery, findOptsMemo),
    [rightModel, findActiveQuery, findOptsMemo]
  )
  const merged = useMemo(() => mergeColumnMatches(leftMatches, rightMatches), [leftMatches, rightMatches])
  const combinedModel = useMemo(() => {
    const m: { text: string }[] = []
    for (let i = 0; i < leftModel.length; i++) {
      m.push(leftModel[i])
      m.push(rightModel[i])
    }
    return m
  }, [leftModel, rightModel])
  const find = useFindController(combinedModel, findActiveQuery, findOptsMemo)
  const { leftRangesByLine, rightRangesByLine } = useMemo(() => {
    const left = new Map<number, HighlightRange[]>()
    const right = new Map<number, HighlightRange[]>()
    merged.forEach((m, i) => {
      const cls = i === find.currentIndex ? 'findMatchCurrent' : 'findMatch'
      const target = m.column === 'left' ? left : right
      const arr = target.get(m.lineIndex) ?? []
      arr.push({ lineIndex: m.lineIndex, start: m.start, end: m.end, className: cls })
      target.set(m.lineIndex, arr)
    })
    return { leftRangesByLine: left, rightRangesByLine: right }
  }, [merged, find.currentIndex])

  // ─── Selection highlight (Part 4) — mutually exclusive with Find ──────────
  // Run over the interleaved `combinedModel` (index 2r = left, 2r+1 = right) so
  // occurrences in either pane are found; decode back to per-pane row maps.
  const selHl = useSelectionHighlight(combinedModel, listWrapperRef, !findOpen)
  const { leftSelByLine, rightSelByLine } = useMemo(() => {
    const left = new Map<number, HighlightRange[]>()
    const right = new Map<number, HighlightRange[]>()
    for (const r of selHl) {
      const row = Math.floor(r.lineIndex / 2)
      const target = r.lineIndex % 2 === 0 ? left : right
      const arr = target.get(row) ?? []
      arr.push({ lineIndex: row, start: r.start, end: r.end, className: 'selectionHighlight' })
      target.set(row, arr)
    }
    return { leftSelByLine: left, rightSelByLine: right }
  }, [selHl])

  // Guard: currentIndex can momentarily exceed merged.length for one render
  // after the match set shrinks (clamp runs in an effect inside the controller).
  const current = merged[find.currentIndex]
  useEffect(() => {
    if (findOpen && current && listRef) listRef.scrollToRow({ index: current.lineIndex, align: 'smart', behavior: 'smooth' })
  }, [findOpen, current, listRef])
  const findMarks = useMemo(
    () => computeFindMarks(merged.map((m) => m.lineIndex), virtualRows.length, find.currentIndex),
    [merged, virtualRows.length, find.currentIndex]
  )

  // Variable row height: hunk dividers are taller than data rows
  const getRowHeight = useCallback(
    (index: number) => {
      const item = virtualRows[index]
      return item.kind === 'hunkDivider' ? FULL_DIFF_HUNK_HEIGHT : FULL_DIFF_ROW_HEIGHT
    },
    [virtualRows]
  )

  // Props passed to every virtual row
  const rowProps: FullDiffVirtualRowProps = useMemo(() => ({
    virtualRows,
    language,
    stagingActive,
    hunkActionsConfig,
    parsedHunks: parsed.hunks,
    getHunkSelection,
    toggleLineSelection: toggleLineSelection as (hunkIdx: number, lineIdx: number, e: React.MouseEvent) => void,
    clearHunkSelection,
    isNewFile,
    isDeletedFile,
    leftRangesByLine,
    rightRangesByLine,
    leftSelByLine,
    rightSelByLine,
    findOpen
  }), [
    virtualRows, language, stagingActive, hunkActionsConfig, parsed.hunks,
    getHunkSelection, toggleLineSelection, clearHunkSelection, isNewFile, isDeletedFile,
    leftRangesByLine, rightRangesByLine, leftSelByLine, rightSelByLine, findOpen
  ])

  // Binary file — show placeholder in both panes
  if (isBinary) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        <div className={styles.fullDiffContainer}>
          <div className={styles.fullDiffStickyHeaders}>
            <div className={styles.sbsPaneHeader}>{leftPath}</div>
            <div className={styles.sbsPaneHeader}>{rightPath}</div>
          </div>
          <div className={styles.fullDiffRow}>
            <div className={styles.fullDiffCellLeft}>
              <div className={styles.fullDiffPlaceholder}>Binary file — cannot display</div>
            </div>
            <div className={styles.fullDiffCellRight}>
              <div className={styles.fullDiffPlaceholder}>Binary file — cannot display</div>
            </div>
          </div>
        </div>
      </div>
    )
  }


  // Empty file placeholder — no virtualization needed
  if (isNewFile && isDeletedFile) {
    return (
      <div className={`${styles.diffViewer} ${className}`}>
        <div className={styles.fullDiffContainer}>
          <div className={styles.fullDiffStickyHeaders}>
            <div className={styles.sbsPaneHeader}>{leftPath} · 0 lines</div>
            <div className={styles.sbsPaneHeader}>{rightPath} · 0 lines</div>
          </div>
          <div className={styles.fullDiffPlaceholder}>No content to display</div>
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
      <div className={styles.diffWithMarkers}>
        {findOpen && (
          <FindWidget
            query={findQuery}
            onQueryChange={setFindQuery}
            caseSensitive={findCase}
            wholeWord={findWord}
            onToggleCase={() => setFindCase((v) => !v)}
            onToggleWholeWord={() => setFindWord((v) => !v)}
            count={find.count}
            currentIndex={find.currentIndex}
            onNext={find.next}
            onPrev={find.prev}
            onClose={onCloseFind}
          />
        )}
        <div className={styles.fullDiffVirtualContainer} ref={hScrollContainerRef}>
          {/* Column headers — fixed above the virtual list */}
          <div className={styles.fullDiffStickyHeaders}>
            <div className={styles.sbsPaneHeader}>
              {leftPath} · {isNewFile ? 0 : oldDisplay.length} lines
            </div>
            <div className={styles.sbsPaneHeader}>
              {rightPath} · {isDeletedFile ? 0 : newDisplay.length} lines
            </div>
          </div>

          {/* Virtual list fills remaining space */}
          <div ref={listWrapperRef} style={{ flex: 1, minHeight: 0 }}>
            <List<FullDiffVirtualRowProps>
              listRef={setListRef}
              rowComponent={FullDiffVirtualRow}
              rowCount={virtualRows.length}
              rowHeight={getRowHeight}
              rowProps={rowProps}
              overscanCount={15}
              style={{ height: containerHeight }}
            />
          </div>

          {/* Single per-file horizontal scrollbar driving --diff-scroll-x. */}
          {scrollInnerWidth > 0 && (
            <div
              ref={hScrollRef}
              className={styles.fullDiffHScrollStrip}
              onScroll={onHScroll}
            >
              <div
                className={styles.fullDiffHScrollInner}
                style={{ width: scrollInnerWidth }}
              />
            </div>
          )}
        </div>
        <DualScrollbarMarkers
          leftMarkers={leftMarkers}
          rightMarkers={rightMarkers}
          containerRef={scrollContainerRef as React.RefObject<HTMLElement | null>}
          findMarks={findMarks}
        />
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
          return <span key={i}>{renderTextWithWhitespace(seg.text, `c${i}-`)}</span>
        }
        const cls = lineType === 'removed'
          ? styles.wordRemoved
          : styles.wordAdded
        return (
          <span key={i} className={cls}>
            {renderTextWithWhitespace(seg.text, `s${i}-`)}
          </span>
        )
      })}
    </>
  )
}

export function SyntaxHighlightedContent({ text, language }: { text: string; language: string | null }): React.JSX.Element {
  const tokens = useMemo(() => highlightLine(text, language), [text, language])
  return (
    <>
      {tokens.map((token, i) =>
        token.className ? (
          <span key={i} className={token.className}>{renderTextWithWhitespace(token.text, `t${i}-`)}</span>
        ) : (
          <span key={i}>{renderTextWithWhitespace(token.text, `t${i}-`)}</span>
        )
      )}
    </>
  )
}

/**
 * Like SyntaxHighlightedContent, but overlays Find match highlights (`ranges`)
 * on top of the syntax tokens. Falls back to plain syntax rendering when there
 * are no ranges so the common (no-search) path stays cheap.
 */
export function RangeHighlightedContent({
  text,
  language,
  ranges,
  baseClass
}: { text: string; language: string | null; ranges: HighlightRange[]; baseClass: string }): React.JSX.Element {
  const tokens = useMemo(() => highlightLine(text, language), [text, language])
  if (ranges.length === 0) return <SyntaxHighlightedContent text={text} language={language} />
  return <>{renderWithHighlights(text, tokens, ranges, baseClass)}</>
}
