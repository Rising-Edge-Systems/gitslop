import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import {
  AlertTriangle, X, Check, Circle, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Pencil, Eye
} from 'lucide-react'
import styles from './ConflictResolver.module.css'
import { computeWordDiff, SyntaxHighlightedContent, detectLanguage, type WordDiffSegment } from './DiffViewer'

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

/** Per-conflict selection: the ordered list of sides to include in the output.
 *  Empty = unresolved (the raw markers are re-emitted). Order matters so that
 *  checking ours then theirs yields ours-then-theirs (and vice-versa). */
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

/** Compose the full merged file from segments + the user's per-conflict selection. */
export function composeOutput(segments: Segment[], sel: Selection): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === 'context') out.push(...seg.lines)
    else out.push(...linesForRegion(seg, sel[seg.id]))
  }
  return out.join('\n')
}

// A row of the readable Output preview: an unconflicted line, a line kept from
// one side (shown tinted so resolutions stand out), or a placeholder banner for
// a conflict that hasn't been resolved yet (instead of dumping raw git markers).
type OutRow =
  | { kind: 'ctx' | 'ours' | 'theirs'; text: string; n: number; anchor?: number }
  | { kind: 'unresolved'; idx: number }

function buildOutputRows(segments: Segment[], sel: Selection): OutRow[] {
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
      const order = sel[seg.id] ?? []
      if (order.length === 0) {
        out.push({ kind: 'unresolved', idx })
      } else {
        let first = true // tag the first resolved line so nav can scroll here
        for (const sd of order) {
          for (const text of sd === 'ours' ? seg.ours : seg.theirs) {
            out.push(first ? { kind: sd, text, n, anchor: idx } : { kind: sd, text, n })
            n++; first = false
          }
        }
      }
    }
  }
  return out
}

// ─── Aligned side-by-side rows ────────────────────────────────────────────────
// Both panes render the SAME row list so context stays aligned and each conflict
// block occupies max(ours, theirs) rows on both sides (shorter side padded).

interface WordCache { ours?: WordDiffSegment[]; theirs?: WordDiffSegment[] }

type Row =
  | { kind: 'ctx'; text: string; oln: number; tln: number }
  | { kind: 'chead'; id: number; oCount: number; tCount: number }
  | { kind: 'cbody'; id: number; ours: string | null; theirs: string | null; oln: number | null; tln: number | null; word: WordCache }

function buildRows(segments: Segment[]): Row[] {
  const rows: Row[] = []
  let oln = 1
  let tln = 1
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s]
    if (seg.kind === 'context') {
      // Drop only the file's single trailing-newline empty element (last segment),
      // not a legitimate blank line that happens to precede a conflict.
      const isLast = s === segments.length - 1
      const lines = isLast && seg.lines[seg.lines.length - 1] === '' ? seg.lines.slice(0, -1) : seg.lines
      for (const text of lines) {
        rows.push({ kind: 'ctx', text, oln, tln })
        oln++; tln++
      }
    } else {
      rows.push({ kind: 'chead', id: seg.id, oCount: seg.ours.length, tCount: seg.theirs.length })
      const n = Math.max(seg.ours.length, seg.theirs.length)
      for (let i = 0; i < n; i++) {
        const o = i < seg.ours.length ? seg.ours[i] : null
        const t = i < seg.theirs.length ? seg.theirs[i] : null
        const word: WordCache = {}
        if (o !== null && t !== null) {
          const { oldSegments, newSegments } = computeWordDiff(o, t)
          word.ours = oldSegments
          word.theirs = newSegments
        }
        rows.push({ kind: 'cbody', id: seg.id, ours: o, theirs: t, oln: o !== null ? oln : null, tln: t !== null ? tln : null, word })
        if (o !== null) oln++
        if (t !== null) tln++
      }
    }
  }
  return rows
}

/** Render a line with word-diff highlighting of the changed spans. */
function WordDiff({ segs, changed }: { segs: WordDiffSegment[] | undefined; changed: 'added' | 'removed' }): React.JSX.Element {
  if (!segs) return <span> </span>
  return (
    <>
      {segs.map((s, i) =>
        s.type === changed ? (
          <span key={i} className={changed === 'added' ? styles.mgWordAdded : styles.mgWordRemoved}>{s.text}</span>
        ) : s.type === 'common' ? (
          <span key={i}>{s.text}</span>
        ) : null
      )}
    </>
  )
}

