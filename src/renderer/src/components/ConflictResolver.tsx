import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  AlertTriangle, X, Check, Circle, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Pencil, Eye, Trash2, Package, FileX2, MoreHorizontal
} from 'lucide-react'
import styles from './ConflictResolver.module.css'
import { SyntaxHighlightedContent, detectLanguage } from './DiffViewer'

interface ConflictResolverProps {
  repoPath: string
  onResolved: () => void
  onClose: () => void
}

interface ConflictFile {
  path: string
  resolved: boolean
}

type Side = 'ours' | 'theirs'

/** git leaves these unmerged shapes; only content/add-add carry markers. */
type ConflictType =
  | 'content' | 'add-add' | 'modify-delete' | 'delete-modify' | 'binary' | 'unknown'

/** One region of a conflicted file: either untouched context, or a conflict. */
export type Segment =
  | { kind: 'context'; lines: string[] }
  | {
      kind: 'conflict'
      id: number
      ours: string[]
      base: string[]
      theirs: string[]
      raw: string[] // exact original lines incl. markers — re-emitted verbatim while unresolved
      startLine: number
    }

/** Legacy whole-side selection kept for the pure parse/compose unit tests. */
type Selection = Record<number, Side[]>

type ActiveOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | null

interface ConflictSides {
  operation: ActiveOperation
  ours: { label: string; ref: string | null }
  theirs: { label: string; ref: string | null }
  yours: 'ours' | 'theirs'
}

const DEFAULT_SIDES: ConflictSides = {
  operation: null,
  ours: { label: 'Current', ref: null },
  theirs: { label: 'Incoming', ref: null },
  yours: 'ours'
}

/** Parse a conflicted file's text into ordered context/conflict segments. */
export function parseSegments(content: string): Segment[] {
  const lines = content.split('\n')
  const segments: Segment[] = []
  let ctx: string[] = []
  let id = 0
  let i = 0

  const flushCtx = (): void => {
    if (ctx.length > 0) {
      segments.push({ kind: 'context', lines: ctx })
      ctx = []
    }
  }

  while (i < lines.length) {
    if (lines[i].startsWith('<<<<<<<')) {
      flushCtx()
      const startLine = i
      const raw: string[] = [lines[i]]
      const ours: string[] = []
      const base: string[] = []
      const theirs: string[] = []
      let section: 'ours' | 'base' | 'theirs' = 'ours'
      i++
      while (i < lines.length) {
        const L = lines[i]
        if (L.startsWith('|||||||')) { section = 'base'; raw.push(L); i++; continue }
        if (L.startsWith('=======')) { section = 'theirs'; raw.push(L); i++; continue }
        if (L.startsWith('>>>>>>>')) { raw.push(L); i++; break }
        raw.push(L)
        if (section === 'ours') ours.push(L)
        else if (section === 'base') base.push(L)
        else theirs.push(L)
        i++
      }
      segments.push({ kind: 'conflict', id: id++, ours, base, theirs, raw, startLine })
    } else {
      ctx.push(lines[i])
      i++
    }
  }
  flushCtx()
  return segments
}

/** Lines a conflict contributes to the composed output for a given selection. */
function linesForRegion(seg: Extract<Segment, { kind: 'conflict' }>, order: Side[] | undefined): string[] {
  if (!order || order.length === 0) return seg.raw // unresolved → keep markers
  return order.flatMap((s) => (s === 'ours' ? seg.ours : seg.theirs))
}

/** Compose the full merged file from segments + a legacy whole-side selection.
 *  Retained for unit tests; the UI uses the line-level `composeLines` below. */
export function composeOutput(segments: Segment[], sel: Selection): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === 'context') out.push(...seg.lines)
    else out.push(...linesForRegion(seg, sel[seg.id]))
  }
  return out.join('\n')
}

// ─── Line-level selection ─────────────────────────────────────────────────────
// A conflict is resolved by picking individual lines from either side (not just
// a whole side). `undefined` = untouched (raw markers re-emitted); a Set (even
// empty) = resolved. Output = the picked ours-lines, then the picked theirs-lines.

export type LineSel = Record<number, Set<string> | undefined>
export const lkey = (side: Side, idx: number): string => `${side === 'ours' ? 'o' : 't'}:${idx}`

export function composeLines(segments: Segment[], sel: LineSel): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === 'context') { out.push(...seg.lines); continue }
    const picks = sel[seg.id]
    if (!picks) { out.push(...seg.raw); continue }
    seg.ours.forEach((l, i) => { if (picks.has(lkey('ours', i))) out.push(l) })
    seg.theirs.forEach((l, i) => { if (picks.has(lkey('theirs', i))) out.push(l) })
  }
  return out.join('\n')
}

// A row of the readable Output preview.
type OutRow =
  | { kind: 'ctx' | 'ours' | 'theirs'; text: string; n: number; anchor?: number }
  | { kind: 'unresolved'; idx: number }

function buildOutputRows(segments: Segment[], sel: LineSel): OutRow[] {
  const out: OutRow[] = []
  let n = 1
  let ci = 0
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    if (seg.kind === 'context') {
      const isLast = s === segments.length - 1
      const lines = isLast && seg.lines[seg.lines.length - 1] === '' ? seg.lines.slice(0, -1) : seg.lines
      for (const text of lines) { out.push({ kind: 'ctx', text, n }); n++ }
    } else {
      const idx = ci++
      const picks = sel[seg.id]
      if (!picks) { out.push({ kind: 'unresolved', idx }); continue }
      let first = true
      const emit = (kind: 'ours' | 'theirs', text: string): void => {
        out.push(first ? { kind, text, n, anchor: idx } : { kind, text, n })
        n++; first = false
      }
      seg.ours.forEach((l, i) => { if (picks.has(lkey('ours', i))) emit('ours', l) })
      seg.theirs.forEach((l, i) => { if (picks.has(lkey('theirs', i))) emit('theirs', l) })
    }
  }
  return out
}

// ─── 3-way line alignment ─────────────────────────────────────────────────────
// Each side is diffed against the common ancestor so both panes colour the SAME
// way: green = this side added/changed vs base, red = base line this side
// removed (shown as a non-selectable ghost), neutral = unchanged.

type Tone = 'same' | 'add' | 'del' | 'blank'
interface Cell { idx: number | null; text: string | null; tone: Tone }
interface A3Row { left: Cell; right: Cell }

type DiffOp = { type: 'same' | 'del' | 'add'; a?: number; b?: number }

/** LCS line diff of a → b. `del` = in a not b, `add` = in b not a. */
function diffLines(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: 'same', a: i, b: j }); i++; j++ }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ type: 'del', a: i }); i++ }
    else { ops.push({ type: 'add', b: j }); j++ }
  }
  while (i < n) { ops.push({ type: 'del', a: i }); i++ }
  while (j < m) { ops.push({ type: 'add', b: j }); j++ }
  return ops
}

function pairNeutral(ours: string[], theirs: string[]): A3Row[] {
  const rows: A3Row[] = []
  const k = Math.max(ours.length, theirs.length)
  for (let i = 0; i < k; i++) {
    rows.push({
      left: i < ours.length ? { idx: i, text: ours[i], tone: 'same' } : { idx: null, text: null, tone: 'blank' },
      right: i < theirs.length ? { idx: i, text: theirs[i], tone: 'same' } : { idx: null, text: null, tone: 'blank' }
    })
  }
  return rows
}

function align3(base: string[], ours: string[], theirs: string[]): A3Row[] {
  // Guard the O(n·m) tables for pathologically large blocks.
  if ((base.length + 1) * (Math.max(ours.length, theirs.length) + 1) > 4_000_000) {
    return pairNeutral(ours, theirs)
  }
  const build = (side: string[]): {
    same: Map<number, number>; adds: Map<number, number[]>
  } => {
    const same = new Map<number, number>()
    const adds = new Map<number, number[]>()
    let cur = -1
    for (const op of diffLines(base, side)) {
      if (op.type === 'same') { same.set(op.a!, op.b!); cur = op.a! }
      else if (op.type === 'del') { cur = op.a! }
      else { if (!adds.has(cur)) adds.set(cur, []); adds.get(cur)!.push(op.b!) }
    }
    return { same, adds }
  }
  const L = build(ours)
  const R = build(theirs)
  const rows: A3Row[] = []
  const emitAdds = (after: number): void => {
    const la = L.adds.get(after) ?? []
    const ra = R.adds.get(after) ?? []
    const k = Math.max(la.length, ra.length)
    for (let x = 0; x < k; x++) {
      rows.push({
        left: x < la.length ? { idx: la[x], text: ours[la[x]], tone: 'add' } : { idx: null, text: null, tone: 'blank' },
        right: x < ra.length ? { idx: ra[x], text: theirs[ra[x]], tone: 'add' } : { idx: null, text: null, tone: 'blank' }
      })
    }
  }
  emitAdds(-1)
  for (let b = 0; b < base.length; b++) {
    const lo = L.same.has(b) ? L.same.get(b)! : null
    const ro = R.same.has(b) ? R.same.get(b)! : null
    rows.push({
      left: lo !== null ? { idx: lo, text: ours[lo], tone: 'same' } : { idx: null, text: base[b], tone: 'del' },
      right: ro !== null ? { idx: ro, text: theirs[ro], tone: 'same' } : { idx: null, text: base[b], tone: 'del' }
    })
    emitAdds(b)
  }
  return rows
}

// ─── Aligned pane rows (with context folding) ─────────────────────────────────

const FOLD_PAD = 3          // context lines kept next to a conflict / file edge
const FOLD_MIN_HIDDEN = 4   // only collapse a run if it hides at least this many

interface RowCell extends Cell { ln: number | null }
type Row =
  | { kind: 'ctx'; text: string; oln: number; tln: number }
  | { kind: 'fold'; id: number; count: number }
  | { kind: 'chead'; id: number; oCount: number; tCount: number }
  | { kind: 'cbody'; id: number; left: RowCell; right: RowCell }

function buildRows(
  segments: Segment[],
  basePerConflict: (string[] | null)[] | null,
  expandedFolds: Set<number>
): Row[] {
  const rows: Row[] = []
  let oln = 1, tln = 1
  let ci = 0
  const last = segments.length - 1
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    if (seg.kind === 'context') {
      const isLast = s === last
      const lines = isLast && seg.lines[seg.lines.length - 1] === '' ? seg.lines.slice(0, -1) : seg.lines
      const total = lines.length
      const padTop = s === 0 ? 0 : FOLD_PAD
      const padBot = isLast ? 0 : FOLD_PAD
      const canFold = !expandedFolds.has(s) && total - padTop - padBot >= FOLD_MIN_HIDDEN
      if (!canFold) {
        for (const text of lines) { rows.push({ kind: 'ctx', text, oln, tln }); oln++; tln++ }
      } else {
        for (let k = 0; k < padTop; k++) { rows.push({ kind: 'ctx', text: lines[k], oln, tln }); oln++; tln++ }
        const hiddenEnd = total - padBot
        const hiddenCount = hiddenEnd - padTop
        oln += hiddenCount; tln += hiddenCount
        rows.push({ kind: 'fold', id: s, count: hiddenCount })
        for (let k = hiddenEnd; k < total; k++) { rows.push({ kind: 'ctx', text: lines[k], oln, tln }); oln++; tln++ }
      }
    } else {
      rows.push({ kind: 'chead', id: seg.id, oCount: seg.ours.length, tCount: seg.theirs.length })
      const base = basePerConflict ? basePerConflict[ci] : null
      const a3 = base !== null ? align3(base, seg.ours, seg.theirs) : pairNeutral(seg.ours, seg.theirs)
      for (const r of a3) {
        const left: RowCell = { ...r.left, ln: null }
        const right: RowCell = { ...r.right, ln: null }
        if (left.idx !== null) { left.ln = oln; oln++ }
        if (right.idx !== null) { right.ln = tln; tln++ }
        rows.push({ kind: 'cbody', id: seg.id, left, right })
      }
      ci++
    }
  }
  return rows
}

const isConflict = (s: Segment): s is Extract<Segment, { kind: 'conflict' }> => s.kind === 'conflict'