export function ConflictResolver({ repoPath, onResolved, onClose }: ConflictResolverProps): React.JSX.Element {
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [segments, setSegments] = useState<Segment[]>([])
  const [sel, setSel] = useState<Selection>({})
  const [manualOutput, setManualOutput] = useState<string | null>(null)
  const [sides, setSides] = useState<ConflictSides>(DEFAULT_SIDES)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolving, setResolving] = useState(false)
  const [canSkip, setCanSkip] = useState(false)
  const [activeConflict, setActiveConflict] = useState(0)
  const [editingOutput, setEditingOutput] = useState(false)
  const [outputExpanded, setOutputExpanded] = useState(true)

  const oursPaneRef = useRef<HTMLDivElement | null>(null)
  const theirsPaneRef = useRef<HTMLDivElement | null>(null)
  const cheadRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const outAnchorRefs = useRef<Map<number, HTMLElement | null>>(new Map())
  const syncing = useRef(false)

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
        setSegments(parseSegments(result.data.merged))
        setSel({})
        setManualOutput(null)
        setEditingOutput(false)
        setActiveConflict(0)
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
  const conflicts = useMemo(
    () => segments.filter((s): s is Extract<Segment, { kind: 'conflict' }> => s.kind === 'conflict'),
    [segments]
  )
  const rows = useMemo(() => buildRows(segments), [segments])
  const composedOutput = useMemo(
    () => (manualOutput !== null ? manualOutput : composeOutput(segments, sel)),
    [manualOutput, segments, sel]
  )
  const outputRows = useMemo(() => buildOutputRows(segments, sel), [segments, sel])
  const hasMarkers = editingOutput
    ? composedOutput.split('\n').some((l) => l.startsWith('<<<<<<<') || l.startsWith('>>>>>>>'))
    : conflicts.some((c) => (sel[c.id]?.length ?? 0) === 0)
  const resolvedCount = conflicts.filter((c) => (sel[c.id]?.length ?? 0) > 0).length
  const language = useMemo(() => (selectedFile ? detectLanguage(selectedFile) : null), [selectedFile])
  const bigFile = rows.length > 4000

  // ─── Selection ─────────────────────────────────────────────────────────────
  const toggleSide = useCallback((id: number, side: Side) => {
    setManualOutput(null)
    setEditingOutput(false)
    setSel((prev) => {
      const cur = prev[id] ?? []
      const next = cur.includes(side) ? cur.filter((s) => s !== side) : [...cur, side]
      return { ...prev, [id]: next }
    })
  }, [])

  const setAll = useCallback((side: Side) => {
    setManualOutput(null)
    setEditingOutput(false)
    setSel(() => {
      const next: Selection = {}
      for (const c of conflicts) next[c.id] = [side]
      return next
    })
  }, [conflicts])

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
    // Keep the output pane in step with the top panes when navigating conflicts.
    outAnchorRefs.current.get(idx)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [conflicts])

  const gotoConflict = useCallback((delta: number) => {
    setActiveConflict((prev) => {
      const next = Math.max(0, Math.min(conflicts.length - 1, prev + delta))
      scrollToConflict(next)
      return next
    })
  }, [conflicts.length, scrollToConflict])

  // ─── Mark file resolved ────────────────────────────────────────────────────
  const advanceOrRefresh = useCallback(() => {
    setFiles((prev) => prev.map((f) => (f.path === selectedFile ? { ...f, resolved: true } : f)))
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
      // No unmerged files but the step still failed. Only offer Skip for a genuine
      // empty patch (service resolved with a signal); a thrown failure (hook/GPG)
      // has no `data` and must surface its real error, never a commit-dropping Skip.
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
          <span className={styles.mgLineNo}>{side === 'ours' ? row.oln : row.tln}</span>
          <span className={styles.mgCell}><SyntaxHighlightedContent text={row.text} language={language} /></span>
        </div>
      )
    }
    if (row.kind === 'chead') {
      const order = sel[row.id] ?? []
      const on = order.includes(side)
      const pos = on ? order.indexOf(side) + 1 : 0
      const count = side === 'ours' ? row.oCount : row.tCount
      const both = order.length > 1
      return (
        <div
          className={`${styles.mgRow} ${styles.mgChead}${on ? ` ${styles.mgCheadOn}` : ''}`}
          ref={side === 'ours' ? (el) => { cheadRefs.current.set(row.id, el) } : undefined}
        >
          <span className={styles.mgCheckGutter}>
            <button
              className={`${styles.mgCheck}${on ? ` ${styles.mgCheckOn} ${side === 'ours' ? styles.mgCheckOurs : styles.mgCheckTheirs}` : ''}`}
              onClick={() => toggleSide(row.id, side)}
              title={on ? `Remove ${side === 'ours' ? sides.ours.label : sides.theirs.label}` : `Include ${side === 'ours' ? sides.ours.label : sides.theirs.label}`}
            >
              {on ? (both ? pos : <Check size={11} />) : ''}
            </button>
          </span>
          <span className={styles.mgCheadLabel}>
            {roleOf(side)}
            <span className={styles.mgCheadCount}>{count} line{count === 1 ? '' : 's'}</span>
          </span>
        </div>
      )
    }
    // cbody
    const line = side === 'ours' ? row.ours : row.theirs
    const ln = side === 'ours' ? row.oln : row.tln
    const paired = row.word.ours && row.word.theirs
    return (
      <div className={`${styles.mgRow} ${line !== null ? (side === 'ours' ? styles.mgRowOurs : styles.mgRowTheirs) : styles.mgRowBlank}`}>
        <span className={styles.mgLineNo}>{ln ?? ''}</span>
        <span className={styles.mgCell}>
          {line === null ? <span>&nbsp;</span>
            : paired ? <WordDiff segs={side === 'ours' ? row.word.ours : row.word.theirs} changed={side === 'ours' ? 'removed' : 'added'} />
              : <SyntaxHighlightedContent text={line} language={language} />}
        </span>
      </div>
    )
  }

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

        <div className={styles.mgBody}>
          {/* ── File list ─────────────────────────────────────────────────── */}
          <div className={styles.mgFileList}>
            <div className={styles.mgFileListHeader}>Conflicted files</div>
            {files.map((file) => (
              <button
                key={file.path}
                className={`${styles.mgFileItem}${selectedFile === file.path ? ` ${styles.mgActive}` : ''}${file.resolved ? ` ${styles.mgFileResolved}` : ''}`}
                onClick={() => setSelectedFile(file.path)}
                title={file.path}
              >
                <span className={`${styles.mgFileStatus}${file.resolved ? ` ${styles.mgResolved}` : ` ${styles.mgUnresolved}`}`}>
                  {file.resolved ? <Check size={12} /> : <Circle size={12} />}
                </span>
                <span className={styles.mgFileName}>{file.path.split('/').pop()}</span>
              </button>
            ))}
          </div>

          {/* ── Main resolve area ─────────────────────────────────────────── */}
          {selectedFile && !loading && (
            <div className={styles.mgContent}>
              {/* Toolbar */}
              <div className={styles.mgToolbar}>
                <div className={styles.mgNav}>
                  <button className={styles.mgNavBtn} onClick={() => gotoConflict(-1)} disabled={conflicts.length === 0 || activeConflict === 0} title="Previous conflict"><ChevronLeft size={14} /></button>
                  <span className={styles.mgNavCount}>
                    {conflicts.length === 0 ? 'No conflicts' : `Conflict ${Math.min(activeConflict + 1, conflicts.length)} / ${conflicts.length} · ${resolvedCount} resolved`}
                  </span>
                  <button className={styles.mgNavBtn} onClick={() => gotoConflict(1)} disabled={conflicts.length === 0 || activeConflict >= conflicts.length - 1} title="Next conflict"><ChevronRight size={14} /></button>
                </div>
                <div className={styles.mgAcceptAll}>
                  <button className={`${styles.mgChip} ${styles.mgChipOurs}`} onClick={() => setAll('ours')} disabled={conflicts.length === 0} title={`Take Local (${sides.ours.label}) for every conflict`}>
                    Take all Local
                  </button>
                  <button className={`${styles.mgChip} ${styles.mgChipTheirs}`} onClick={() => setAll('theirs')} disabled={conflicts.length === 0} title={`Take Remote (${sides.theirs.label}) for every conflict`}>
                    Take all Remote
                  </button>
                </div>
              </div>

              {/* Two synced full-file panes: ours | theirs */}
              {conflicts.length === 0 ? (
                <div className={styles.mgPanesEmpty}>No conflict markers in this file — review the output below and mark it resolved.</div>
              ) : (
                <div className={styles.mgPanes}>
                  <div className={styles.mgPane} ref={oursPaneRef} onScroll={() => onPaneScroll('ours')}>
                    <div className={styles.mgPaneHeader}>
                      <span className={`${styles.mgPaneDot} ${styles.mgDotOurs}`} />
                      <span className={styles.mgPaneRole}>Local</span>
                      {sides.ours.ref && <span className={styles.mgPaneBranch}>{sides.ours.ref}</span>}
                    </div>
                    <div className={styles.mgPaneBody}>
                      {bigFile ? <div className={styles.mgPanesEmpty}>File too large to preview side-by-side — use the editable output below.</div>
                        : rows.map((row, i) => <React.Fragment key={i}>{renderCell(row, 'ours')}</React.Fragment>)}
                    </div>
                  </div>
                  <div className={styles.mgPane} ref={theirsPaneRef} onScroll={() => onPaneScroll('theirs')}>
                    <div className={styles.mgPaneHeader}>
                      <span className={`${styles.mgPaneDot} ${styles.mgDotTheirs}`} />
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

              {/* Live editable output */}
              <div className={`${styles.mgOutput}${outputExpanded ? ` ${styles.mgOutputOpen}` : ''}`}>
                <div className={styles.mgOutputHeader}>
                  <button className={styles.mgOutputToggle} onClick={() => setOutputExpanded((v) => !v)}>
                    {outputExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                    <span>Output — {selectedFile.split('/').pop()}</span>
                    {hasMarkers && <span className={styles.mgOutputWarn}>· unresolved conflicts remain</span>}
                  </button>
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
                    <textarea className={styles.mgOutputEditor} value={manualOutput ?? ''} onChange={(e) => setManualOutput(e.target.value)} spellCheck={false} />
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
                            Unresolved conflict {r.idx + 1} — pick Local or Remote above
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
            </div>
          )}

          {loading && <div className={styles.mgLoading}>Loading conflict data…</div>}
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