/** In-progress resolution state for ONE file, kept per path so switching files
 *  (even accidentally) never discards work. */
interface Draft {
  sel: LineSel
  manualOutput: string | null
  editingOutput: boolean
  expandedFolds: Set<number>
  activeConflict: number
}
const EMPTY_DRAFT: Draft = { sel: {}, manualOutput: null, editingOutput: false, expandedFolds: new Set(), activeConflict: 0 }

type SetterArg<T> = T | ((prev: T) => T)
const applySetter = <T,>(v: SetterArg<T>, prev: T): T => (typeof v === 'function' ? (v as (p: T) => T)(prev) : v)

export function ConflictResolver({ repoPath, onResolved, onClose }: ConflictResolverProps): React.JSX.Element {
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [merged3, setMerged3] = useState<string | null>(null)
  const [conflictType, setConflictType] = useState<ConflictType>('content')
  const [loadedFile, setLoadedFile] = useState<string | null>(null)
  // Per-file resolution drafts. The active file's draft is the source of truth
  // for sel/manualOutput/etc., so switching files preserves in-progress work.
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [sides, setSides] = useState<ConflictSides>(DEFAULT_SIDES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [canSkip, setCanSkip] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(true) // global view pref
  const [leftPct, setLeftPct] = useState(50)     // Local pane width %
  const [outputPct, setOutputPct] = useState(34) // Output height %
  const [fileListWidth, setFileListWidth] = useState(240) // Conflicted-files pane px

  const oursPaneRef = useRef<HTMLDivElement | null>(null)
  const theirsPaneRef = useRef<HTMLDivElement | null>(null)
  const panesRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const cheadRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const outAnchorRefs = useRef<Map<number, HTMLElement | null>>(new Map())
  const editorRef = useRef<HTMLTextAreaElement | null>(null)
  const editGutterRef = useRef<HTMLDivElement | null>(null)
  const syncing = useRef(false)

  // ─── Active file's draft (per-file, so file switches never lose work) ──────
  const selectedFileRef = useRef<string | null>(selectedFile)
  selectedFileRef.current = selectedFile
  const draft = (selectedFile ? drafts[selectedFile] : undefined) ?? EMPTY_DRAFT
  const { sel, manualOutput, editingOutput, expandedFolds, activeConflict } = draft

  const patchDraft = useCallback((patch: (d: Draft) => Partial<Draft>): void => {
    const file = selectedFileRef.current
    if (!file) return
    setDrafts((prev) => {
      const cur = prev[file] ?? EMPTY_DRAFT
      return { ...prev, [file]: { ...cur, ...patch(cur) } }
    })
  }, [])

  // Wrappers keep the existing setSel/… call sites intact while routing writes
  // to the active file's draft. They accept a value or an updater like useState.
  const setSel = useCallback((v: SetterArg<LineSel>) => patchDraft((d) => ({ sel: applySetter(v, d.sel) })), [patchDraft])
  const setManualOutput = useCallback((v: SetterArg<string | null>) => patchDraft((d) => ({ manualOutput: applySetter(v, d.manualOutput) })), [patchDraft])
  const setEditingOutput = useCallback((v: SetterArg<boolean>) => patchDraft((d) => ({ editingOutput: applySetter(v, d.editingOutput) })), [patchDraft])
  const setExpandedFolds = useCallback((v: SetterArg<Set<number>>) => patchDraft((d) => ({ expandedFolds: applySetter(v, d.expandedFolds) })), [patchDraft])
  const setActiveConflict = useCallback((v: SetterArg<number>) => patchDraft((d) => ({ activeConflict: applySetter(v, d.activeConflict) })), [patchDraft])

  const activeOp = sides.operation

  // ─── Load conflicted files + operation sides ───────────────────────────────
  const loadFiles = useCallback(async () => {
    setLoading(true)
    try {
      const [filesResult, sidesResult] = await Promise.all([
        window.electronAPI.git.getConflictedFiles(repoPath),
        window.electronAPI.git.getConflictSides(repoPath)
      ])
      if (filesResult.success && Array.isArray(filesResult.data)) {
        setFiles(filesResult.data.map((f: string) => ({ path: f, resolved: false })))
        if (filesResult.data.length > 0) setSelectedFile((prev) => prev ?? filesResult.data[0])
      }
      if (sidesResult.success && sidesResult.data) setSides(sidesResult.data as ConflictSides)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conflicted files')
    } finally {
      setLoading(false)
    }
  }, [repoPath])

  useEffect(() => { loadFiles() }, [loadFiles])

  // ─── Load selected file content (guarded against stale responses) ──────────
  const loadContent = useCallback(async (file: string, isStale?: () => boolean) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.electronAPI.git.getConflictContent(repoPath, file)
      if (isStale?.()) return
      if (result.success && result.data) {
        const data = result.data as { merged: string; merged3: string | null; conflictType: ConflictType }
        // Only the file CONTENT is (re)derived here. The per-file draft
        // (sel/manualOutput/…) is NOT touched, so returning to a file restores
        // exactly the resolution you left — a brand-new file falls back to
        // EMPTY_DRAFT automatically.
        setSegments(parseSegments(data.merged))
        setMerged3(data.merged3 ?? null)
        setConflictType(data.conflictType ?? 'content')
        setLoadedFile(file)
      } else {
        setError(result.error || 'Failed to load conflict content')
      }
    } catch (err) {
      if (isStale?.()) return
      setError(err instanceof Error ? err.message : 'Failed to load conflict content')
    } finally {
      if (!isStale?.()) setLoading(false)
    }
  }, [repoPath])

  useEffect(() => {
    if (!selectedFile) return
    let cancelled = false
    loadContent(selectedFile, () => cancelled)
    return () => { cancelled = true }
  }, [selectedFile, loadContent])

  // ─── Derived state ─────────────────────────────────────────────────────────
  const conflicts = useMemo(() => segments.filter(isConflict), [segments])

  // Base sections (from the diff3 render) paired to each conflict for colouring.
  const basePerConflict = useMemo<(string[] | null)[] | null>(() => {
    if (!merged3) return null
    const c3 = parseSegments(merged3).filter(isConflict)
    if (c3.length !== conflicts.length) return null // can't trust the pairing → neutral
    return c3.map((c) => c.base)
  }, [merged3, conflicts])

  const rows = useMemo(
    () => buildRows(segments, basePerConflict, expandedFolds),
    [segments, basePerConflict, expandedFolds]
  )
  const composedOutput = useMemo(
    () => (manualOutput !== null ? manualOutput : composeLines(segments, sel)),
    [manualOutput, segments, sel]
  )
  const outputRows = useMemo(() => buildOutputRows(segments, sel), [segments, sel])
  const hasMarkers = editingOutput
    ? composedOutput.split('\n').some((l) => l.startsWith('<<<<<<<') || l.startsWith('>>>>>>>'))
    : conflicts.some((c) => sel[c.id] === undefined)
  const resolvedCount = conflicts.filter((c) => sel[c.id] !== undefined).length
  const language = useMemo(() => (selectedFile ? detectLanguage(selectedFile) : null), [selectedFile])
  const bigFile = rows.length > 4000
  const isTreeConflict = conflicts.length === 0 &&
    (conflictType === 'modify-delete' || conflictType === 'delete-modify' || conflictType === 'binary')

  // Auto-jump to the first conflict once a file's rows are built, so a lone
  // conflict deep in a big file is on screen immediately.
  useEffect(() => {
    if (conflicts.length === 0) return
    const id = requestAnimationFrame(() => {
      cheadRefs.current.get(conflicts[0].id)?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(id)
  }, [selectedFile, conflicts])

  // ─── Selection ─────────────────────────────────────────────────────────────
  const clearManual = (): void => { setManualOutput(null); setEditingOutput(false) }

  const toggleLine = useCallback((id: number, side: Side, idx: number) => {
    clearManual()
    setSel((prev) => {
      const cur = new Set(prev[id] ?? [])
      const k = lkey(side, idx)
      if (cur.has(k)) cur.delete(k); else cur.add(k)
      return { ...prev, [id]: cur }
    })
  }, [])

  const toggleSideAll = useCallback((id: number, side: Side, count: number) => {
    clearManual()
    setSel((prev) => {
      // A side with no lines = "take nothing" for this conflict (drop the other
      // side's added lines). Clicking it resolves the conflict to empty; clicking
      // again clears the choice. This is the only way to pick the empty side.
      if (count === 0) {
        const cur = prev[id]
        const next = { ...prev }
        if (cur !== undefined && cur.size === 0) delete next[id] // toggle off → unresolved
        else next[id] = new Set<string>()                       // take nothing (clears the other side)
        return next
      }
      const cur = new Set(prev[id] ?? [])
      const keys = Array.from({ length: count }, (_, i) => lkey(side, i))
      const allOn = keys.every((k) => cur.has(k))
      keys.forEach((k) => { if (allOn) cur.delete(k); else cur.add(k) })
      return { ...prev, [id]: cur }
    })
  }, [])

  // Toggle a whole side across EVERY conflict in the file (the pane-header
  // checkbox). Additive with the other side, so checking both = take both.
  const toggleAllSide = useCallback((side: Side) => {
    clearManual()
    setSel((prev) => {
      const linesOf = (c: Extract<Segment, { kind: 'conflict' }>): string[] => (side === 'ours' ? c.ours : c.theirs)
      const hasAny = conflicts.some((c) => linesOf(c).length > 0)
      const allOn = hasAny && conflicts.every((c) => linesOf(c).every((_, i) => prev[c.id]?.has(lkey(side, i))))
      const next: LineSel = { ...prev }
      for (const c of conflicts) {
        const set = new Set(next[c.id] ?? [])
        linesOf(c).forEach((_, i) => { if (allOn) set.delete(lkey(side, i)); else set.add(lkey(side, i)) })
        next[c.id] = set
      }
      return next
    })
  }, [conflicts])

  /** Header-checkbox state for a whole side across the file. */
  const sideState = (side: Side): 'on' | 'some' | 'off' => {
    const linesOf = (c: Extract<Segment, { kind: 'conflict' }>): string[] => (side === 'ours' ? c.ours : c.theirs)
    if (!conflicts.some((c) => linesOf(c).length > 0)) return 'off'
    if (conflicts.every((c) => linesOf(c).every((_, i) => sel[c.id]?.has(lkey(side, i))))) return 'on'
    return conflicts.some((c) => linesOf(c).some((_, i) => sel[c.id]?.has(lkey(side, i)))) ? 'some' : 'off'
  }

  const isChecked = (id: number, side: Side, idx: number): boolean => !!sel[id]?.has(lkey(side, idx))

  // ─── Synced scroll + conflict navigation ───────────────────────────────────
  const onPaneScroll = useCallback((from: 'ours' | 'theirs') => {
    if (syncing.current) { syncing.current = false; return }
    const src = from === 'ours' ? oursPaneRef.current : theirsPaneRef.current
    const dst = from === 'ours' ? theirsPaneRef.current : oursPaneRef.current
    if (src && dst && (dst.scrollTop !== src.scrollTop || dst.scrollLeft !== src.scrollLeft)) {
      syncing.current = true
      dst.scrollTop = src.scrollTop
      dst.scrollLeft = src.scrollLeft
    }
  }, [])

  const scrollToConflict = useCallback((idx: number) => {
    const conflict = conflicts[idx]
    if (!conflict) return
    cheadRefs.current.get(conflict.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    outAnchorRefs.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [conflicts])

  const gotoConflict = useCallback((delta: number) => {
    setActiveConflict((prev) => {
      const next = Math.max(0, Math.min(conflicts.length - 1, prev + delta))
      scrollToConflict(next)
      return next
    })
  }, [conflicts.length, scrollToConflict])

  // Jump to the next still-unresolved conflict (wrapping), so "N unresolved"
  // in the output header takes you straight there.
  const gotoNextUnresolved = useCallback(() => {
    const n = conflicts.length
    if (n === 0) return
    const start = activeConflict % n
    for (let step = 1; step <= n; step++) {
      const idx = (start + step) % n
      if (sel[conflicts[idx].id] === undefined) {
        setActiveConflict(idx)
        scrollToConflict(idx)
        return
      }
    }
  }, [conflicts, activeConflict, sel, scrollToConflict])

  // ─── Resizable panes ───────────────────────────────────────────────────────
  const startResizeH = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = panesRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const onMove = (ev: PointerEvent): void => {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100
      setLeftPct(Math.min(80, Math.max(20, pct)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const startResizeFileList = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = bodyRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const onMove = (ev: PointerEvent): void => {
      setFileListWidth(Math.min(600, Math.max(150, ev.clientX - rect.left)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  const startResizeV = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const el = contentRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const onMove = (ev: PointerEvent): void => {
      const pct = ((rect.bottom - ev.clientY) / rect.height) * 100
      setOutputPct(Math.min(80, Math.max(12, pct)))
    }
    const onUp = (): void => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }, [])

  // ─── Mark file resolved ────────────────────────────────────────────────────
  const advanceOrRefresh = useCallback(() => {
    setFiles((prev) => prev.map((f) => (f.path === selectedFile ? { ...f, resolved: true } : f)))
    // Drop the resolved file's draft — it's staged now, so its selection is spent.
    if (selectedFile) setDrafts((prev) => { const n = { ...prev }; delete n[selectedFile]; return n })
    const next = files.find((f) => f.path !== selectedFile && !f.resolved)?.path
    if (next) setSelectedFile(next)
    else if (selectedFile) loadContent(selectedFile) // reload resolved file → clears stale view
  }, [selectedFile, files, loadContent])

  const markFileResolved = useCallback(async () => {
    if (!selectedFile) return
    setResolving(true)
    try {
      const result = await window.electronAPI.git.resolveConflictFile(repoPath, selectedFile, composedOutput)
      if (result.success) advanceOrRefresh()
      else setError(result.error || 'Failed to mark file as resolved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve file')
    } finally {
      setResolving(false)
    }
  }, [selectedFile, repoPath, composedOutput, advanceOrRefresh])

  const markChoice = useCallback(async (choice: 'ours' | 'theirs' | 'keep' | 'delete') => {
    if (!selectedFile) return
    setResolving(true)
    try {
      const result = await window.electronAPI.git.resolveConflictChoice(repoPath, selectedFile, choice)
      if (result.success) advanceOrRefresh()
      else setError(result.error || 'Failed to resolve file')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve file')
    } finally {
      setResolving(false)
    }
  }, [selectedFile, repoPath, advanceOrRefresh])

  // ─── Continue / skip / abort ───────────────────────────────────────────────
  const refreshConflictsAfter = useCallback(
    async (result?: { data?: unknown; error?: string }): Promise<'more' | 'skip' | 'error'> => {
      const newFiles = await window.electronAPI.git.getConflictedFiles(repoPath)
      if (newFiles.success && Array.isArray(newFiles.data) && newFiles.data.length > 0) {
        setFiles(newFiles.data.map((f: string) => ({ path: f, resolved: false })))
        setSelectedFile(newFiles.data[0])
        const sidesResult = await window.electronAPI.git.getConflictSides(repoPath)
        if (sidesResult.success && sidesResult.data) setSides(sidesResult.data as ConflictSides)
        return 'more'
      }
      const threw = !result?.data
      const op = await window.electronAPI.git.getActiveOperation(repoPath)
      if (op.success && op.data === 'rebase' && !threw) return 'skip'
      return 'error'
    },
    [repoPath]
  )

  const continueOperation = useCallback(async () => {
    setResolving(true)
    setCanSkip(false)
    try {
      let result
      if (activeOp === 'merge') result = await window.electronAPI.git.mergeContinue(repoPath)
      else if (activeOp === 'rebase') result = await window.electronAPI.git.rebaseContinue(repoPath)
      else if (activeOp === 'cherry-pick') result = await window.electronAPI.git.cherryPickContinue(repoPath)
      else if (activeOp === 'revert') result = await window.electronAPI.git.revertContinue(repoPath)

      if (result?.success) { onResolved(); return }
      const outcome = await refreshConflictsAfter(result)
      if (outcome === 'more') setError('More conflicts found. Resolve them and continue.')
      else if (outcome === 'skip') {
        setCanSkip(true)
        setError('This commit is now empty (its changes are already upstream). Skip it to continue the rebase.')
      } else {
        const msg = (result?.data as { message?: string } | undefined)?.message || result?.error
        setError(msg || 'Failed to continue operation')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue operation')
    } finally {
      setResolving(false)
    }
  }, [activeOp, repoPath, onResolved, refreshConflictsAfter])

  const skipRebaseCommit = useCallback(async () => {
    setResolving(true)
    setCanSkip(false)
    try {
      const result = await window.electronAPI.git.rebaseSkip(repoPath)
      const data = result?.data as { success?: boolean; message?: string; conflicts?: string[] } | undefined
      if (result?.success && data?.success !== false) {
        const outcome = await refreshConflictsAfter(result)
        if (outcome === 'more') setError('More conflicts found after skip. Resolve them and continue.')
        else if (outcome === 'skip') { setCanSkip(true); setError('The next commit is also empty. Skip it too, or continue.') }
        else onResolved()
      } else if (data?.conflicts && data.conflicts.length > 0) {
        const outcome = await refreshConflictsAfter(result)
        if (outcome === 'skip') { setCanSkip(true); setError('The next commit is also empty. Skip it too, or continue.') }
        else setError(data.message || 'More conflicts after skip. Resolve them and continue.')
      } else {
        setError(data?.message || result?.error || 'Failed to skip commit')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to skip commit')
    } finally {
      setResolving(false)
    }
  }, [repoPath, onResolved, refreshConflictsAfter])

  const abortOperation = useCallback(async () => {
    setResolving(true)
    try {
      let result
      if (activeOp === 'merge') result = await window.electronAPI.git.mergeAbort(repoPath)
      else if (activeOp === 'rebase') result = await window.electronAPI.git.rebaseAbort(repoPath)
      else if (activeOp === 'cherry-pick') result = await window.electronAPI.git.cherryPickAbort(repoPath)
      else if (activeOp === 'revert') result = await window.electronAPI.git.revertAbort(repoPath)
      if (result?.success) onClose()
      else setError(result?.error || 'Failed to abort operation')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to abort operation')
    } finally {
      setResolving(false)
    }
  }, [activeOp, repoPath, onClose])

  const allResolved = files.length > 0 && files.every((f) => f.resolved)
  const unresolvedCount = files.filter((f) => !f.resolved).length
  const opLabel = activeOp ? activeOp.charAt(0).toUpperCase() + activeOp.slice(1) : 'Operation'
  // Standard mergetool naming: ours (HEAD) = Local, theirs (incoming) = Remote.
  const roleOf = (side: Side): string => (side === 'ours' ? 'Local' : 'Remote')

  // Render one pane's cell for a given row.
  const renderCell = (row: Row, side: Side): React.JSX.Element => {
    if (row.kind === 'ctx') {
      return (
        <div className={styles.mgRow}>
          <span className={styles.mgGutter}>
            <span className={styles.mgCheckSpacer} />
            <span className={styles.mgGutterNum}>{side === 'ours' ? row.oln : row.tln}</span>
          </span>
          <span className={styles.mgCell}><SyntaxHighlightedContent text={row.text} language={language} /></span>
        </div>
      )
    }
    if (row.kind === 'fold') {
      return (
        <button className={styles.mgFoldRow} onClick={() => setExpandedFolds((p) => new Set(p).add(row.id))}>
          <MoreHorizontal size={13} />
          {side === 'ours' ? `Show ${row.count} unchanged line${row.count === 1 ? '' : 's'}` : ''}
        </button>
      )
    }
    if (row.kind === 'chead') {
      const count = side === 'ours' ? row.oCount : row.tCount
      const picks = sel[row.id]
      const empty = count === 0
      const keys = Array.from({ length: count }, (_, i) => lkey(side, i))
      // Empty side is "taken" when the conflict resolves to nothing; a side with
      // lines is "taken" when all its lines are selected.
      const on = empty ? (picks !== undefined && picks.size === 0) : (!!picks && keys.every((k) => picks.has(k)))
      const some = !empty && !on && !!picks && keys.some((k) => picks.has(k))
      const title = empty
        ? (on ? 'Undo — leave this conflict unresolved' : `Take ${roleOf(side)} (nothing) — drop the added lines`)
        : (on ? `Remove all ${roleOf(side)} lines` : `Include all ${roleOf(side)} lines`)
      return (
        <div
          className={`${styles.mgRow} ${styles.mgChead}${on ? ` ${styles.mgCheadOn}` : ''}`}
          ref={side === 'ours' ? (el) => { cheadRefs.current.set(row.id, el) } : undefined}
        >
          <span className={styles.mgGutter}>
            <button
              className={`${styles.mgCheck}${on ? ` ${styles.mgCheckOn} ${side === 'ours' ? styles.mgCheckOurs : styles.mgCheckTheirs}` : ''}${some ? ` ${styles.mgCheckSome}` : ''}`}
              onClick={() => toggleSideAll(row.id, side, count)}
              title={title}
            >
              {on ? <Check size={11} /> : some ? '–' : ''}
            </button>
          </span>
          <span className={styles.mgCheadLabel}>
            {roleOf(side)}
            <span className={styles.mgCheadCount}>{empty ? 'nothing' : `${count} line${count === 1 ? '' : 's'}`}</span>
          </span>
        </div>
      )
    }
    // cbody
    const cell = side === 'ours' ? row.left : row.right
    const selectable = cell.idx !== null
    const checked = selectable && isChecked(row.id, side, cell.idx as number)
    const toneClass =
      cell.tone === 'add' ? styles.mgToneAdd
        : cell.tone === 'del' ? styles.mgToneDel
          : cell.tone === 'blank' ? styles.mgRowBlank : ''
    return (
      <div className={`${styles.mgRow} ${toneClass}${checked ? ` ${styles.mgRowPicked}` : ''}`}>
        <span className={styles.mgGutter}>
          {selectable ? (
            <button
              className={`${styles.mgCheckLine}${checked ? ` ${styles.mgCheckLineOn} ${side === 'ours' ? styles.mgCheckOurs : styles.mgCheckTheirs}` : ''}`}
              onClick={() => toggleLine(row.id, side, cell.idx as number)}
              title={checked ? 'Exclude this line' : 'Include this line'}
            >
              {checked ? <Check size={9} /> : ''}
            </button>
          ) : <span className={styles.mgCheckSpacer} />}
          <span className={styles.mgGutterNum}>{cell.ln ?? ''}</span>
        </span>
        <span className={styles.mgCell}>
          {cell.text === null ? <span>&nbsp;</span>
            : cell.tone === 'del'
              ? <span className={styles.mgGhostText}>{cell.text || ' '}</span>
              : <SyntaxHighlightedContent text={cell.text} language={language} />}
        </span>
      </div>
    )
  }

  // Chooser for marker-less (tree-level) conflicts.
  const renderChooser = (): React.JSX.Element => {
    const isBinary = conflictType === 'binary'
    const isModDel = conflictType === 'modify-delete'   // ours modified, theirs deleted
    const isDelMod = conflictType === 'delete-modify'   // ours deleted, theirs modified
    const keptSide = isModDel ? 'Local' : 'Remote'
    return (
      <div className={styles.mgChooser}>
        <div className={styles.mgChooserIcon}>
          {isBinary ? <Package size={28} /> : <FileX2 size={28} />}
        </div>
        <div className={styles.mgChooserTitle}>
          {isBinary && 'Binary file changed on both sides'}
          {isModDel && `Modified by ${sides.ours.label} — deleted by ${sides.theirs.label}`}
          {isDelMod && `Deleted by ${sides.ours.label} — modified by ${sides.theirs.label}`}
          {!isBinary && !isModDel && !isDelMod && 'This file is unmerged'}
        </div>
        <div className={styles.mgChooserBody}>
          {isBinary
            ? 'Binary files can’t be merged line-by-line. Choose which version to keep.'
            : (isModDel || isDelMod)
              ? `One side changed this file while the other deleted it. Keep the ${keptSide} edits, or accept the deletion.`
              : 'There are no conflict markers to edit — review the output below and mark it resolved.'}
        </div>
        <div className={styles.mgChooserActions}>
          {isBinary && (
            <>
              <button className={`${styles.mgChooserBtn} ${styles.mgChooserOurs}`} onClick={() => markChoice('ours')} disabled={resolving}>
                Take {sides.ours.label} (Local)
              </button>
              <button className={`${styles.mgChooserBtn} ${styles.mgChooserTheirs}`} onClick={() => markChoice('theirs')} disabled={resolving}>
                Take {sides.theirs.label} (Remote)
              </button>
            </>
          )}
          {(isModDel || isDelMod) && (
            <>
              <button className={`${styles.mgChooserBtn} ${styles.mgChooserKeep}`} onClick={() => markChoice('keep')} disabled={resolving}>
                <Check size={14} /> Keep the file ({keptSide}’s version)
              </button>
              <button className={`${styles.mgChooserBtn} ${styles.mgChooserDelete}`} onClick={() => markChoice('delete')} disabled={resolving}>
                <Trash2 size={14} /> Delete the file
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const showOutput = conflicts.length > 0 || (!isTreeConflict && selectedFile)
  const editorLineCount = (manualOutput ?? '').split('\n').length
  const oursAll = sideState('ours')
  const theirsAll = sideState('theirs')
  const unresolvedRemaining = conflicts.length - resolvedCount

  return (
    <div className={styles.mgOverlay}>
      <div className={styles.mgRoot}>
        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className={styles.mgHeader}>
          <div className={styles.mgTitle}>
            <span className={styles.mgTitleIcon}><AlertTriangle size={16} /></span>
            <h3>{opLabel} — Resolve Conflicts</h3>
            <span className={styles.mgFileCount}>{unresolvedCount} of {files.length} file{files.length !== 1 ? 's' : ''} left</span>
          </div>
          <div className={styles.mgHeaderActions}>
            <button className={`${styles.mgBtn} ${styles.mgBtnAbort}`} onClick={abortOperation} disabled={resolving} title={`Abort ${opLabel}`}>
              Abort {opLabel}
            </button>
            <button className={styles.mgBtnClose} onClick={onClose} title="Close (keeps conflicts — resume from the banner)"><X size={16} /></button>
          </div>
        </div>

        {error && (
          <div className={styles.mgError}>
            <AlertTriangle size={14} />
            <span className={styles.mgErrorText}>{error}</span>
            {canSkip && <button className={`${styles.mgBtn} ${styles.mgBtnSkip}`} onClick={skipRebaseCommit} disabled={resolving}>Skip commit</button>}
            <button className={styles.mgErrorClose} onClick={() => setError(null)}><X size={14} /></button>
          </div>
        )}

        <div className={styles.mgBody} ref={bodyRef}>
          {/* ── File list ─────────────────────────────────────────────────── */}
          <div className={styles.mgFileList} style={{ width: fileListWidth, minWidth: fileListWidth }}>
            <div className={styles.mgFileListHeader}>Conflicted files</div>
            {files.map((file) => {
              const parts = file.path.split('/')
              const name = parts.pop()
              const dir = parts.join('/')
              return (
                <button
                  key={file.path}
                  className={`${styles.mgFileItem}${selectedFile === file.path ? ` ${styles.mgActive}` : ''}${file.resolved ? ` ${styles.mgFileResolved}` : ''}`}
                  onClick={() => setSelectedFile(file.path)}
                  title={file.path}
                >
                  <span className={`${styles.mgFileStatus}${file.resolved ? ` ${styles.mgResolved}` : ` ${styles.mgUnresolved}`}`}>
                    {file.resolved ? <Check size={12} /> : <Circle size={12} />}
                  </span>
                  <span className={styles.mgFileName}>
                    {dir && <span className={styles.mgFileDir}>{dir}/</span>}
                    <span className={styles.mgFileBase}>{name}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <div className={styles.mgResizerH} onPointerDown={startResizeFileList} title="Drag to resize" />

          {/* ── Main resolve area ─────────────────────────────────────────── */}
          {selectedFile && !loading && loadedFile === selectedFile && (
            <div className={styles.mgContent} ref={contentRef}>
              {/* Toolbar (hidden for tree conflicts, which have no hunks) */}
              {conflicts.length > 0 && (
                <div className={styles.mgToolbar}>
                  <div className={styles.mgNav}>
                    <button className={styles.mgNavBtn} onClick={() => gotoConflict(-1)} disabled={activeConflict === 0} title="Previous conflict"><ChevronLeft size={14} /></button>
                    <span className={styles.mgNavCount}>
                      {`Conflict ${Math.min(activeConflict + 1, conflicts.length)} / ${conflicts.length} · ${resolvedCount} resolved`}
                    </span>
                    <button className={styles.mgNavBtn} onClick={() => gotoConflict(1)} disabled={activeConflict >= conflicts.length - 1} title="Next conflict"><ChevronRight size={14} /></button>
                  </div>
                  <span className={styles.mgToolbarHint}>Tick <strong>Local</strong> / <strong>Remote</strong> in a pane header to take that whole side</span>
                </div>
              )}

              {isTreeConflict ? renderChooser() : conflicts.length === 0 ? (
                <div className={styles.mgPanesEmpty}>No conflict markers in this file — review the output below and mark it resolved.</div>
              ) : (
                <div className={styles.mgPanes} ref={panesRef}>
                  <div className={styles.mgPane} style={{ flex: `0 0 ${leftPct}%` }} ref={oursPaneRef} onScroll={() => onPaneScroll('ours')}>
                    <div className={styles.mgPaneHeader}>
                      <button
                        className={`${styles.mgPaneCheck} ${styles.mgPaneCheckOurs}${oursAll === 'on' ? ` ${styles.mgPaneCheckOn}` : ''}`}
                        onClick={() => toggleAllSide('ours')}
                        title="Take every Local line in this file"
                      >{oursAll === 'on' ? <Check size={11} /> : oursAll === 'some' ? '–' : ''}</button>
                      <span className={styles.mgPaneRole}>Local</span>
                      {sides.ours.ref && <span className={styles.mgPaneBranch}>{sides.ours.ref}</span>}
                    </div>
                    <div className={styles.mgPaneBody}>
                      {bigFile ? <div className={styles.mgPanesEmpty}>File too large to preview side-by-side — use the editable output below.</div>
                        : rows.map((row, i) => <React.Fragment key={i}>{renderCell(row, 'ours')}</React.Fragment>)}
                    </div>
                  </div>
                  <div className={styles.mgResizerH} onPointerDown={startResizeH} title="Drag to resize" />
                  <div className={styles.mgPane} style={{ flex: '1 1 0' }} ref={theirsPaneRef} onScroll={() => onPaneScroll('theirs')}>
                    <div className={styles.mgPaneHeader}>
                      <button
                        className={`${styles.mgPaneCheck} ${styles.mgPaneCheckTheirs}${theirsAll === 'on' ? ` ${styles.mgPaneCheckOn}` : ''}`}
                        onClick={() => toggleAllSide('theirs')}
                        title="Take every Remote line in this file"
                      >{theirsAll === 'on' ? <Check size={11} /> : theirsAll === 'some' ? '–' : ''}</button>
                      <span className={styles.mgPaneRole}>Remote</span>
                      {sides.theirs.ref && <span className={styles.mgPaneBranch}>{sides.theirs.ref}</span>}
                    </div>
                    <div className={styles.mgPaneBody}>
                      {bigFile ? <div className={styles.mgPanesEmpty}>File too large to preview side-by-side — use the editable output below.</div>
                        : rows.map((row, i) => <React.Fragment key={i}>{renderCell(row, 'theirs')}</React.Fragment>)}
                    </div>
                  </div>
                </div>
              )}

              {/* Vertical resizer + live editable output */}
              {showOutput && !isTreeConflict && (
                <>
                  {conflicts.length > 0 && <div className={styles.mgResizerV} onPointerDown={startResizeV} title="Drag to resize" />}
                  <div className={styles.mgOutput} style={{ flex: `0 0 ${outputPct}%` }}>
                    <div className={styles.mgOutputHeader}>
                      <div className={styles.mgOutputHeaderLeft}>
                        <button className={styles.mgOutputToggle} onClick={() => setOutputExpanded((v) => !v)}>
                          {outputExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                          <span>Output — {selectedFile.split('/').pop()}</span>
                        </button>
                        {hasMarkers && (
                          editingOutput ? (
                            <span className={styles.mgOutputWarnStatic}><AlertTriangle size={12} /> unresolved conflicts remain</span>
                          ) : (
                            <button className={styles.mgOutputWarn} onClick={gotoNextUnresolved} title="Jump to the next unresolved conflict">
                              <AlertTriangle size={12} /> {unresolvedRemaining} unresolved — click to locate
                            </button>
                          )
                        )}
                      </div>
                      <div className={styles.mgOutputActions}>
                        <button
                          className={styles.mgOutputEditToggle}
                          onClick={() => { if (editingOutput) { setManualOutput(null); setEditingOutput(false) } else { setManualOutput(composedOutput); setEditingOutput(true) } }}
                          title={editingOutput ? 'Discard manual edits and return to the composed result' : 'Edit the merged result by hand'}
                        >
                          {editingOutput ? <><Eye size={13} /> Preview</> : <><Pencil size={13} /> Edit</>}
                        </button>
                        <button className={`${styles.mgBtn} ${styles.mgMarkResolved}`} onClick={markFileResolved} disabled={resolving || hasMarkers}
                          title={hasMarkers ? 'Resolve all conflicts first' : 'Mark this file as resolved'}>
                          {resolving ? 'Saving…' : <><Check size={14} /> Mark resolved</>}
                        </button>
                      </div>
                    </div>
                    {outputExpanded && (
                      editingOutput ? (
                        <div className={styles.mgEditWrap}>
                          <div className={styles.mgEditGutter} ref={editGutterRef}>
                            {Array.from({ length: editorLineCount }, (_, i) => <div key={i} className={styles.mgEditGutterNum}>{i + 1}</div>)}
                          </div>
                          <textarea
                            ref={editorRef}
                            className={styles.mgOutputEditor}
                            value={manualOutput ?? ''}
                            onChange={(e) => setManualOutput(e.target.value)}
                            onScroll={() => { if (editGutterRef.current && editorRef.current) editGutterRef.current.scrollTop = editorRef.current.scrollTop }}
                            spellCheck={false}
                          />
                        </div>
                      ) : (
                        <div className={styles.mgOutputView}>
                          {outputRows.map((r, i) =>
                            r.kind === 'unresolved' ? (
                              <button
                                key={i}
                                ref={(el) => { outAnchorRefs.current.set(r.idx, el) }}
                                className={styles.mgOutUnresolved}
                                onClick={() => { setActiveConflict(r.idx); scrollToConflict(r.idx) }}
                                title="Jump to this conflict above"
                              >
                                <AlertTriangle size={12} />
                                Unresolved conflict {r.idx + 1} — pick lines above
                              </button>
                            ) : (
                              <div
                                key={i}
                                ref={r.anchor !== undefined ? (el) => { outAnchorRefs.current.set(r.anchor as number, el) } : undefined}
                                className={`${styles.mgOutputRow}${r.kind === 'ours' ? ` ${styles.mgOutOurs}` : r.kind === 'theirs' ? ` ${styles.mgOutTheirs}` : ''}`}
                              >
                                <span className={styles.mgOutputLineNum}>{r.n}</span>
                                <span className={styles.mgOutputText}>
                                  {bigFile ? (r.text || ' ') : <SyntaxHighlightedContent text={r.text} language={language} />}
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      )
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {selectedFile && loadedFile !== selectedFile && !error && (
            <div className={styles.mgLoading}>Loading conflict data…</div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        {allResolved && (
          <div className={styles.mgFooter}>
            <div className={styles.mgFooterMsg}><Check size={16} /> All files resolved — finish the {opLabel.toLowerCase()}?</div>
            <button className={`${styles.mgBtn} ${styles.mgBtnContinue}`} onClick={continueOperation} disabled={resolving}>
              {resolving ? 'Processing…' : `Continue ${opLabel}`}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
