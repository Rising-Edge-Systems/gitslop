# Text-View Enhancements & Release Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken Windows release, stop the center text view from flashing/jumping-to-top on external file changes, and add VSCode-style find, occurrence-highlight, and inline line editing to the custom (non-Monaco) text views.

**Architecture:** Five independent parts against the existing renderer. The text views are a custom hand-rolled highlighter over `react-window`-virtualized lists (`DiffViewer.tsx`) plus non-virtualized File (`<pre>` in `RepoView`) and Blame views; Monaco powers only the separate "Edit this file" surface and keeps its own native behavior. Each part front-loads a pure, unit-tested core (loading/path decisions, match computation, editable-navigation, edit-application) and layers thin view wiring on top, so the risky UI integration rides on tested logic.

**Tech Stack:** Electron ^41.0.2 (main + preload), React ^19.2.4 + TypeScript ^5.9.3 (renderer), `react-window` ^2.2.7 (virtualization), custom tokenizer for syntax highlighting (no syntax-highlight library — do not add one), `@monaco-editor/react` ^4.7.0 (separate editor only), `node-pty` ^1.1.0 (native, Windows build-sensitive). Tests: `vitest` ^4.1.0 (`npm run test`), `@testing-library/react` ^16.3.2 + `happy-dom` via the `// @vitest-environment happy-dom` pragma. Typecheck: `npm run typecheck`.

## Global Constraints

_Every task's requirements implicitly include this section._

- **Branch:** all work lands on `feat/text-view-enhancements` (already created off `main`). Do not commit to `main`.
- **No new heavy dependencies.** Reuse `react-window` and the existing custom highlighter (`highlightLine` / `SyntaxHighlightedContent`). Do NOT add prismjs/highlight.js/shiki/CodeMirror. Monaco is already present and is used only by `CodeEditor`.
- **Canonical names (use verbatim for cross-part consistency):**
  - `type HighlightRange = { lineIndex: number; start: number; end: number }` — `start`/`end` are column offsets into the line text; `lineIndex` indexes the view's flat line model.
  - `renderWithHighlights(text, tokens, ranges, baseClass)` — per-line primitive shared by find + selection highlight; `tokens` are the existing `SyntaxToken = { text: string; className: string }`; `baseClass` ∈ `'findMatch' | 'findMatchCurrent' | 'selectionHighlight'`.
  - Find: hook `useFindController`, component `FindWidget`, CSS classes `findMatch` / `findMatchCurrent`.
  - Selection highlight: hook `useSelectionHighlight`, CSS class `selectionHighlight`.
  - Inline edit: hook `useInlineLineEdit`, pure modules `inlineEditNav.ts` + `applyLineEdits.ts`.
- **Find** works in diff inline, diff side-by-side, full, file, blame. Monaco keeps its native Ctrl+F (our handler is `enabled`-gated off while Monaco is the active editor).
- **Selection highlight** matches VSCode `editor.selectionHighlight` rules: single non-empty single-line non-whitespace selection; case-sensitive; whole-word when the selection exactly spans a word, else literal substring; the active selection's own range is not double-highlighted.
- **Inline editing is working-tree only.** Historical commit snapshots, the index view, and Blame are read-only — no edit affordance there. Pure deleted rows and hunk headers are never editable.
- **Shipping:** each Part lands as its own commit(s) + `package.json` version bump + a changelog entry in `docs/STATUS.md` (and a `docs/ROADMAP.md` "Completed" line), matching the existing house style. Parts are independently revertible.
- **Tests:** prefer extracting pure functions and unit-testing them (most reliable). Component tests use the `// @vitest-environment happy-dom` pragma + `@testing-library/react` (see `src/renderer/src/components/__tests__/ErrorBoundary.test.tsx`). Do NOT write tests that depend on `react-window` measuring real pixel layout (happy-dom gives zero height) — test the underlying pure model instead. Every task ends green on `npm run typecheck && npm run test`.

---

## Part 1 — Fix the release pipeline (Windows `node-pty` rebuild)

**Approach:** The v1.2.30 build failed only on Windows: GitHub rolled `windows-latest` to the `windows-2025-vs2026` image, and the `node-gyp` used to rebuild the native `node-pty` module during `electron-builder` packaging can't detect that toolchain (`Error: Could not find any Visual Studio installation to use` → `node-gyp failed to rebuild 'node_modules\node-pty'`). v1.2.29 built fine on the prior image. Pin the Windows runner to `windows-2022`, which ships an MSVC toolchain `node-gyp` detects. Because the failed `v1.2.30` tag points at a commit predating this fix, a re-run would still fail — so bump the version and cut a new tag after merge.

### Task 1: Pin Windows CI runner to `windows-2022` and bump version

**Files:**
- Modify: `.github/workflows/build.yml:32-37` (the build matrix `include` block)
- Modify: `package.json` (`version`)

**Interfaces:**
- Produces: a green Windows `build` job; a new release version `1.2.31` to tag after merge.

- [ ] **Step 1: Pin the Windows matrix entry.** In `.github/workflows/build.yml`, change the Windows matrix include from:

```yaml
          - os: windows-latest
            platform: win
```

to (add the explanatory comment):

```yaml
          # Pinned: windows-latest rolled to the windows-2025-vs2026 image, whose
          # toolchain node-gyp can't detect, breaking the native node-pty rebuild.
          # windows-2022 ships an MSVC toolchain node-gyp finds. (v1.2.30 release failure)
          - os: windows-2022
            platform: win
```

- [ ] **Step 2: Bump the version.** In `package.json`, change `"version": "1.2.30"` to `"version": "1.2.31"`.

- [ ] **Step 3: Verify the workflow YAML is valid and the app still builds locally.**

Run: `npm run typecheck && npm run build`
Expected: typecheck passes; `electron-vite build` completes with no errors (this validates the app build; the native rebuild itself is exercised by CI on Windows).

- [ ] **Step 4: Commit.**

```bash
git add .github/workflows/build.yml package.json
git commit -m "fix(ci): pin Windows runner to windows-2022 so node-gyp can rebuild node-pty; bump to 1.2.31"
```

- [ ] **Step 5: Release handoff (after this branch merges to `main`).** Tag the merge commit `v1.2.31` and push the tag to trigger the `release` job:

```bash
# run on main after merge — NOT on the feature branch
git tag -a v1.2.31 -m "GitSlop 1.2.31 — Windows CI fix + text-view enhancements"
git push origin v1.2.31
```

Expected: the `build` matrix (incl. Windows) goes green and the `release` job publishes the GitHub Release. _Do not perform Step 5 until the user approves the merge; tagging is the release trigger._

---

## Part 2 — Scroll-preserving, path-aware refresh

**Approach:** The center text view flashes and jumps to top on every external file change because `onRepoChanged` bumps `workingTreeRefreshKey`, and each working-tree loader unconditionally sets `loading=true` (and the full loader nulls its content), tripping the render gates at RepoView.tsx:815/848/882 so the viewer unmounts to a placeholder and remounts a fresh `react-window` List at `scrollTop=0`. We fix this with three coordinated changes, each behind a unit-tested pure helper: (1) only show the spinner on a genuine load or identity change, otherwise fetch silently and swap in place; (2) a belt-and-suspenders scroll restore for the non-virtualized file `<pre>` view; (3) make `repo:changed` carry the changed repo-relative paths so RepoView refetches the open file only when it is actually affected, while every other subscriber that ignores the new arg keeps working.

### Task 1: Silent background refresh (no "Loading…" flash, scroll preserved by staying mounted)

The core fix. Extract a pure "should we show the spinner?" decision and wire it into all three working-tree loaders so a bare `workingTreeRefreshKey` bump (same file) fetches silently and swaps content under the still-mounted viewer; `react-window` keeps its scroll offset because the List is never unmounted.

**Files:**
- Create `src/renderer/src/components/loadingDecision.ts`
- Create test `src/renderer/src/components/__tests__/loadingDecision.test.ts`
- Modify `src/renderer/src/components/RepoView.tsx` (add identity/mirror refs after line 144; diff loader 213–245; file loader 395–422; full loader 433–481)

**Interfaces:**
- Produces `export interface LoadingDecisionInput { identityChanged: boolean; hasCurrentContent: boolean }`
- Produces `export function shouldShowLoadingSpinner(input: LoadingDecisionInput): boolean`
- Consumes existing state: `workingTreeFile`, `workingTreeDiff`, `fileContent`, `fullOldContent`, `fullNewContent`, setters, `workingTreeRefreshKey`.

Steps:
- [ ] Write the failing test `loadingDecision.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { shouldShowLoadingSpinner } from '../loadingDecision'

describe('shouldShowLoadingSpinner', () => {
  it('shows on first load (identity changed, no content yet)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: true, hasCurrentContent: false })).toBe(true)
  })
  it('shows when switching to a different file (identity changed, content present)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: true, hasCurrentContent: true })).toBe(true)
  })
  it('stays silent on a background refresh of the same file', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: false, hasCurrentContent: true })).toBe(false)
  })
  it('shows when the same identity has no content yet (view toggled before first fetch)', () => {
    expect(shouldShowLoadingSpinner({ identityChanged: false, hasCurrentContent: false })).toBe(true)
  })
})
```
- [ ] Run it (expected FAIL — module missing): `npm run test -- loadingDecision`
- [ ] Minimal implementation `loadingDecision.ts`:
```ts
export interface LoadingDecisionInput {
  identityChanged: boolean
  hasCurrentContent: boolean
}

/**
 * Show the loading spinner only on a genuine (first) load or when the open
 * target changed. On a pure background refresh (same identity, content already
 * present) return false so the loader can fetch silently and swap in place.
 */
export function shouldShowLoadingSpinner({ identityChanged, hasCurrentContent }: LoadingDecisionInput): boolean {
  return identityChanged || !hasCurrentContent
}
```
- [ ] Run (expected PASS): `npm run test -- loadingDecision`
- [ ] Add the import and identity/mirror refs in `RepoView.tsx`. Add to the React import on line 1 (it already imports `useMemo`/`useRef`), and add `import { shouldShowLoadingSpinner } from './loadingDecision'` near the other component imports. Immediately after line 144 (`const [workingTreeRefreshKey, setWorkingTreeRefreshKey] = useState(0)`) insert:
```ts
// Identity = path|staged|untracked. A change means a DIFFERENT file/version is
// open → show the spinner. A bare refreshKey bump keeps the same identity →
// fetch silently and swap content in place (no flash; react-window keeps scroll).
const workingTreeIdentity = useMemo(
  () => (workingTreeFile ? `${workingTreeFile.path}|${workingTreeFile.staged}|${workingTreeFile.isUntracked}` : null),
  [workingTreeFile]
)
const diffIdentityRef = useRef<string | null>(null)
const fileIdentityRef = useRef<string | null>(null)
const fullIdentityRef = useRef<string | null>(null)
// Mirror refs: read "do we have content?" inside loaders WITHOUT putting the
// content state in their deps (that would loop the silent re-fetch).
const workingTreeDiffRef = useRef(workingTreeDiff)
workingTreeDiffRef.current = workingTreeDiff
const fileContentRef = useRef(fileContent)
fileContentRef.current = fileContent
const fullReadyRef = useRef(false)
fullReadyRef.current = fullOldContent !== null && fullNewContent !== null
```
- [ ] Diff loader (lines 213–215): replace
```ts
    let cancelled = false
    setWorkingTreeDiffLoading(true)
    setWorkingTreeDiffError(null)
```
with
```ts
    let cancelled = false
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== diffIdentityRef.current,
      hasCurrentContent: workingTreeDiffRef.current !== null
    })
    if (showSpinner) setWorkingTreeDiffLoading(true)
    setWorkingTreeDiffError(null)
```
and change the `.finally` (line 243–245) to also record identity:
```ts
      .finally(() => {
        if (!cancelled) {
          setWorkingTreeDiffLoading(false)
          diffIdentityRef.current = workingTreeIdentity
        }
      })
```
- [ ] File loader (working-tree, lines 395–397): replace
```ts
    let cancelled = false
    setFileLoading(true)
    setFileError(null)
```
with
```ts
    let cancelled = false
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== fileIdentityRef.current,
      hasCurrentContent: fileContentRef.current !== null
    })
    if (showSpinner) setFileLoading(true)
    setFileError(null)
```
and update its `.finally` (lines 420–422):
```ts
      .finally(() => {
        if (!cancelled) {
          setFileLoading(false)
          fileIdentityRef.current = workingTreeIdentity
        }
      })
```
- [ ] Full loader (working-tree, lines 433–437): replace
```ts
    let cancelled = false
    setFullLoading(true)
    setFullError(null)
    setFullOldContent(null)
    setFullNewContent(null)
```
with (note: stop nulling content unless we are actually showing the spinner — this is what keeps the gate at line 848 satisfied during a silent swap)
```ts
    let cancelled = false
    const showSpinner = shouldShowLoadingSpinner({
      identityChanged: workingTreeIdentity !== fullIdentityRef.current,
      hasCurrentContent: fullReadyRef.current
    })
    if (showSpinner) {
      setFullLoading(true)
      setFullOldContent(null)
      setFullNewContent(null)
    }
    setFullError(null)
```
and update its `.finally` (lines 479–481):
```ts
      .finally(() => {
        if (!cancelled) {
          setFullLoading(false)
          fullIdentityRef.current = workingTreeIdentity
        }
      })
```
- [ ] Run typecheck + full test suite (expected PASS): `npm run typecheck && npm run test`
- [ ] Verify in app: `npm run dev`. Open an unstaged file in **Diff**, **Full**, and **File** views in turn; scroll to the bottom; edit the file in another editor and save. Expected: content updates in place, NO "Loading…" flash, scroll position is retained. Then click a DIFFERENT file: spinner is allowed and view resets to top (correct).
- [ ] Commit:
```
git add src/renderer/src/components/loadingDecision.ts src/renderer/src/components/__tests__/loadingDecision.test.ts src/renderer/src/components/RepoView.tsx
git commit -m "fix: silent in-place refresh of open working-tree view (no Loading flash, keep scroll)"
```

### Task 2: Scroll-restore safety net for the non-virtualized File view

The diff/full views keep scroll automatically (react-window's List is no longer unmounted after Task 1). The plain `<pre>` File view scrolls on its own `.fullFileViewer` div (CSS `overflow:auto`, RepoView.module.css:242-246), which Task 1 also keeps mounted — but we add an explicit capture/restore as a guard against any future remount, using a unit-tested clamp helper.

**Files:**
- Create `src/renderer/src/components/scrollPreserve.ts`
- Create test `src/renderer/src/components/__tests__/scrollPreserve.test.ts`
- Modify `src/renderer/src/components/RepoView.tsx` (add `useLayoutEffect` to React import on line 1; add two refs near the Task 1 refs; capture in the file loader at ~line 397; new layout effect after the file loader effect ~line 424; attach ref on `.fullFileViewer` at line 883)

**Interfaces:**
- Produces `export function clampRestoreScrollTop(saved: number, maxScrollTop: number): number`
- Consumes `fileContent` (effect key), `fileViewScrollRef` (HTMLDivElement on `.fullFileViewer`).

Steps:
- [ ] Write the failing test `scrollPreserve.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { clampRestoreScrollTop } from '../scrollPreserve'

describe('clampRestoreScrollTop', () => {
  it('returns the saved offset when it still fits', () => {
    expect(clampRestoreScrollTop(120, 500)).toBe(120)
  })
  it('clamps to the new max when the content shrank', () => {
    expect(clampRestoreScrollTop(900, 300)).toBe(300)
  })
  it('never returns a negative offset', () => {
    expect(clampRestoreScrollTop(-10, 500)).toBe(0)
  })
  it('clamps to 0 when content is shorter than the viewport (negative max)', () => {
    expect(clampRestoreScrollTop(120, -40)).toBe(0)
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- scrollPreserve`
- [ ] Minimal implementation `scrollPreserve.ts`:
```ts
/** Clamp a previously-saved scrollTop into the valid range of the new content. */
export function clampRestoreScrollTop(saved: number, maxScrollTop: number): number {
  const ceiling = Math.max(0, maxScrollTop)
  return Math.max(0, Math.min(saved, ceiling))
}
```
- [ ] Run (expected PASS): `npm run test -- scrollPreserve`
- [ ] Wire into `RepoView.tsx`. On line 1 add `useLayoutEffect` to the React import; add `import { clampRestoreScrollTop } from './scrollPreserve'`. Next to the Task 1 refs add:
```ts
const fileViewScrollRef = useRef<HTMLDivElement>(null)
const pendingFileScrollRef = useRef<number | null>(null)
```
- [ ] In the working-tree file loader, in the `else` of the spinner decision added in Task 1, capture the current offset right before the silent swap. Change the `if (showSpinner) setFileLoading(true)` line to:
```ts
    if (showSpinner) setFileLoading(true)
    else pendingFileScrollRef.current = fileViewScrollRef.current?.scrollTop ?? null
```
- [ ] Immediately after the working-tree file loader effect (after its closing `}, [centerViewMode, workingTreeFile, repoPath, workingTreeRefreshKey])` at line 424) add the restore effect:
```ts
// Safety net: after a silent File-view swap, restore the captured scroll offset
// (clamped to the new content height). No-op for first loads (pending == null).
useLayoutEffect(() => {
  const el = fileViewScrollRef.current
  const target = pendingFileScrollRef.current
  if (el && target != null) {
    el.scrollTop = clampRestoreScrollTop(target, el.scrollHeight - el.clientHeight)
  }
  pendingFileScrollRef.current = null
}, [fileContent])
```
- [ ] Attach the ref. At line 883 change `<div className={styles.fullFileViewer}>` to `<div className={styles.fullFileViewer} ref={fileViewScrollRef}>`.
- [ ] Run typecheck + tests (expected PASS): `npm run typecheck && npm run test`
- [ ] Verify in app: `npm run dev`. Open a long file in **File** view, scroll halfway, edit-and-save externally; offset is retained. Delete many lines externally so the file is shorter than the viewport and save; view stays at top (no overscroll). 
- [ ] Commit:
```
git add src/renderer/src/components/scrollPreserve.ts src/renderer/src/components/__tests__/scrollPreserve.test.ts src/renderer/src/components/RepoView.tsx
git commit -m "feat: scroll-restore safety net for File view across in-place refresh"
```

### Task 3: Pure path-collection helpers in the watcher (relativize + drain)

Add the path-collection machinery to the already-tested `watcher-utils.ts` module so the main process can accumulate changed repo-relative paths across the 500ms debounce window and drain them as the IPC payload. Pure and fully unit-tested.

**Files:**
- Modify `src/main/watcher-utils.ts` (`WatcherState` interface lines 6–10; `createWatcherState` lines 12–18; append three functions after `shouldIgnorePath` at line 114)
- Modify test `src/main/__tests__/watcher-utils.test.ts` (extend imports on lines 2–11; append describe blocks)

**Interfaces:**
- Produces `toRepoRelativePath(absPath: string, repoPath: string | null): string | null`
- Produces `recordChangedPath(state: WatcherState, absPath: string | undefined, repoPath: string | null): void`
- Produces `drainChangedPaths(state: WatcherState): string[] | null` (returns `null` = "broad/unknown scope, refetch everything")
- Modifies `WatcherState` to add `changedPaths: Set<string>` and `broadChange: boolean`.

Steps:
- [ ] Write the failing tests. Add `toRepoRelativePath, recordChangedPath, drainChangedPaths` to the import on lines 2–11 of `watcher-utils.test.ts`, then append:
```ts
describe('toRepoRelativePath', () => {
  it('relativizes a unix path inside the repo', () => {
    expect(toRepoRelativePath('/repo/src/a.ts', '/repo')).toBe('src/a.ts')
  })
  it('relativizes a windows path and normalizes separators to /', () => {
    expect(toRepoRelativePath('C:\\repo\\src\\a.ts', 'C:\\repo')).toBe('src/a.ts')
  })
  it('returns null for the repo root itself', () => {
    expect(toRepoRelativePath('/repo', '/repo')).toBe(null)
  })
  it('returns null for a path outside the repo', () => {
    expect(toRepoRelativePath('/other/x.ts', '/repo')).toBe(null)
  })
  it('returns null when repoPath is null', () => {
    expect(toRepoRelativePath('/repo/src/a.ts', null)).toBe(null)
  })
})

describe('recordChangedPath / drainChangedPaths', () => {
  it('accumulates relativized paths, dedupes, drains once', () => {
    const s = createWatcherState()
    recordChangedPath(s, '/repo/src/a.ts', '/repo')
    recordChangedPath(s, '/repo/src/b.ts', '/repo')
    recordChangedPath(s, '/repo/src/a.ts', '/repo')
    expect(drainChangedPaths(s)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(drainChangedPaths(s)).toEqual([])
  })
  it('marks broad scope (null) on a path-less event', () => {
    const s = createWatcherState()
    recordChangedPath(s, '/repo/src/a.ts', '/repo')
    recordChangedPath(s, undefined, '/repo')
    expect(drainChangedPaths(s)).toBe(null)
  })
  it('marks broad scope when a path falls outside the repo', () => {
    const s = createWatcherState()
    recordChangedPath(s, '/elsewhere/x.ts', '/repo')
    expect(drainChangedPaths(s)).toBe(null)
  })
  it('resets broadChange after draining', () => {
    const s = createWatcherState()
    recordChangedPath(s, undefined, '/repo')
    expect(drainChangedPaths(s)).toBe(null)
    recordChangedPath(s, '/repo/a.ts', '/repo')
    expect(drainChangedPaths(s)).toEqual(['a.ts'])
  })
})
```
- [ ] Run it (expected FAIL — exports missing): `npm run test -- watcher-utils`
- [ ] Extend `WatcherState` (lines 6–10) to:
```ts
export interface WatcherState {
  suppressedUntil: number
  activeGitOperations: number
  debounceTimer: ReturnType<typeof setTimeout> | null
  changedPaths: Set<string>
  broadChange: boolean
}
```
- [ ] Extend `createWatcherState` return (lines 13–17) to include `changedPaths: new Set<string>()` and `broadChange: false`.
- [ ] Append after line 114 (`shouldIgnorePath`):
```ts
/**
 * Convert an absolute fs path to a repo-relative path with forward slashes.
 * Returns null for the repo root itself or any path outside the repo.
 */
export function toRepoRelativePath(absPath: string, repoPath: string | null): string | null {
  if (!repoPath) return null
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(absPath)
  const r = norm(repoPath)
  if (a === r) return null
  if (!a.startsWith(r + '/')) return null
  return a.slice(r.length + 1)
}

/**
 * Record one changed path into the pending set. A missing path, or any path
 * that cannot be relativized into the repo, escalates the window to "broad
 * scope" so subscribers refetch everything.
 */
export function recordChangedPath(state: WatcherState, absPath: string | undefined, repoPath: string | null): void {
  if (!absPath) {
    state.broadChange = true
    return
  }
  const rel = toRepoRelativePath(absPath, repoPath)
  if (rel === null) {
    state.broadChange = true
    return
  }
  state.changedPaths.add(rel)
}

/**
 * Drain the accumulated changes for one IPC send. Returns null when the window
 * was broad-scope (unknown set), else the deduped list of repo-relative paths.
 * Resets state either way.
 */
export function drainChangedPaths(state: WatcherState): string[] | null {
  const result = state.broadChange ? null : [...state.changedPaths]
  state.changedPaths.clear()
  state.broadChange = false
  return result
}
```
- [ ] Run (expected PASS): `npm run test -- watcher-utils`
- [ ] Commit:
```
git add src/main/watcher-utils.ts src/main/__tests__/watcher-utils.test.ts
git commit -m "feat: collect changed repo-relative paths in watcher state"
```

### Task 4: Plumb changed paths through `repo:changed` (main → preload → type), additively

Send the drained payload on `repo:changed` and widen the renderer-facing callback type to accept it. Every existing subscriber (CommitGraph, FileTree, Sidebar ×5, StatusBar, StatusPanel, TitleBar, RepoView) passes a `() => void` callback, which remains assignable, so this is non-breaking.

**Files:**
- Modify `src/main/index.ts` (import lines 20–27; `sendRepoChangedForced` lines 2114–2122; `sendRepoChanged` lines 2124–2143; activeWatcher handlers 2217–2221; root handlers 2245–2266; gitRefWatcher handlers 2289–2294)
- Modify `src/preload/index.ts` (`onRepoChanged` lines 393–401)
- Modify `src/renderer/src/hooks/useLayoutState.ts` (type on line 198)

**Interfaces:**
- Consumes `recordChangedPath`, `drainChangedPaths` (Task 3).
- Modifies preload `onRepoChanged(callback: (changedPaths: string[] | null) => void): () => void`
- Modifies IPC: `win.webContents.send('repo:changed', payload)` where `payload: string[] | null`.

Steps:
- [ ] Add to the watcher-utils import block (lines 20–27 of `index.ts`): `recordChangedPath,` and `drainChangedPaths,`.
- [ ] Change `sendRepoChangedForced` (lines 2117–2120) to send a `null` payload (forced sends are always broad scope — our own git op may touch index/refs):
```ts
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('repo:changed', null)
    }
```
- [ ] Rewrite `sendRepoChanged` (lines 2124–2143) to accept the changed path, record it, and send the drained payload on flush:
```ts
function sendRepoChanged(changedPath?: string): void {
  // Accumulate the path even while suppressed; it drains on the next real send.
  recordChangedPath(watcherState, changedPath, watchedRepoPath)
  if (_isWatcherSuppressed(watcherState)) {
    return
  }
  if (watcherState.debounceTimer) {
    clearTimeout(watcherState.debounceTimer)
  }
  watcherState.debounceTimer = setTimeout(() => {
    if (_isWatcherSuppressed(watcherState)) {
      return
    }
    const payload = drainChangedPaths(watcherState)
    const win = BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('repo:changed', payload)
    }
  }, 500)
}
```
- [ ] Pass the chokidar path through the file-level handlers. Change the activeWatcher handlers (lines 2217–2219) to forward the path; leave dir handlers path-less (they escalate to broad scope, which is correct):
```ts
    activeWatcher.on('add', (p: string) => sendRepoChanged(p))
    activeWatcher.on('change', (p: string) => sendRepoChanged(p))
    activeWatcher.on('unlink', (p: string) => sendRepoChanged(p))
    activeWatcher.on('addDir', () => sendRepoChanged())
    activeWatcher.on('unlinkDir', () => sendRepoChanged())
```
- [ ] In `handleRootEvent` (line 2245) forward the path it already receives: change its body's `sendRepoChanged()` (line 2246) to `sendRepoChanged(changedPath)`. The `add`/`change`/`unlink` root bindings (lines 2259–2261) already pass `handleRootEvent` which receives the path; leave `addDir`/`unlinkDir` (2262–2263) path-less.
- [ ] Leave the gitRefWatcher handlers (lines 2289–2291) path-less: HEAD/refs changes affect the whole repo, so `() => sendRepoChanged()` correctly escalates to broad scope (`null` payload → refetch).
- [ ] Update preload `onRepoChanged` (lines 393–401) to forward the payload:
```ts
  onRepoChanged: (callback: (changedPaths: string[] | null) => void): (() => void) => {
    const handler = (_e: unknown, changedPaths?: string[] | null): void => {
      callback(changedPaths ?? null)
    }
    ipcRenderer.on('repo:changed', handler)
    return () => {
      ipcRenderer.removeListener('repo:changed', handler)
    }
  },
```
- [ ] Update the global type at `useLayoutState.ts:198` to:
```ts
      onRepoChanged: (callback: (changedPaths: string[] | null) => void) => () => void
```
- [ ] Run typecheck (expected PASS — all 12 `() => void` subscribers stay assignable to `(changedPaths) => void`): `npm run typecheck && npm run test`
- [ ] Verify in app: `npm run dev`, open DevTools console, add a temporary `console.log('[repo:changed]', changedPaths)` in RepoView's handler. Edit one file externally → log shows `['relative/path.ext']`. Run a CLI commit → log shows `null`. Remove the temporary log.
- [ ] Commit:
```
git add src/main/index.ts src/preload/index.ts src/renderer/src/hooks/useLayoutState.ts
git commit -m "feat: repo:changed carries changed repo-relative paths (additive payload)"
```

### Task 5: Path-aware refetch — only re-run loaders when the open file is affected

Gate RepoView's `workingTreeRefreshKey` bump on whether the open file is in the changed set, while keeping the conflict check (and every other subscriber) unconditional. A `null`/empty payload (forced or path-less event) always refetches, preserving today's behavior.

**Files:**
- Create `src/renderer/src/components/repoChangeFilter.ts`
- Create test `src/renderer/src/components/__tests__/repoChangeFilter.test.ts`
- Modify `src/renderer/src/components/RepoView.tsx` (add `workingTreeFileRef` near Task 1 refs; onRepoChanged handler lines 576–592)

**Interfaces:**
- Produces `isOpenFileAffected(openPath: string, staged: boolean, changedPaths: string[] | null | undefined): boolean`
- Consumes the `changedPaths` arg now delivered by `onRepoChanged` (Task 4) and `workingTreeFile` (`{ path; staged; isUntracked }`).

Steps:
- [ ] Write the failing test `repoChangeFilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isOpenFileAffected } from '../repoChangeFilter'

describe('isOpenFileAffected', () => {
  it('refetches when the open file is in the changed set', () => {
    expect(isOpenFileAffected('src/a.ts', false, ['src/a.ts', 'src/b.ts'])).toBe(true)
  })
  it('does NOT refetch when only other files changed', () => {
    expect(isOpenFileAffected('src/a.ts', false, ['src/b.ts'])).toBe(false)
  })
  it('refetches on a null payload (forced/global event)', () => {
    expect(isOpenFileAffected('src/a.ts', false, null)).toBe(true)
    expect(isOpenFileAffected('src/a.ts', true, undefined)).toBe(true)
  })
  it('refetches on an empty payload (path-less watcher event)', () => {
    expect(isOpenFileAffected('src/a.ts', false, [])).toBe(true)
  })
  it('still refetches a staged view when its path is in the set', () => {
    expect(isOpenFileAffected('src/a.ts', true, ['src/a.ts'])).toBe(true)
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- repoChangeFilter`
- [ ] Minimal implementation `repoChangeFilter.ts`:
```ts
/**
 * Decide whether the file open in the center view should refetch given the
 * paths reported by repo:changed.
 *   null/undefined → unknown scope (forced/global, e.g. our own git op or a
 *                    HEAD/ref change) → refetch (legacy behavior).
 *   empty array    → a path-less watcher event (addDir/unlinkDir) → refetch.
 *   otherwise      → refetch iff the open path is in the changed set.
 * Index-only staged edits by external tools arrive as forced (null) events, so
 * staged views are still kept fresh; `staged` is accepted for call-site clarity.
 */
export function isOpenFileAffected(
  openPath: string,
  staged: boolean,
  changedPaths: string[] | null | undefined
): boolean {
  if (changedPaths == null) return true
  if (changedPaths.length === 0) return true
  void staged
  return changedPaths.includes(openPath)
}
```
- [ ] Run (expected PASS): `npm run test -- repoChangeFilter`
- [ ] Wire into `RepoView.tsx`. Add `import { isOpenFileAffected } from './repoChangeFilter'`. Near the Task 1 refs add a mirror ref (the onRepoChanged effect only depends on `repoPath`, so it must read the live file through a ref):
```ts
const workingTreeFileRef = useRef(workingTreeFile)
workingTreeFileRef.current = workingTreeFile
```
- [ ] Replace the onRepoChanged effect (lines 576–592) with the path-aware version (conflict check stays unconditional; only the refresh-key bump is gated):
```ts
  useEffect(() => {
    const cleanup = window.electronAPI.onRepoChanged?.((changedPaths) => {
      window.electronAPI.git.getConflictedFiles(repoPath).then((result) => {
        if (result.success && Array.isArray(result.data)) {
          const nowHasConflicts = result.data.length > 0
          setHasConflicts(nowHasConflicts)
          if (!nowHasConflicts) setShowConflictResolver(false)
        }
      })
      // Path-aware center refresh: only re-run the working-tree loaders when the
      // file open in the center view actually changed (or scope is unknown).
      const open = workingTreeFileRef.current
      if (open && isOpenFileAffected(open.path, open.staged, changedPaths)) {
        setWorkingTreeRefreshKey((k) => k + 1)
      }
    })
    return () => { cleanup?.() }
  }, [repoPath])
```
- [ ] Run typecheck + tests (expected PASS): `npm run typecheck && npm run test`
- [ ] Verify in app: `npm run dev`. Open file A in the center view, scroll within it. Externally edit a DIFFERENT file B → center view stays completely untouched (no fetch, no scroll change); the Sidebar/StatusPanel still update their file lists. Then externally edit file A → its center view refreshes in place. Stage A via the app → forced event (null) still refreshes the staged view.
- [ ] Commit:
```
git add src/renderer/src/components/repoChangeFilter.ts src/renderer/src/components/__tests__/repoChangeFilter.test.ts src/renderer/src/components/RepoView.tsx
git commit -m "feat: refetch open center view only when its file actually changed"
```

### Task 6: Integration verification of the full scroll-preserving, path-aware refresh

No new code — an end-to-end confirmation that the three changes compose, plus a regression guard that the whole suite is green.

**Files:** none (verification only).

Steps:
- [ ] Run the full suite + typecheck (expected PASS): `npm run typecheck && npm run test`
- [ ] Confirm the new pure helpers are covered: `npm run test -- loadingDecision scrollPreserve repoChangeFilter watcher-utils` — all green.
- [ ] Manual matrix in `npm run dev` (open repo with at least two changed files A and B):
  - [ ] **A in Diff view**, scrolled to bottom → edit A externally → updates in place, no flash, scroll kept; edit B externally → A untouched.
  - [ ] **A in Full view**, scrolled mid-file → edit A externally → side-by-side updates in place, no flash, scroll kept.
  - [ ] **A in File view**, scrolled mid-file → edit A externally → updates in place, scroll kept; externally shrink A below viewport height → view clamps to top, no overscroll.
  - [ ] **Switch from A to B** (click in sidebar) → spinner allowed, view resets to top (identity changed — correct, not a regression).
  - [ ] **Stage A in the app** while A's staged view is open → staged content refreshes (forced null payload path).
  - [ ] **External CLI commit** → graph/refs update; if a working-tree file is open it refreshes (null payload).
- [ ] If every cell passes, the part is complete. No commit (verification only).

---

Key file paths for assembly: `src/renderer/src/components/loadingDecision.ts`, `scrollPreserve.ts`, `repoChangeFilter.ts` (+ their `__tests__/*.test.ts`), `src/main/watcher-utils.ts` (+ `src/main/__tests__/watcher-utils.test.ts`), `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/hooks/useLayoutState.ts`, `src/renderer/src/components/RepoView.tsx`.

---

## Part 3 — Ctrl+F Find

Approach: front-load a fully pure, unit-tested highlight core (`src/renderer/src/utils/textHighlight.tsx`) that both Find and Highlight-occurrences consume. The renderer keeps the canonical `renderWithHighlights(text, tokens, ranges, baseClass)` signature but each `HighlightRange` carries an optional `className` so the "current" find match can render in a different color through the same code path. Each text view owns its own `useFindController` over its own flat line model (the cleanest fit for the existing per-view architecture); `RepoView` registers Ctrl+F and toggles a shared `findOpen` flag down into whichever view is active. View-wiring tasks (5–7) can't be meaningfully unit-tested under happy-dom (react-window lays out at zero height), so they ship with `npm run typecheck` + a precise `npm run dev` manual check, but every helper they rely on is pure and tested in Tasks 1–2. Regex find is explicitly OUT of scope (fast-follow: add a `regex` opt to `computeMatches` and a third toggle to `FindWidget`).

### Task 1: Pure match model — `computeMatches` + `HighlightRange`

**Files:**
- Create: `src/renderer/src/utils/textHighlight.tsx`
- Test: `src/renderer/src/utils/__tests__/textHighlight.test.ts`

**Interfaces:**
- Produces: `interface HighlightRange { lineIndex: number; start: number; end: number; className?: string }`
- Produces: `interface FindOpts { caseSensitive: boolean; wholeWord: boolean }`
- Produces: `function computeMatches(lines: { text: string }[], query: string, opts: FindOpts): HighlightRange[]`

Steps:
- [ ] Write the failing test `src/renderer/src/utils/__tests__/textHighlight.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeMatches } from '../textHighlight'

const L = (...t: string[]) => t.map((text) => ({ text }))

describe('computeMatches', () => {
  it('returns [] for empty query', () => {
    expect(computeMatches(L('hello world'), '', { caseSensitive: false, wholeWord: false })).toEqual([])
  })
  it('finds case-insensitive matches by default', () => {
    expect(computeMatches(L('Foo foo FOO'), 'foo', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 3 },
      { lineIndex: 0, start: 4, end: 7 },
      { lineIndex: 0, start: 8, end: 11 }
    ])
  })
  it('respects case sensitivity', () => {
    expect(computeMatches(L('Foo foo'), 'foo', { caseSensitive: true, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 4, end: 7 }
    ])
  })
  it('is non-overlapping (aa in aaaa = 2 matches)', () => {
    expect(computeMatches(L('aaaa'), 'aa', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 2 },
      { lineIndex: 0, start: 2, end: 4 }
    ])
  })
  it('whole-word only matches at word boundaries', () => {
    expect(computeMatches(L('cat catalog scatter cat'), 'cat', { caseSensitive: false, wholeWord: true })).toEqual([
      { lineIndex: 0, start: 0, end: 3 },
      { lineIndex: 0, start: 20, end: 23 }
    ])
  })
  it('tracks lineIndex across multiple lines', () => {
    expect(computeMatches(L('x', 'ax', 'x'), 'x', { caseSensitive: false, wholeWord: false })).toEqual([
      { lineIndex: 0, start: 0, end: 1 },
      { lineIndex: 1, start: 1, end: 2 },
      { lineIndex: 2, start: 0, end: 1 }
    ])
  })
})
```
- [ ] Run it (expected FAIL — module missing): `npm run test -- textHighlight`
- [ ] Minimal implementation — create `src/renderer/src/utils/textHighlight.tsx`:
```tsx
export interface HighlightRange {
  lineIndex: number
  start: number
  end: number
  /** Optional per-range override; renderWithHighlights falls back to baseClass. */
  className?: string
}

export interface FindOpts {
  caseSensitive: boolean
  wholeWord: boolean
}

const WORD_CHAR = /[A-Za-z0-9_]/

export function computeMatches(
  lines: { text: string }[],
  query: string,
  opts: FindOpts
): HighlightRange[] {
  const ranges: HighlightRange[] = []
  if (!query) return ranges
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const raw = lines[lineIndex].text
    const hay = opts.caseSensitive ? raw : raw.toLowerCase()
    let from = 0
    while (from <= hay.length - needle.length) {
      const idx = hay.indexOf(needle, from)
      if (idx === -1) break
      const end = idx + needle.length
      if (opts.wholeWord) {
        const before = idx > 0 ? raw[idx - 1] : ''
        const after = end < raw.length ? raw[end] : ''
        if ((before && WORD_CHAR.test(before)) || (after && WORD_CHAR.test(after))) {
          from = idx + 1
          continue
        }
      }
      ranges.push({ lineIndex, start: idx, end })
      from = end // non-overlapping
    }
  }
  return ranges
}
```
- [ ] Run (expected PASS): `npm run test -- textHighlight`
- [ ] Commit: `git add -A && git commit -m "feat(find): pure computeMatches + HighlightRange model"`

### Task 2: Segment splitter + `renderWithHighlights` + gutter mark math

**Files:**
- Modify: `src/renderer/src/utils/textHighlight.tsx` (append to file from Task 1)
- Test: `src/renderer/src/utils/__tests__/textHighlight.test.ts` (append)

**Interfaces:**
- Consumes: `SyntaxToken = { text: string; className: string }` (structural match of `highlightLine`'s return in `DiffViewer.tsx:161`)
- Produces: `interface HighlightSegment { text: string; className: string; markClass: string | null }`
- Produces: `function buildHighlightSegments(tokens: SyntaxToken[], ranges: HighlightRange[], baseClass: string): HighlightSegment[]`
- Produces: `function renderWithHighlights(text: string, tokens: SyntaxToken[], ranges: HighlightRange[], baseClass: string): React.ReactNode`
- Produces: `interface FindMark { position: number; current: boolean }` and `function computeFindMarks(lineIndexes: number[], totalRows: number, currentIndex: number): FindMark[]`

Steps:
- [ ] Write the failing test (append):
```ts
import { buildHighlightSegments, computeFindMarks } from '../textHighlight'

const tok = (text: string, className = '') => ({ text, className })

describe('buildHighlightSegments', () => {
  it('returns one unhighlighted segment when no ranges', () => {
    expect(buildHighlightSegments([tok('hello')], [], 'findMatch')).toEqual([
      { text: 'hello', className: '', markClass: null }
    ])
  })
  it('splits a single plain token around one range', () => {
    expect(buildHighlightSegments([tok('foobar')], [{ lineIndex: 0, start: 3, end: 6 }], 'findMatch')).toEqual([
      { text: 'foo', className: '', markClass: null },
      { text: 'bar', className: '', markClass: 'findMatch' }
    ])
  })
  it('splits a match that straddles two syntax tokens, preserving classes', () => {
    // tokens: "fo"(syn-keyword) + "obar"(""), match cols 1..4 = "oob"
    expect(buildHighlightSegments(
      [tok('fo', 'syn-keyword'), tok('obar')],
      [{ lineIndex: 0, start: 1, end: 4 }],
      'findMatch'
    )).toEqual([
      { text: 'f', className: 'syn-keyword', markClass: null },
      { text: 'o', className: 'syn-keyword', markClass: 'findMatch' },
      { text: 'ob', className: '', markClass: 'findMatch' },
      { text: 'ar', className: '', markClass: null }
    ])
  })
  it('uses the range className override when present (current match)', () => {
    expect(buildHighlightSegments([tok('abc')], [{ lineIndex: 0, start: 0, end: 3, className: 'findMatchCurrent' }], 'findMatch')).toEqual([
      { text: 'abc', className: '', markClass: 'findMatchCurrent' }
    ])
  })
})

describe('computeFindMarks', () => {
  it('maps line indexes to proportional positions and flags the current', () => {
    expect(computeFindMarks([0, 50], 100, 1)).toEqual([
      { position: 0, current: false },
      { position: 0.5, current: true }
    ])
  })
  it('returns [] when totalRows is 0', () => {
    expect(computeFindMarks([0], 0, 0)).toEqual([])
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- textHighlight`
- [ ] Minimal implementation — append to `src/renderer/src/utils/textHighlight.tsx`:
```tsx
import React, { Fragment } from 'react'
import { renderTextWithWhitespace } from './whitespaceMarkers'

export interface SyntaxToken {
  text: string
  className: string
}

export interface HighlightSegment {
  text: string
  className: string
  /** CSS class for the wrapping <mark>, or null if this segment is not highlighted. */
  markClass: string | null
}

export function buildHighlightSegments(
  tokens: SyntaxToken[],
  ranges: HighlightRange[],
  baseClass: string
): HighlightSegment[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start)
  const segments: HighlightSegment[] = []
  let col = 0
  for (const token of tokens) {
    const tStart = col
    const tEnd = col + token.text.length
    let cursor = tStart
    for (const r of sorted) {
      if (r.end <= cursor || r.start >= tEnd) continue
      if (r.start > cursor) {
        segments.push({ text: token.text.slice(cursor - tStart, r.start - tStart), className: token.className, markClass: null })
        cursor = r.start
      }
      const hlEnd = Math.min(r.end, tEnd)
      if (hlEnd > cursor) {
        segments.push({ text: token.text.slice(cursor - tStart, hlEnd - tStart), className: token.className, markClass: r.className ?? baseClass })
        cursor = hlEnd
      }
    }
    if (cursor < tEnd) {
      segments.push({ text: token.text.slice(cursor - tStart), className: token.className, markClass: null })
    }
    col = tEnd
  }
  return segments
}

export function renderWithHighlights(
  text: string,
  tokens: SyntaxToken[],
  ranges: HighlightRange[],
  baseClass: string
): React.ReactNode {
  const effectiveTokens = tokens.length ? tokens : [{ text, className: '' }]
  const segments = buildHighlightSegments(effectiveTokens, ranges, baseClass)
  return segments.map((seg, i) => {
    const inner = seg.className
      ? <span className={seg.className}>{renderTextWithWhitespace(seg.text, `h${i}-`)}</span>
      : <Fragment>{renderTextWithWhitespace(seg.text, `h${i}-`)}</Fragment>
    return seg.markClass
      ? <mark key={i} className={seg.markClass}>{inner}</mark>
      : <Fragment key={i}>{inner}</Fragment>
  })
}

export interface FindMark {
  position: number
  current: boolean
}

export function computeFindMarks(lineIndexes: number[], totalRows: number, currentIndex: number): FindMark[] {
  if (totalRows <= 0) return []
  return lineIndexes.map((li, i) => ({ position: li / totalRows, current: i === currentIndex }))
}
```
- [ ] Run (expected PASS): `npm run test -- textHighlight`
- [ ] Commit: `git add -A && git commit -m "feat(find): renderWithHighlights segment splitter + find-mark math"`

### Task 3: `useFindController` hook

**Files:**
- Create: `src/renderer/src/hooks/useFindController.ts`
- Test: `src/renderer/src/hooks/__tests__/useFindController.test.ts`

**Interfaces:**
- Consumes: `computeMatches`, `HighlightRange`, `FindOpts` (Task 1)
- Produces: `function useFindController(lines: { text: string }[], query: string, opts: FindOpts): { matches: HighlightRange[]; currentIndex: number; count: number; next(): void; prev(): void; goto(i: number): void }`

Steps:
- [ ] Write the failing test `src/renderer/src/hooks/__tests__/useFindController.test.ts`:
```ts
// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { useFindController } from '../useFindController'

const L = (...t: string[]) => t.map((text) => ({ text }))
const OPTS = { caseSensitive: false, wholeWord: false }

afterEach(() => cleanup())

describe('useFindController', () => {
  it('computes matches and count', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    expect(result.current.count).toBe(3)
    expect(result.current.currentIndex).toBe(0)
  })
  it('next/prev wrap around', () => {
    const { result } = renderHook(() => useFindController(L('a a a'), 'a', OPTS))
    act(() => result.current.prev())
    expect(result.current.currentIndex).toBe(2)
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(0)
  })
  it('resets currentIndex to 0 when the query changes', () => {
    const { result, rerender } = renderHook(({ q }) => useFindController(L('a a a'), q, OPTS), {
      initialProps: { q: 'a' }
    })
    act(() => result.current.next())
    expect(result.current.currentIndex).toBe(1)
    rerender({ q: 'aa' })
    expect(result.current.currentIndex).toBe(0)
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- useFindController`
- [ ] Minimal implementation — create `src/renderer/src/hooks/useFindController.ts`:
```ts
import { useMemo, useState, useCallback, useEffect } from 'react'
import { computeMatches, type HighlightRange, type FindOpts } from '../utils/textHighlight'

export interface FindController {
  matches: HighlightRange[]
  currentIndex: number
  count: number
  next: () => void
  prev: () => void
  goto: (i: number) => void
}

export function useFindController(lines: { text: string }[], query: string, opts: FindOpts): FindController {
  const matches = useMemo(
    () => computeMatches(lines, query, opts),
    [lines, query, opts.caseSensitive, opts.wholeWord]
  )
  const [currentIndex, setCurrentIndex] = useState(0)
  const count = matches.length

  // Reset selection to the first match whenever the result set changes.
  useEffect(() => {
    setCurrentIndex(0)
  }, [query, opts.caseSensitive, opts.wholeWord, lines])

  const next = useCallback(() => setCurrentIndex((i) => (count ? (i + 1) % count : 0)), [count])
  const prev = useCallback(() => setCurrentIndex((i) => (count ? (i - 1 + count) % count : 0)), [count])
  const goto = useCallback((i: number) => setCurrentIndex(i), [])

  return { matches, currentIndex, count, next, prev, goto }
}
```
- [ ] Run (expected PASS): `npm run test -- useFindController`
- [ ] Commit: `git add -A && git commit -m "feat(find): useFindController hook"`

### Task 4: `FindWidget` component + CSS

**Files:**
- Create: `src/renderer/src/components/FindWidget.tsx`
- Create: `src/renderer/src/components/FindWidget.module.css`
- Modify: `src/renderer/src/styles/global.css` (append `.findMatch` / `.findMatchCurrent` after the `.syn-operator` block ~line 491)
- Test: `src/renderer/src/components/__tests__/FindWidget.test.tsx`

**Interfaces:**
- Produces: `interface FindWidgetProps { query; onQueryChange; caseSensitive; wholeWord; onToggleCase; onToggleWholeWord; count; currentIndex; onNext; onPrev; onClose }` (see code)

Steps:
- [ ] Write the failing test `src/renderer/src/components/__tests__/FindWidget.test.tsx`:
```tsx
// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FindWidget, type FindWidgetProps } from '../FindWidget'

afterEach(() => cleanup())

function setup(over: Partial<FindWidgetProps> = {}) {
  const props: FindWidgetProps = {
    query: 'foo', onQueryChange: vi.fn(),
    caseSensitive: false, wholeWord: false,
    onToggleCase: vi.fn(), onToggleWholeWord: vi.fn(),
    count: 3, currentIndex: 0,
    onNext: vi.fn(), onPrev: vi.fn(), onClose: vi.fn(),
    ...over
  }
  render(<FindWidget {...props} />)
  return props
}

describe('FindWidget', () => {
  it('renders the N of M counter', () => {
    setup({ count: 3, currentIndex: 1 })
    expect(screen.getByText('2 of 3')).toBeTruthy()
  })
  it('renders "No results" when count is 0', () => {
    setup({ count: 0 })
    expect(screen.getByText('No results')).toBeTruthy()
  })
  it('Enter triggers onNext, Shift+Enter triggers onPrev', () => {
    const p = setup()
    const input = screen.getByPlaceholderText('Find')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(p.onNext).toHaveBeenCalledOnce()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(p.onPrev).toHaveBeenCalledOnce()
  })
  it('Escape triggers onClose', () => {
    const p = setup()
    fireEvent.keyDown(screen.getByPlaceholderText('Find'), { key: 'Escape' })
    expect(p.onClose).toHaveBeenCalledOnce()
  })
  it('typing fires onQueryChange', () => {
    const p = setup()
    fireEvent.change(screen.getByPlaceholderText('Find'), { target: { value: 'bar' } })
    expect(p.onQueryChange).toHaveBeenCalledWith('bar')
  })
  it('toggle buttons fire their callbacks', () => {
    const p = setup()
    fireEvent.click(screen.getByTitle('Match Case'))
    fireEvent.click(screen.getByTitle('Match Whole Word'))
    expect(p.onToggleCase).toHaveBeenCalledOnce()
    expect(p.onToggleWholeWord).toHaveBeenCalledOnce()
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- FindWidget`
- [ ] Minimal implementation — create `src/renderer/src/components/FindWidget.tsx`:
```tsx
import React, { useEffect, useRef } from 'react'
import { ArrowUp, ArrowDown, X, CaseSensitive, WholeWord } from 'lucide-react'
import styles from './FindWidget.module.css'

export interface FindWidgetProps {
  query: string
  onQueryChange: (q: string) => void
  caseSensitive: boolean
  wholeWord: boolean
  onToggleCase: () => void
  onToggleWholeWord: () => void
  count: number
  currentIndex: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

export function FindWidget(props: FindWidgetProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? props.onPrev() : props.onNext() }
    else if (e.key === 'Escape') { e.preventDefault(); props.onClose() }
  }

  return (
    <div className={styles.widget} onKeyDown={onKeyDown}>
      <input
        ref={inputRef}
        className={styles.input}
        placeholder="Find"
        value={props.query}
        onChange={(e) => props.onQueryChange(e.target.value)}
      />
      <button
        className={`${styles.toggle} ${props.caseSensitive ? styles.toggleActive : ''}`}
        title="Match Case"
        onClick={props.onToggleCase}
      ><CaseSensitive size={14} /></button>
      <button
        className={`${styles.toggle} ${props.wholeWord ? styles.toggleActive : ''}`}
        title="Match Whole Word"
        onClick={props.onToggleWholeWord}
      ><WholeWord size={14} /></button>
      <span className={styles.counter}>
        {props.count === 0 ? 'No results' : `${props.currentIndex + 1} of ${props.count}`}
      </span>
      <button className={styles.nav} title="Previous (Shift+Enter)" onClick={props.onPrev} disabled={props.count === 0}><ArrowUp size={14} /></button>
      <button className={styles.nav} title="Next (Enter)" onClick={props.onNext} disabled={props.count === 0}><ArrowDown size={14} /></button>
      <button className={styles.nav} title="Close (Esc)" onClick={props.onClose}><X size={14} /></button>
    </div>
  )
}
```
- [ ] Create `src/renderer/src/components/FindWidget.module.css`:
```css
.widget {
  position: absolute;
  top: 8px;
  right: 18px;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
}
.input {
  width: 180px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: var(--font-sm);
  font-family: var(--font-family);
  padding: 3px 6px;
  outline: none;
}
.input:focus { border-color: var(--accent); }
.toggle, .nav {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--text-muted);
  cursor: pointer;
}
.toggle:hover, .nav:hover:not(:disabled) { color: var(--text-primary); background: var(--bg-primary); }
.toggleActive { color: var(--accent); background: var(--bg-primary); }
.nav:disabled { opacity: 0.35; cursor: default; }
.counter {
  font-size: var(--font-xs);
  color: var(--text-muted);
  min-width: 64px;
  text-align: center;
  white-space: nowrap;
}
```
- [ ] Append the shared global mark classes to `src/renderer/src/styles/global.css` (after the `.syn-operator { … }` rule ~line 491):
```css
.findMatch {
  background: rgba(234, 179, 8, 0.32);
  color: inherit;
  border-radius: 2px;
}
.findMatchCurrent {
  background: rgba(234, 179, 8, 0.85);
  color: var(--bg-primary);
  border-radius: 2px;
}
```
- [ ] Run (expected PASS): `npm run test -- FindWidget`
- [ ] Commit: `git add -A && git commit -m "feat(find): FindWidget component + CSS + global match classes"`

### Task 5: Wire Find into the inline diff view + register Ctrl+F

**Files:**
- Modify: `src/renderer/src/components/DiffViewer.tsx` — add `findOpen`/`onCloseFind` to `DiffViewerProps` (~532-566); thread to `InlineDiffView`/`SideBySideDiffView` props (701-707); add exported `RangeHighlightedContent` after `SyntaxHighlightedContent` (~2292); add find state + widget + ranges + scroll + gutter ticks inside `InlineDiffView` (1234-1345); pass `findMarks` to `ScrollbarMarkers` (827-848, 1342)
- Modify: `src/renderer/src/components/DiffViewer.module.css` — add `position: relative` to `.diffWithMarkers` (863); add `.scrollbarFindMarker` + current variant
- Modify: `src/renderer/src/components/RepoView.tsx` — add `findOpen` state, Ctrl+F shortcut, pass `findOpen`/`onCloseFind` to the `<DiffViewer>` at 816-832; reset `findOpen` when `centerViewMode`/file changes
- Test: none (view wiring; happy-dom can't lay out react-window). Verify via typecheck + manual.

**Interfaces:**
- Consumes: `useFindController` (Task 3), `FindWidget` (Task 4), `computeFindMarks`, `renderWithHighlights`, `HighlightRange` (Tasks 1-2)
- Produces: `function RangeHighlightedContent({ text, language, ranges, baseClass }: { text: string; language: string | null; ranges: HighlightRange[]; baseClass: string }): React.JSX.Element`
- Produces: `ScrollbarMarkers` gains optional prop `findMarks?: FindMark[]`

Steps:
- [ ] Add `RangeHighlightedContent` immediately after `SyntaxHighlightedContent` (DiffViewer.tsx ~2292), reusing the in-scope `highlightLine`:
```tsx
import { renderWithHighlights, type HighlightRange } from '../utils/textHighlight'
// …
export function RangeHighlightedContent({
  text, language, ranges, baseClass
}: { text: string; language: string | null; ranges: HighlightRange[]; baseClass: string }): React.JSX.Element {
  const tokens = useMemo(() => highlightLine(text, language), [text, language])
  if (ranges.length === 0) return <SyntaxHighlightedContent text={text} language={language} />
  return <>{renderWithHighlights(text, tokens, ranges, baseClass)}</>
}
```
- [ ] Extend `ScrollbarMarkers` (827-848) to render optional find ticks. Add `findMarks?: FindMark[]` to its props and, inside the returned `.scrollbarMarkerColumn`, render after `renderMarkerBars(...)`:
```tsx
{findMarks?.map((m, i) => (
  <div
    key={`f${i}`}
    className={`${styles.scrollbarFindMarker} ${m.current ? styles.scrollbarFindMarkerCurrent : ''}`}
    style={{ top: `${m.position * 100}%` }}
  />
))}
```
Add the import `import { computeFindMarks, type FindMark } from '../utils/textHighlight'`.
- [ ] Add CSS to `DiffViewer.module.css`: set `.diffWithMarkers { position: relative; … }` (existing rule at 863) and append:
```css
.scrollbarFindMarker {
  position: absolute;
  right: 0;
  left: 0;
  height: 2px;
  background: rgba(234, 179, 8, 0.7);
  pointer-events: none;
}
.scrollbarFindMarkerCurrent { background: rgba(234, 179, 8, 1); height: 3px; }
```
- [ ] In `DiffViewerProps` (532-566) add: `findOpen?: boolean` and `onCloseFind?: () => void`. Destructure them in `DiffViewer(...)` (581-595) and forward to both subviews in the render branch (701-707): `<InlineDiffView … findOpen={!!findOpen} onCloseFind={onCloseFind ?? (() => {})} />` (and likewise for `SideBySideDiffView` — wired in Task 6).
- [ ] In `InlineDiffView` (1234-1345) add find state + controller + widget + ranges. After the existing `items` memo (1287):
```tsx
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
const current = find.matches[find.currentIndex]
useEffect(() => {
  if (findOpen && current && listRef) listRef.scrollToRow({ index: current.lineIndex, align: 'smart', behavior: 'smooth' })
}, [findOpen, current, listRef])
const findMarks = useMemo(
  () => computeFindMarks(find.matches.map((m) => m.lineIndex), items.length, find.currentIndex),
  [find.matches, items.length, find.currentIndex]
)
```
- [ ] Pass `rangesByLine` into `rowProps` (1312-1320) by adding it to `InlineVirtualRowProps` (1131-1139: `rangesByLine: Map<number, HighlightRange[]>`), and in `InlineVirtualRow` (1220-1228) swap the non-word-diff branch to:
```tsx
<RangeHighlightedContent text={line.content} language={language} ranges={rangesByLine.get(index) ?? []} baseClass="findMatch" />
```
- [ ] In `InlineDiffView`'s return (1329-1344) render the widget as the first child of `.diffWithMarkers` and pass `findMarks` to `ScrollbarMarkers`:
```tsx
<div className={styles.diffWithMarkers}>
  {findOpen && (
    <FindWidget
      query={findQuery} onQueryChange={setFindQuery}
      caseSensitive={findCase} wholeWord={findWord}
      onToggleCase={() => setFindCase((v) => !v)} onToggleWholeWord={() => setFindWord((v) => !v)}
      count={find.count} currentIndex={find.currentIndex}
      onNext={find.next} onPrev={find.prev} onClose={onCloseFind}
    />
  )}
  <div ref={containerRef} style={{ flex: 1, overflow: 'hidden' }}>{/* …existing List… */}</div>
  <ScrollbarMarkers markers={inlineMarkers} findMarks={findMarks} containerRef={/* …existing… */} />
</div>
```
Add imports at top of DiffViewer.tsx: `import { FindWidget } from './FindWidget'` and `import { useFindController } from '../hooks/useFindController'`.
- [ ] In `RepoView.tsx` add Ctrl+F: `const [findOpen, setFindOpen] = useState(false)`; register via the central registry (mirror CodeEditor.tsx:219-233):
```tsx
const stableOpenFind = useShortcutHandler(() => setFindOpen(true))
const findShortcuts = useMemo(() => [
  defineShortcut('find-in-view', 'Find', 'View', 'Ctrl+F', { ctrl: true, key: 'f' }, stableOpenFind,
    !editingWorkingTree) // disabled while Monaco editor (editingWorkingTree) is mounted — Monaco keeps native find
], [stableOpenFind, editingWorkingTree])
useKeyboardShortcuts(findShortcuts)
useEffect(() => { setFindOpen(false) }, [centerViewMode, workingTreeFile?.path])
```
(Note: per `useKeyboardShortcuts.ts:112` a Ctrl shortcut still fires while typing in an input — acceptable here, Ctrl+F re-focuses the find input; scoping is via the `enabled` arg above.)
- [ ] Pass to the inline `<DiffViewer>` (816-832): `findOpen={findOpen}` and `onCloseFind={() => setFindOpen(false)}`.
- [ ] Run `npm run typecheck` (expected PASS).
- [ ] Manual verify: `npm run dev` → open a modified file → Diff (inline) view → Ctrl+F, type a token: matches highlight yellow, current match brighter, "N of M" updates, Enter/Shift+Enter cycle and auto-scroll to the current match, yellow ticks appear in the right-hand scrollbar gutter, Esc closes.
- [ ] Commit: `git add -A && git commit -m "feat(find): Ctrl+F find in inline diff view + scrollbar ticks"`

### Task 6: Extend Find to side-by-side + full-diff (two-column)

**Files:**
- Modify: `src/renderer/src/utils/textHighlight.tsx` — add `mergeColumnMatches` (+ test in `__tests__/textHighlight.test.ts`)
- Modify: `src/renderer/src/components/DiffViewer.tsx` — `SideBySideDiffView` (1539+), `SbsVirtualRow` content (1487-1497, 1522+); `DualScrollbarMarkers` find ticks
- Modify: `src/renderer/src/components/DiffViewer.tsx` — `FullDiffView` (2005+) + `FullDiffVirtualRow`
- Modify: `src/renderer/src/components/RepoView.tsx` — pass `findOpen`/`onCloseFind` to `<FullDiffView>` (849-866)

**Interfaces:**
- Produces: `interface ColumnMatch extends HighlightRange { column: 'left' | 'right' }` and `function mergeColumnMatches(left: HighlightRange[], right: HighlightRange[]): ColumnMatch[]`

Steps:
- [ ] Write the failing test (append to `textHighlight.test.ts`):
```ts
import { mergeColumnMatches } from '../textHighlight'
describe('mergeColumnMatches', () => {
  it('orders by lineIndex, then left-before-right, then start', () => {
    const left = [{ lineIndex: 0, start: 5, end: 6 }, { lineIndex: 1, start: 0, end: 1 }]
    const right = [{ lineIndex: 0, start: 2, end: 3 }]
    expect(mergeColumnMatches(left, right)).toEqual([
      { lineIndex: 0, start: 5, end: 6, column: 'left' },
      { lineIndex: 0, start: 2, end: 3, column: 'right' },
      { lineIndex: 1, start: 0, end: 1, column: 'left' }
    ])
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- textHighlight`
- [ ] Implement `mergeColumnMatches` in `textHighlight.tsx`:
```tsx
export interface ColumnMatch extends HighlightRange { column: 'left' | 'right' }
export function mergeColumnMatches(left: HighlightRange[], right: HighlightRange[]): ColumnMatch[] {
  const tagged: ColumnMatch[] = [
    ...left.map((r) => ({ ...r, column: 'left' as const })),
    ...right.map((r) => ({ ...r, column: 'right' as const }))
  ]
  tagged.sort((a, b) =>
    (a.lineIndex - b.lineIndex) ||
    (a.column === b.column ? 0 : a.column === 'left' ? -1 : 1) ||
    (a.start - b.start)
  )
  return tagged
}
```
- [ ] Run (expected PASS): `npm run test -- textHighlight`
- [ ] In `SideBySideDiffView` (1539+): build `leftModel`/`rightModel` from `virtualRows` (`kind === 'data' ? pair.left?.content : ''` and `pair.right?.content`), run `computeMatches` on each with the find opts, `mergeColumnMatches` them, derive `currentIndex` against the merged list, build `leftRangesByLine`/`rightRangesByLine` (tagging `find.currentIndex`'s entry with `findMatchCurrent`), `listRef.scrollToRow({ index: merged[currentIndex].lineIndex, … })`, and `findMarks` from `merged.map(m => m.lineIndex)`. Render `<FindWidget>` (shared state pattern from Task 5) in the `.diffWithMarkers` wrapper and pass `findMarks` to `DualScrollbarMarkers`.
- [ ] In `SbsVirtualRow` swap both `SyntaxHighlightedContent` calls (1493 left, 1522+ right) to `RangeHighlightedContent` with the row's per-side ranges (`leftRangesByLine.get(index) ?? []`, `rightRangesByLine.get(index) ?? []`, baseClass `"findMatch"`), threaded through `SbsVirtualRowProps` (1397-1406).
- [ ] Extend `DualScrollbarMarkers` with `findMarks?: FindMark[]` rendering ticks spanning both sub-columns (same `.scrollbarFindMarker` class, positioned in the parent `.scrollbarDualColumn`).
- [ ] Repeat the same wiring in `FullDiffView` (2005+) / `FullDiffVirtualRow`, building left/right models from `FullDiffRow.left?.content`/`right?.content`; pass `findOpen`/`onCloseFind` from RepoView at the `<FullDiffView>` call (849-866): `findOpen={findOpen} onCloseFind={() => setFindOpen(false)}`.
- [ ] Run `npm run typecheck` (expected PASS).
- [ ] Manual verify: `npm run dev` → Split diff and Full views → Ctrl+F finds across both panes, current match cycles in document order (left col before right within a row), ticks appear in the dual gutter.
- [ ] Commit: `git add -A && git commit -m "feat(find): find in side-by-side + full diff views"`

### Task 7: Find in File view + Blame view (non-virtualized)

**Files:**
- Modify: `src/renderer/src/components/RepoView.tsx` — File view `<pre>` block (883-893); host a `FindWidget` + controller in `.fullFileViewer`
- Modify: `src/renderer/src/components/RepoView.module.css` — `.fullFileViewer { position: relative; … }` (242)
- Modify: `src/renderer/src/components/BlameView.tsx` — line render (213-263); accept `findOpen`/`onClose` props
- Modify: `src/renderer/src/components/BlameView.module.css` — `.content { position: relative; … }` (113)

**Interfaces:**
- Consumes: `useFindController`, `FindWidget`, `RangeHighlightedContent`, `computeMatches`
- Produces: `BlameView` props gain `findOpen?: boolean; onCloseFind?: () => void`

Steps:
- [ ] In `RepoView.tsx` File view: build `fileLineModel = useMemo(() => (fileContent ?? '').split('\n').map((text) => ({ text })), [fileContent])`, run `useFindController(fileLineModel, findOpen ? q : '', opts)`, group ranges by line, and in the `.map` at 885-892 render `<RangeHighlightedContent text={line} language={workingTreeFileLanguage} ranges={rangesByLine.get(i) ?? []} baseClass="findMatch" />`, adding `data-find-line={i}` to each `.fullFileLine` div. Host `<FindWidget>` (when `findOpen`) inside `.fullFileViewer`.
- [ ] Add scroll-to-match for the non-virtualized File view via `scrollIntoView`:
```tsx
const fileViewerRef = useRef<HTMLDivElement>(null)
useEffect(() => {
  if (!findOpen) return
  const cur = find.matches[find.currentIndex]
  if (!cur) return
  fileViewerRef.current?.querySelector(`[data-find-line="${cur.lineIndex}"]`)
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}, [findOpen, find.currentIndex, find.matches])
```
(attach `ref={fileViewerRef}` to the `.fullFileViewer` div at 883). Set `.fullFileViewer { position: relative }`.
- [ ] In `BlameView.tsx`: add `findOpen`/`onCloseFind` to props, build `lineModel = blameLines.map((l) => ({ text: l.content }))`, run `useFindController`, group ranges, and change the content render at 260 to `findOpen ? renderWithHighlights(line.content, [], rangesByLine.get(idx) ?? [], 'findMatch') : (line.content ? renderTextWithWhitespace(line.content, \`b${idx}-\`) : ' ')` (empty `tokens` → `renderWithHighlights` uses the plain-text fallback). Add `data-find-line={idx}` to the `.line` div (225) and the same `scrollIntoView` effect against `.content`. Host `<FindWidget>` in `.content` (set `position: relative`).
- [ ] Wire `findOpen`/`onCloseFind` from RepoView into `<BlameView>` (find its render site) and include the File-view `<DiffViewer>`-less branch in the Ctrl+F `enabled` scope (already covered by `!editingWorkingTree`).
- [ ] Run `npm run typecheck` (expected PASS).
- [ ] Manual verify: `npm run dev` → File view: Ctrl+F highlights + scrolls (page scrolls so the current line centers). Open Blame on a file: Ctrl+F highlights matched substrings in blame content and scrolls to current.
- [ ] Commit: `git add -A && git commit -m "feat(find): find in file + blame views"`

---

## Part 4 — Highlight occurrences of selection

Approach: reuse the entire Part 3 highlight pipeline (`computeMatches` + `renderWithHighlights`) with a different CSS class (`selectionHighlight`). The only new logic is (a) the pure VSCode predicate that decides whether a selection qualifies and whether it is a "whole word" vs literal substring, and (b) a thin DOM glue hook that maps a live `Selection` to a line index + char offsets. The predicate is fully unit-tested; the DOM glue is manually verified. Selection highlight is gated off whenever the Find widget is open (so the two never fight over the same line).

**v1 scope (deliberate — differs slightly from the spec's "coexist" wording):** (1) selection occurrences are highlighted **inline only** — no scrollbar-gutter ticks for selections (Find keeps its ticks); (2) selection highlight **yields to** Find while the widget is open rather than rendering alongside it. Both match VSCode's *inline* feel and avoid a line carrying two highlight classes at once; adding selection gutter ticks and true coexistence are cheap follow-ups if wanted.

### Task 1: Pure selection-rule predicates

**Files:**
- Modify: `src/renderer/src/utils/textHighlight.tsx` (append)
- Test: `src/renderer/src/utils/__tests__/textHighlight.test.ts` (append)

**Interfaces:**
- Produces: `function shouldHighlightSelection(selectedText: string): boolean`
- Produces: `function isWordSelection(before: string, selected: string, after: string): boolean`
- Produces: `interface SelectionQuery { query: string; caseSensitive: boolean; wholeWord: boolean }` and `function selectionToQuery(selectedText: string, isWholeWordSelection: boolean): SelectionQuery | null`
- Produces: `function excludeOwnRange(ranges: HighlightRange[], own: { lineIndex: number; start: number } | null): HighlightRange[]`

Steps:
- [ ] Write the failing test (append):
```ts
import { shouldHighlightSelection, isWordSelection, selectionToQuery, excludeOwnRange } from '../textHighlight'

describe('shouldHighlightSelection', () => {
  it('rejects empty, whitespace-only, and multi-line selections', () => {
    expect(shouldHighlightSelection('')).toBe(false)
    expect(shouldHighlightSelection('   ')).toBe(false)
    expect(shouldHighlightSelection('a\nb')).toBe(false)
  })
  it('accepts a single-line, non-whitespace selection', () => {
    expect(shouldHighlightSelection('foo')).toBe(true)
    expect(shouldHighlightSelection('a b')).toBe(true)
  })
})

describe('isWordSelection', () => {
  it('is true when selection is all word chars with non-word boundaries', () => {
    expect(isWordSelection(' ', 'foo', '(')).toBe(true)
    expect(isWordSelection('', 'foo', '')).toBe(true)
  })
  it('is false when a boundary char is a word char', () => {
    expect(isWordSelection('x', 'foo', ' ')).toBe(false)
    expect(isWordSelection(' ', 'foo', 'x')).toBe(false)
  })
  it('is false when the selection itself contains a non-word char', () => {
    expect(isWordSelection(' ', 'fo o', ' ')).toBe(false)
  })
})

describe('selectionToQuery', () => {
  it('returns null for a non-qualifying selection', () => {
    expect(selectionToQuery('  ', false)).toBeNull()
  })
  it('is always case-sensitive, passing through the whole-word flag', () => {
    expect(selectionToQuery('foo', true)).toEqual({ query: 'foo', caseSensitive: true, wholeWord: true })
    expect(selectionToQuery('a b', false)).toEqual({ query: 'a b', caseSensitive: true, wholeWord: false })
  })
})

describe('excludeOwnRange', () => {
  it('drops the match equal to the active selection', () => {
    const r = [{ lineIndex: 1, start: 0, end: 3 }, { lineIndex: 2, start: 4, end: 7 }]
    expect(excludeOwnRange(r, { lineIndex: 1, start: 0 })).toEqual([{ lineIndex: 2, start: 4, end: 7 }])
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- textHighlight`
- [ ] Implement (append to `textHighlight.tsx`; reuses the module-level `WORD_CHAR`):
```tsx
export function shouldHighlightSelection(selectedText: string): boolean {
  if (!selectedText) return false
  if (selectedText.includes('\n')) return false
  if (selectedText.trim().length === 0) return false
  return true
}

export function isWordSelection(before: string, selected: string, after: string): boolean {
  if (!selected) return false
  for (const ch of selected) if (!WORD_CHAR.test(ch)) return false
  if (before && WORD_CHAR.test(before)) return false
  if (after && WORD_CHAR.test(after)) return false
  return true
}

export interface SelectionQuery {
  query: string
  caseSensitive: boolean
  wholeWord: boolean
}

export function selectionToQuery(selectedText: string, isWholeWordSelection: boolean): SelectionQuery | null {
  if (!shouldHighlightSelection(selectedText)) return null
  return { query: selectedText, caseSensitive: true, wholeWord: isWholeWordSelection }
}

export function excludeOwnRange(
  ranges: HighlightRange[],
  own: { lineIndex: number; start: number } | null
): HighlightRange[] {
  if (!own) return ranges
  return ranges.filter((r) => !(r.lineIndex === own.lineIndex && r.start === own.start))
}
```
- [ ] Run (expected PASS): `npm run test -- textHighlight`
- [ ] Commit: `git add -A && git commit -m "feat(selhl): pure VSCode selection-highlight predicates"`

### Task 2: `useSelectionHighlight` hook + `selectionHighlight` class

**Files:**
- Create: `src/renderer/src/hooks/useSelectionHighlight.ts`
- Modify: `src/renderer/src/styles/global.css` (append `.selectionHighlight` after the find classes)
- Test: `src/renderer/src/hooks/__tests__/useSelectionHighlight.test.ts`

**Interfaces:**
- Consumes: `selectionToQuery`, `isWordSelection`, `computeMatches`, `excludeOwnRange`, `HighlightRange`
- Produces: `function useSelectionHighlight(lines: { text: string }[], containerRef: React.RefObject<HTMLElement | null>, enabled: boolean): HighlightRange[]`
- Produces (pure, exported for test): `function selectionRanges(lines, selectedText, ownLineIndex, ownStart, before, after): HighlightRange[]`

Steps:
- [ ] Write the failing test `src/renderer/src/hooks/__tests__/useSelectionHighlight.test.ts` (drives the pure core; the DOM glue is manually verified):
```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { selectionRanges } from '../useSelectionHighlight'

const L = (...t: string[]) => t.map((text) => ({ text }))

describe('selectionRanges', () => {
  it('highlights every other occurrence, excluding the active selection itself', () => {
    // line0 "foo bar foo", select first "foo" (start 0). whole-word selection.
    const out = selectionRanges(L('foo bar foo', 'foo'), 'foo', 0, 0, '', ' ')
    expect(out).toEqual([
      { lineIndex: 0, start: 8, end: 11 },
      { lineIndex: 1, start: 0, end: 3 }
    ])
  })
  it('returns [] for a whitespace selection', () => {
    expect(selectionRanges(L('a  a'), '  ', 0, 1, 'a', 'a')).toEqual([])
  })
  it('uses literal substring (not whole-word) when the selection is not a clean word', () => {
    // select "oo" inside "foo" → boundary char 'f' is a word char → substring mode
    const out = selectionRanges(L('foo oot', 'oo'), 'oo', 0, 1, 'f', ' ')
    // matches "oo" at line0 start1(excluded), line1 "oot" start0
    expect(out).toEqual([{ lineIndex: 1, start: 0, end: 2 }])
  })
})
```
- [ ] Run it (expected FAIL): `npm run test -- useSelectionHighlight`
- [ ] Implement `src/renderer/src/hooks/useSelectionHighlight.ts`:
```ts
import { useState, useEffect } from 'react'
import { selectionToQuery, isWordSelection, computeMatches, excludeOwnRange, type HighlightRange } from '../utils/textHighlight'

/** Pure core: given the selected text + its line/offset/boundary context, return the
 *  ranges to highlight (all matches minus the selection's own range). */
export function selectionRanges(
  lines: { text: string }[],
  selectedText: string,
  ownLineIndex: number,
  ownStart: number,
  before: string,
  after: string
): HighlightRange[] {
  const q = selectionToQuery(selectedText, isWordSelection(before, selectedText, after))
  if (!q) return []
  const all = computeMatches(lines, q.query, { caseSensitive: q.caseSensitive, wholeWord: q.wholeWord })
  return excludeOwnRange(all, { lineIndex: ownLineIndex, start: ownStart })
}

/** DOM glue: tracks the active selection inside containerRef and produces highlight ranges. */
export function useSelectionHighlight(
  lines: { text: string }[],
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
): HighlightRange[] {
  const [ranges, setRanges] = useState<HighlightRange[]>([])

  useEffect(() => {
    if (!enabled) { setRanges([]); return }
    const container = containerRef.current
    if (!container) return

    const recompute = (): void => {
      const sel = window.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { setRanges([]); return }
      const text = sel.toString()
      const anchor = sel.anchorNode
      if (!anchor || !container.contains(anchor)) { setRanges([]); return }
      // Find the line element carrying data-find-line for this selection.
      const el = (anchor.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as HTMLElement)
        ?.closest('[data-find-line]') as HTMLElement | null
      if (!el) { setRanges([]); return }
      const lineIndex = Number(el.dataset.findLine)
      const lineText = lines[lineIndex]?.text ?? ''
      const start = lineText.indexOf(text)
      if (start < 0) { setRanges([]); return }
      const before = start > 0 ? lineText[start - 1] : ''
      const after = start + text.length < lineText.length ? lineText[start + text.length] : ''
      setRanges(selectionRanges(lines, text, lineIndex, start, before, after))
    }

    document.addEventListener('selectionchange', recompute)
    return () => document.removeEventListener('selectionchange', recompute)
  }, [lines, containerRef, enabled])

  return ranges
}
```
- [ ] Append to `src/renderer/src/styles/global.css`:
```css
.selectionHighlight {
  background: rgba(120, 170, 255, 0.28);
  color: inherit;
  border-radius: 2px;
}
```
- [ ] Run (expected PASS): `npm run test -- useSelectionHighlight`
- [ ] Commit: `git add -A && git commit -m "feat(selhl): useSelectionHighlight hook + selectionHighlight class"`

### Task 3: Wire selection highlight into all views

**Files:**
- Modify: `src/renderer/src/components/DiffViewer.tsx` — `InlineDiffView`, `SideBySideDiffView`, `FullDiffView`: add `data-find-line` to each rendered line container, call `useSelectionHighlight`, and OR its per-line ranges into the `RangeHighlightedContent` ranges (gated by `!findOpen`)
- Modify: `src/renderer/src/components/RepoView.tsx` — File view (same treatment over `.fullFileViewer`)
- Modify: `src/renderer/src/components/BlameView.tsx` — same over `.content`

**Interfaces:**
- Consumes: `useSelectionHighlight` (Task 2), `RangeHighlightedContent` (Part 3 Task 5)

Steps:
- [ ] In each virtualized view, add `data-find-line={index}` (inline `InlineVirtualRow` `.line` div ~1200; SBS `SbsVirtualRow` left/right `.sbsLine` divs — for SBS use `data-find-line` only for selection mapping on the row index) and in non-virtualized File/Blame add `data-find-line={i}` (already added in Part 3 Task 7).
- [ ] In `InlineDiffView`, add `const selHl = useSelectionHighlight(lineModel, containerRef, !findOpen)` and a memo `selByLine` grouping `selHl` by `lineIndex` (each tagged `className: 'selectionHighlight'`). Choose the ranges per line as `findOpen ? (rangesByLine.get(index) ?? []) : (selByLine.get(index) ?? [])` and pass to `RangeHighlightedContent` with `baseClass={findOpen ? 'findMatch' : 'selectionHighlight'}`. (Find and selection-highlight are mutually exclusive by the `!findOpen` gate, matching the spec's "coexists" requirement without overlapping a single line with both classes.)
- [ ] Repeat the gating pattern in `SideBySideDiffView`/`FullDiffView` (run `useSelectionHighlight` over the merged/left+right model and feed the matching column's `RangeHighlightedContent`) and in the File view and `BlameView` line renderers.
- [ ] Run `npm run typecheck` (expected PASS).
- [ ] Manual verify: `npm run dev` → in any text view (inline diff, split, full, file, blame), double-click a word → all other occurrences get the blue `selectionHighlight`, the double-clicked word itself is NOT double-highlighted; select a partial substring inside a word → all literal substring occurrences highlight (substring mode); select across a newline or only whitespace → nothing highlights; open Ctrl+F → selection highlight disappears and find highlight takes over.
- [ ] Commit: `git add -A && git commit -m "feat(selhl): highlight all occurrences of selection across text views"`

---

## Part 5 — Inline line editing (custom in-place rows)

> **Approach.** Edit state lives in working-tree FILE-LINE coordinates (`newLineNum`). All the real logic — "which rows are editable", "arrow past a hunk → next hunk's line", and "turn a buffer back into file text" — is pushed into two pure modules (`inlineEditNav.ts`, `applyLineEdits.ts`) and a thin state hook (`useInlineLineEdit`), which we unit-test hard. The row rendering (hover pencil, in-place `<input>`/`<textarea>`) lives inside the react-window virtualized rows, which **cannot** be reliably tested under happy-dom (zero layout) — so those tasks ship with real code + precise `npm run dev` manual steps instead of brittle DOM tests.
>
> **This is the highest-risk Part of the plan.** The interaction surface (virtualized rows that unmount on scroll, focus management, key handling competing with the find/selection layers from Parts 3–4) is where things will break. Mitigation: the headline guarantee and all coordinate math are in pure functions verified by tests; the components are dumb shells over them. Build 5a (single-line) fully before 5b (multi-line + side-by-side).

Editable rule everywhere: a row is editable iff `item.type === 'line' && item.line && item.line.type !== 'removed' && item.line.newLineNum != null`. Its file line is `line.newLineNum`. Working-tree views only; gate on `!workingTreeFile.staged` (a staged File/diff view renders the index version = read-only).

---

### Task 1 (5a): Pure editable-navigation module `inlineEditNav.ts`

The headline "arrow past a hunk lands on the next hunk's first editable line" lives here. No React.

**Files:**
- Create: `src/renderer/src/utils/inlineEditNav.ts`
- Test: `src/renderer/src/utils/__tests__/inlineEditNav.test.ts`

**Interfaces:**
- Produces:
  - `interface EditableTarget { displayIndex: number; fileLine: number }`
  - `interface NavItem { type: 'hunkHeader' | 'line'; line: { type: 'context' | 'added' | 'removed'; newLineNum: number | null } | null }` — the minimal structural shape; the real `InlineVirtualItem` (DiffViewer.tsx ~1123) is assignable to `NavItem` (it has `type` and `line` with at least `type` + `newLineNum`).
  - `buildEditableTargets(items: NavItem[]): EditableTarget[]`
  - `nextEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null`
  - `prevEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null`
- Consumes: nothing (pure).

**Steps:**

- [ ] Write the failing test `src/renderer/src/utils/__tests__/inlineEditNav.test.ts`. Two hunks with a removed row in the first, so it asserts BOTH skipping (header + removed) AND the cross-hunk jump:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { buildEditableTargets, nextEditable, prevEditable, NavItem } from '../inlineEditNav'

  // Hunk 1: header, context@10, removed(old), added@11, added@12
  // Hunk 2: header, context@50, added@51
  const items: NavItem[] = [
    { type: 'hunkHeader', line: null },
    { type: 'line', line: { type: 'context', newLineNum: 10 } },
    { type: 'line', line: { type: 'removed', newLineNum: null } },
    { type: 'line', line: { type: 'added', newLineNum: 11 } },
    { type: 'line', line: { type: 'added', newLineNum: 12 } },
    { type: 'hunkHeader', line: null },
    { type: 'line', line: { type: 'context', newLineNum: 50 } },
    { type: 'line', line: { type: 'added', newLineNum: 51 } }
  ]

  describe('buildEditableTargets', () => {
    it('keeps context+added rows, skips hunk headers and removed rows', () => {
      expect(buildEditableTargets(items)).toEqual([
        { displayIndex: 1, fileLine: 10 },
        { displayIndex: 3, fileLine: 11 },
        { displayIndex: 4, fileLine: 12 },
        { displayIndex: 6, fileLine: 50 },
        { displayIndex: 7, fileLine: 51 }
      ])
    })
  })

  describe('nextEditable / prevEditable', () => {
    const t = buildEditableTargets(items)
    it('steps within a hunk', () => {
      expect(nextEditable(10, t)).toEqual({ displayIndex: 3, fileLine: 11 })
    })
    it('HEADLINE: stepping past the last row of a hunk lands on the next hunk’s first editable row', () => {
      expect(nextEditable(12, t)).toEqual({ displayIndex: 6, fileLine: 50 })
    })
    it('prevEditable mirrors across the hunk boundary', () => {
      expect(prevEditable(50, t)).toEqual({ displayIndex: 4, fileLine: 12 })
    })
    it('returns null at the ends', () => {
      expect(nextEditable(51, t)).toBeNull()
      expect(prevEditable(10, t)).toBeNull()
    })
  })
  ```
- [ ] Run it (expected FAIL — module missing): `npm run test -- inlineEditNav`
- [ ] Minimal implementation `src/renderer/src/utils/inlineEditNav.ts`:
  ```ts
  /** A row that can be edited in place, in display order. */
  export interface EditableTarget {
    /** Index into the flat InlineVirtualItem[] this target came from. */
    displayIndex: number
    /** 1-based new-file (working-tree) line number. */
    fileLine: number
  }

  /** Minimal structural shape of a flat inline row (InlineVirtualItem satisfies this). */
  export interface NavItem {
    type: 'hunkHeader' | 'line'
    line: { type: 'context' | 'added' | 'removed'; newLineNum: number | null } | null
  }

  /**
   * Reduce a flat inline row list to its editable targets, in display order.
   * Editable iff the row maps to a current file line: context + added rows
   * (they carry a new-side line number). Hunk headers and pure removed rows
   * have no working-tree line, so they are skipped.
   */
  export function buildEditableTargets(items: NavItem[]): EditableTarget[] {
    const targets: EditableTarget[] = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (it.type !== 'line' || !it.line) continue
      if (it.line.type === 'removed' || it.line.newLineNum == null) continue
      targets.push({ displayIndex: i, fileLine: it.line.newLineNum })
    }
    return targets
  }

  function indexOfFileLine(fileLine: number, targets: EditableTarget[]): number {
    for (let i = 0; i < targets.length; i++) if (targets[i].fileLine === fileLine) return i
    return -1
  }

  /** Next editable target in display order after `currentFileLine`, or null at the end. */
  export function nextEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null {
    const idx = indexOfFileLine(currentFileLine, targets)
    if (idx === -1 || idx + 1 >= targets.length) return null
    return targets[idx + 1]
  }

  /** Previous editable target in display order before `currentFileLine`, or null at the start. */
  export function prevEditable(currentFileLine: number, targets: EditableTarget[]): EditableTarget | null {
    const idx = indexOfFileLine(currentFileLine, targets)
    if (idx <= 0) return null
    return targets[idx - 1]
  }
  ```
- [ ] Run (expected PASS): `npm run test -- inlineEditNav`
- [ ] Typecheck: `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/utils/inlineEditNav.ts src/renderer/src/utils/__tests__/inlineEditNav.test.ts
  git commit -m "feat(inline-edit): pure editable-navigation core (cross-hunk arrow nav)"
  ```

---

### Task 2 (5a): Pure file-content apply module `applyLineEdits.ts`

Turns `{startLine,endLine,text}` block replacements back into a file string, preserving trailing-newline state and supporting newline splits.

**Files:**
- Create: `src/renderer/src/utils/applyLineEdits.ts`
- Test: `src/renderer/src/utils/__tests__/applyLineEdits.test.ts`

**Interfaces:**
- Produces:
  - `interface BlockEdit { startLine: number; endLine: number; text: string }` (1-based inclusive)
  - `applyLineEdits(original: string, edits: BlockEdit[]): string`
- Consumes: nothing (pure).

**Steps:**

- [ ] Write the failing test `src/renderer/src/utils/__tests__/applyLineEdits.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest'
  import { applyLineEdits } from '../applyLineEdits'

  describe('applyLineEdits', () => {
    it('replaces a single line', () => {
      expect(applyLineEdits('a\nb\nc\n', [{ startLine: 2, endLine: 2, text: 'B' }])).toBe('a\nB\nc\n')
    })
    it('replaces a multi-line block with one line', () => {
      expect(applyLineEdits('a\nb\nc\nd\n', [{ startLine: 2, endLine: 3, text: 'X' }])).toBe('a\nX\nd\n')
    })
    it('splits one line into two via an embedded newline', () => {
      expect(applyLineEdits('a\nbc\nd\n', [{ startLine: 2, endLine: 2, text: 'b\nc' }])).toBe('a\nb\nc\nd\n')
    })
    it('preserves a trailing newline', () => {
      expect(applyLineEdits('a\nb\n', [{ startLine: 1, endLine: 1, text: 'A' }])).toBe('A\nb\n')
    })
    it('preserves absence of a trailing newline', () => {
      expect(applyLineEdits('a\nb', [{ startLine: 1, endLine: 1, text: 'A' }])).toBe('A\nb')
    })
    it('applies multiple non-overlapping edits regardless of order', () => {
      expect(
        applyLineEdits('a\nb\nc\n', [{ startLine: 3, endLine: 3, text: 'C' }, { startLine: 1, endLine: 1, text: 'A' }])
      ).toBe('A\nb\nC\n')
    })
  })
  ```
- [ ] Run it (expected FAIL): `npm run test -- applyLineEdits`
- [ ] Minimal implementation `src/renderer/src/utils/applyLineEdits.ts`:
  ```ts
  /** A contiguous block replacement; 1-based inclusive line numbers. */
  export interface BlockEdit {
    startLine: number
    endLine: number
    /** Replacement text; may contain '\n' to expand/split into several lines. */
    text: string
  }

  /**
   * Apply non-overlapping block edits to `original` and return the new file
   * text. The presence/absence of a trailing newline is preserved. A single
   * line edit is `startLine === endLine`; inserting a newline is `text`
   * containing '\n'.
   */
  export function applyLineEdits(original: string, edits: BlockEdit[]): string {
    const hadTrailingNewline = original.endsWith('\n')
    const body = hadTrailingNewline ? original.slice(0, -1) : original
    const lines = body.split('\n')

    // Apply bottom-up so earlier line indices stay valid as we splice.
    const sorted = [...edits].sort((a, b) => b.startLine - a.startLine)
    for (const edit of sorted) {
      const start = edit.startLine - 1
      const count = edit.endLine - edit.startLine + 1
      lines.splice(start, count, ...edit.text.split('\n'))
    }

    return lines.join('\n') + (hadTrailingNewline ? '\n' : '')
  }
  ```
- [ ] Run (expected PASS): `npm run test -- applyLineEdits`
- [ ] Typecheck: `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/utils/applyLineEdits.ts src/renderer/src/utils/__tests__/applyLineEdits.test.ts
  git commit -m "feat(inline-edit): pure apply-edits-to-file-content core"
  ```

---

### Task 3 (5a): `useInlineLineEdit` hook (single-line: enter/commit/cancel/moveUp/moveDown)

Thin state glue over the two pure modules. Holds `editing` (file-line coords) + the working `buffer`; on commit it read-modify-writes the file and fires `onSaved` (which triggers Part 2's in-place refresh).

**Files:**
- Create: `src/renderer/src/components/useInlineLineEdit.ts`
- Test: `src/renderer/src/components/__tests__/useInlineLineEdit.test.ts`

**Interfaces:**
- Consumes: `applyLineEdits`/`BlockEdit` (Task 2); `EditableTarget`/`nextEditable`/`prevEditable`/`extendSelection` (Tasks 1 & 7); `window.electronAPI.file.read`/`file.write` (preload, src/preload/index.ts ~382-387).
- Produces:
  - `interface InlineEditState { anchorLine: number; focusLine: number }`
  - `interface UseInlineLineEditArgs { absPath: string; targets: EditableTarget[]; lineText: Map<number, string>; onSaved: () => void }`
  - `useInlineLineEdit(args): { editing: InlineEditState | null; buffer: string; setBuffer: (t: string) => void; enter: (fileLine: number) => void; cancel: () => void; commit: () => Promise<void>; moveUp: () => Promise<void>; moveDown: () => Promise<void>; extendUp: () => void; extendDown: () => void }`
- `extendUp`/`extendDown` are stubbed in this task (no-op) and filled in Task 8.

**Steps:**

- [ ] Write the failing test `src/renderer/src/components/__tests__/useInlineLineEdit.test.ts`:
  ```ts
  // @vitest-environment happy-dom
  import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
  import { renderHook, act, cleanup } from '@testing-library/react'
  import { useInlineLineEdit } from '../useInlineLineEdit'
  import { EditableTarget } from '../../utils/inlineEditNav'

  const targets: EditableTarget[] = [
    { displayIndex: 1, fileLine: 1 },
    { displayIndex: 2, fileLine: 2 },
    { displayIndex: 3, fileLine: 3 }
  ]
  const lineText = new Map<number, string>([[1, 'one'], [2, 'two'], [3, 'three']])

  let readMock: ReturnType<typeof vi.fn>
  let writeMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    readMock = vi.fn(async () => ({ success: true, data: 'one\ntwo\nthree\n' }))
    writeMock = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', { ...globalThis.window, electronAPI: { file: { read: readMock, write: writeMock } } })
  })
  afterEach(() => { cleanup(); vi.unstubAllGlobals() })

  function setup(onSaved = vi.fn()) {
    return renderHook(() => useInlineLineEdit({ absPath: '/repo/f.txt', targets, lineText, onSaved }))
  }

  describe('useInlineLineEdit', () => {
    it('enter() seeds editing state and the buffer from the line text', () => {
      const { result } = setup()
      act(() => result.current.enter(2))
      expect(result.current.editing).toEqual({ anchorLine: 2, focusLine: 2 })
      expect(result.current.buffer).toBe('two')
    })

    it('commit() writes the applied file content and fires onSaved', async () => {
      const onSaved = vi.fn()
      const { result } = setup(onSaved)
      act(() => result.current.enter(2))
      act(() => result.current.setBuffer('TWO'))
      await act(async () => { await result.current.commit() })
      expect(writeMock).toHaveBeenCalledWith('/repo/f.txt', 'one\nTWO\nthree\n')
      expect(onSaved).toHaveBeenCalledTimes(1)
      expect(result.current.editing).toBeNull()
    })

    it('moveDown() commits then advances the edit to the next target', async () => {
      const { result } = setup()
      act(() => result.current.enter(1))
      act(() => result.current.setBuffer('ONE'))
      await act(async () => { await result.current.moveDown() })
      expect(writeMock).toHaveBeenCalledWith('/repo/f.txt', 'ONE\ntwo\nthree\n')
      expect(result.current.editing).toEqual({ anchorLine: 2, focusLine: 2 })
      expect(result.current.buffer).toBe('two')
    })

    it('cancel() clears editing without writing', () => {
      const { result } = setup()
      act(() => result.current.enter(1))
      act(() => result.current.cancel())
      expect(result.current.editing).toBeNull()
      expect(writeMock).not.toHaveBeenCalled()
    })
  })
  ```
- [ ] Run it (expected FAIL): `npm run test -- useInlineLineEdit`
- [ ] Minimal implementation `src/renderer/src/components/useInlineLineEdit.ts` (note `extendUp`/`extendDown` are placeholders filled in Task 8):
  ```ts
  import { useCallback, useState } from 'react'
  import { applyLineEdits } from '../utils/applyLineEdits'
  import { EditableTarget, nextEditable, prevEditable } from '../utils/inlineEditNav'

  export interface InlineEditState {
    anchorLine: number
    focusLine: number
  }

  export interface UseInlineLineEditArgs {
    /** Absolute path of the working-tree file to write on commit. */
    absPath: string
    /** Editable targets in display order (from buildEditableTargets). */
    targets: EditableTarget[]
    /** fileLine -> current on-screen text of that line. */
    lineText: Map<number, string>
    /** Fired after a successful write; caller refreshes the diff. */
    onSaved: () => void
  }

  export interface UseInlineLineEdit {
    editing: InlineEditState | null
    buffer: string
    setBuffer: (text: string) => void
    enter: (fileLine: number) => void
    cancel: () => void
    commit: () => Promise<void>
    moveUp: () => Promise<void>
    moveDown: () => Promise<void>
    extendUp: () => void
    extendDown: () => void
  }

  export function useInlineLineEdit({ absPath, targets, lineText, onSaved }: UseInlineLineEditArgs): UseInlineLineEdit {
    const [editing, setEditing] = useState<InlineEditState | null>(null)
    const [buffer, setBuffer] = useState('')

    const enter = useCallback((fileLine: number) => {
      setEditing({ anchorLine: fileLine, focusLine: fileLine })
      setBuffer(lineText.get(fileLine) ?? '')
    }, [lineText])

    const cancel = useCallback(() => setEditing(null), [])

    const commit = useCallback(async () => {
      if (!editing) return
      const start = Math.min(editing.anchorLine, editing.focusLine)
      const end = Math.max(editing.anchorLine, editing.focusLine)
      const read = await window.electronAPI.file.read(absPath)
      if (!read.success || typeof read.data !== 'string') { setEditing(null); return }
      const next = applyLineEdits(read.data, [{ startLine: start, endLine: end, text: buffer }])
      const write = await window.electronAPI.file.write(absPath, next)
      setEditing(null)
      if (write.success) onSaved()
    }, [editing, buffer, absPath, onSaved])

    const moveDown = useCallback(async () => {
      if (!editing) return
      const t = nextEditable(editing.focusLine, targets)
      await commit()
      if (t) enter(t.fileLine)
    }, [editing, commit, targets, enter])

    const moveUp = useCallback(async () => {
      if (!editing) return
      const t = prevEditable(editing.focusLine, targets)
      await commit()
      if (t) enter(t.fileLine)
    }, [editing, commit, targets, enter])

    // Filled in Task 8 (5b multi-line).
    const extendUp = useCallback(() => {}, [])
    const extendDown = useCallback(() => {}, [])

    return { editing, buffer, setBuffer, enter, cancel, commit, moveUp, moveDown, extendUp, extendDown }
  }
  ```
- [ ] Run (expected PASS): `npm run test -- useInlineLineEdit`
- [ ] Typecheck: `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/useInlineLineEdit.ts src/renderer/src/components/__tests__/useInlineLineEdit.test.ts
  git commit -m "feat(inline-edit): useInlineLineEdit hook (single-line MVP)"
  ```

---

### Task 4 (5a): CSS for the pencil affordance + in-place input

Shared styles for the hover pencil and the editing `<input>`/`<textarea>` so it visually sits exactly where the line content was. (HIGH RISK: hard to unit-test; verified visually in Tasks 5–6.)

**Files:**
- Modify: `src/renderer/src/components/DiffViewer.module.css` (append a new block near the `.lineContent` rules)
- Modify: `src/renderer/src/components/RepoView.module.css` (append near `.fullFileLine` rules)

**Interfaces:** Produces CSS classes `editPencil`, `inlineEditInput`, `inlineEditTextarea` in both modules (used by Tasks 5, 6, 9, 10). Consumes nothing.

**Steps:**

- [ ] Append to `src/renderer/src/components/DiffViewer.module.css`:
  ```css
  /* ─── Inline line editing (working-tree only) ─────────────────────────── */
  .editPencil {
    opacity: 0;
    cursor: pointer;
    padding: 0 4px;
    color: var(--text-secondary, #888);
    background: none;
    border: none;
    display: inline-flex;
    align-items: center;
  }
  .line:hover .editPencil { opacity: 1; }
  .editPencil:hover { color: var(--accent, #4aa3ff); }

  .inlineEditInput,
  .inlineEditTextarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    line-height: inherit;
    color: var(--text-primary, #ddd);
    background: var(--bg-editable, rgba(74, 163, 255, 0.10));
    border: 1px solid var(--accent, #4aa3ff);
    border-radius: 2px;
    padding: 0 2px;
    margin: 0;
    outline: none;
    resize: none;
  }
  .inlineEditTextarea { overflow: hidden; white-space: pre; }
  ```
- [ ] Append to `src/renderer/src/components/RepoView.module.css`:
  ```css
  /* ─── Inline line editing in the File view ────────────────────────────── */
  .fullFileLine .editPencil {
    opacity: 0;
    cursor: pointer;
    padding: 0 4px;
    color: var(--text-secondary, #888);
    background: none;
    border: none;
    display: inline-flex;
    align-items: center;
  }
  .fullFileLine:hover .editPencil { opacity: 1; }
  .fullFileLine .editPencil:hover { color: var(--accent, #4aa3ff); }
  .inlineEditInput,
  .inlineEditTextarea {
    width: 100%;
    box-sizing: border-box;
    font: inherit;
    line-height: inherit;
    color: var(--text-primary, #ddd);
    background: var(--bg-editable, rgba(74, 163, 255, 0.10));
    border: 1px solid var(--accent, #4aa3ff);
    border-radius: 2px;
    padding: 0 2px;
    margin: 0;
    outline: none;
    resize: none;
  }
  .inlineEditTextarea { overflow: hidden; white-space: pre; }
  ```
- [ ] Typecheck (CSS modules referenced later; this just verifies nothing broke): `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/DiffViewer.module.css src/renderer/src/components/RepoView.module.css
  git commit -m "style(inline-edit): pencil affordance + in-place input/textarea styles"
  ```

---

### Task 5 (5a): File view inline editing (simplest end-to-end surface)

The non-virtualized File view (`centerViewMode === 'file'`) is the cleanest place to prove the hook + apply-edits end-to-end: every row is editable, `fileLine = i + 1`. Extract a `FullFileEditableView` component. (HIGH RISK rendering — verified manually.)

**Files:**
- Create: `src/renderer/src/components/FullFileEditableView.tsx`
- Modify: `src/renderer/src/components/RepoView.tsx` (replace the File-view `<pre>` block at ~882-895; it currently maps `fileContent.split('\n')` into `.fullFileLine` rows)
- Test: none (happy-dom can't render meaningfully); manual verification below.

**Interfaces:**
- Consumes: `useInlineLineEdit` (Task 3); `buildEditableTargets`/`EditableTarget` (Task 1); `SyntaxHighlightedContent` (DiffViewer.tsx ~2279, already exported); RepoView's `workingTreeFileLanguage` (~126), `repoPath`, `workingTreeFile`, `handleEditorFileSaved` (~203).
- Produces: `FullFileEditableView({ fileContent, language, absPath, editable, onSaved }): React.JSX.Element`.

**Steps:**

- [ ] Create `src/renderer/src/components/FullFileEditableView.tsx`:
  ```tsx
  import React, { useMemo } from 'react'
  import { Pencil } from 'lucide-react'
  import styles from './RepoView.module.css'
  import { SyntaxHighlightedContent } from './DiffViewer'
  import { useInlineLineEdit } from './useInlineLineEdit'
  import { buildEditableTargets, NavItem } from '../utils/inlineEditNav'

  export function FullFileEditableView({
    fileContent, language, absPath, editable, onSaved
  }: {
    fileContent: string
    language: string | null
    absPath: string
    editable: boolean
    onSaved: () => void
  }): React.JSX.Element {
    const lines = useMemo(() => fileContent.split('\n'), [fileContent])

    // Every File-view row maps 1:1 to file line i+1.
    const navItems = useMemo<NavItem[]>(
      () => lines.map((_, i) => ({ type: 'line', line: { type: 'context', newLineNum: i + 1 } })),
      [lines]
    )
    const targets = useMemo(() => buildEditableTargets(navItems), [navItems])
    const lineText = useMemo(() => new Map(lines.map((l, i) => [i + 1, l] as const)), [lines])

    const edit = useInlineLineEdit({ absPath, targets, lineText, onSaved })

    return (
      <pre className={styles.fullFilePre}>
        <code>
          {lines.map((line, i) => {
            const fileLine = i + 1
            const isEditing = !!edit.editing && edit.editing.focusLine === fileLine
            return (
              <div key={i} className={styles.fullFileLine}>
                <span className={styles.fullFileLineNum}>{fileLine}</span>
                <span className={styles.fullFileLineContent}>
                  {isEditing ? (
                    <input
                      className={styles.inlineEditInput}
                      autoFocus
                      value={edit.buffer}
                      onChange={(e) => edit.setBuffer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); void edit.moveDown() }
                        else if (e.key === 'Escape') { e.preventDefault(); edit.cancel() }
                        else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
                          e.preventDefault(); void edit.moveUp()
                        } else if (
                          e.key === 'ArrowDown' &&
                          e.currentTarget.selectionStart === e.currentTarget.value.length
                        ) { e.preventDefault(); void edit.moveDown() }
                      }}
                    />
                  ) : (
                    <>
                      <SyntaxHighlightedContent text={line} language={language} />
                      {editable && (
                        <button
                          className={styles.editPencil}
                          title="Edit this line"
                          onClick={() => edit.enter(fileLine)}
                        >
                          <Pencil size={11} />
                        </button>
                      )}
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </code>
      </pre>
    )
  }
  ```
- [ ] In `src/renderer/src/components/RepoView.tsx`, replace the inner `<pre className={styles.fullFilePre}>…</pre>` (currently at ~884-893, inside `{!fileLoading && !fileError && fileContent !== null && (<div className={styles.fullFileViewer}> … )}`) with:
  ```tsx
  <div className={styles.fullFileViewer}>
    <FullFileEditableView
      fileContent={fileContent}
      language={workingTreeFileLanguage}
      absPath={`${repoPath}/${workingTreeFile.path}`}
      editable={!workingTreeFile.staged}
      onSaved={handleEditorFileSaved}
    />
  </div>
  ```
  and add `import { FullFileEditableView } from './FullFileEditableView'` to RepoView's imports.
- [ ] Typecheck: `npm run typecheck`
- [ ] Launch and manually verify (no permission needed per project memory): `npm run dev`
  1. Select an UNSTAGED modified (or untracked) file → center toolbar → **File** view.
  2. Hover any line → a pencil icon appears at the row's right; click it → that row becomes an `<input>` pre-filled with the line text, diff/file context still visible around it.
  3. Type a change, press **Enter** → file is saved (Part 2 refresh re-renders) and the edit moves to the next line down.
  4. **ArrowDown** with the caret at end-of-text and **ArrowUp** with the caret at position 0 move the edit between adjacent lines; **Esc** cancels with no write.
  5. Select a STAGED file → File view shows NO pencils (read-only). Confirm.
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/FullFileEditableView.tsx src/renderer/src/components/RepoView.tsx
  git commit -m "feat(inline-edit): in-place single-line editing in working-tree File view"
  ```

---

### Task 6 (5a): Inline diff view editing (`InlineDiffView`, virtualized rows)

Wire the same hook into `InlineDiffView` and thread an `inlineEdit` prop through `DiffViewer` so ONLY the working-tree diff viewer is editable (commit/index/blame diffs never receive the prop). (HIGHEST RISK: editing input lives inside react-window rows that unmount on scroll; `buffer`/`editing` live in the hook above the list so state survives, and `autoFocus` re-grabs focus on remount.)

**Files:**
- Modify: `src/renderer/src/components/DiffViewer.tsx`
  - `DiffViewerProps` (~532-566): add `inlineEdit?` field.
  - `DiffViewer(...)` signature + body (~581-595, ~701): destructure and forward `inlineEdit` to `InlineDiffView`.
  - `InlineVirtualRowProps` (~1131-1139): add an `edit?` field.
  - `InlineVirtualRow` line branch (~1194-1230): render input when editing; render pencil on editable rows.
  - `InlineDiffView` (~1234-1345): build `targets`/`lineText`, instantiate the hook, pass `edit` into `rowProps`.
- Modify: `src/renderer/src/components/RepoView.tsx` (~816-832): pass `inlineEdit` to the working-tree `<DiffViewer>` only.
- Test: none (virtualized; manual verification).

**Interfaces:**
- Produces: `DiffViewerProps.inlineEdit?: { absPath: string; onSaved: () => void }`.
- Consumes: `useInlineLineEdit` (Task 3), `buildEditableTargets` (Task 1), `EditableTarget`.

**Steps:**

- [ ] Add to `DiffViewerProps` (after `onNavigateFile`, ~565):
  ```ts
    /**
     * When present, enables in-place line editing in the inline + side-by-side
     * views (working-tree files only). Absent for commit/index/blame diffs,
     * which stay read-only.
     */
    inlineEdit?: { absPath: string; onSaved: () => void }
  ```
- [ ] Destructure `inlineEdit` in the `DiffViewer({ … })` parameter list (~581-595) and forward it at the inline render site (~701):
  ```tsx
  <InlineDiffView hunks={parsed.hunks} language={language} hunkActions={hunkActions} inlineEdit={inlineEdit} />
  ```
- [ ] Extend `InlineVirtualRowProps` (~1131) with:
  ```ts
    edit?: {
      controller: import('./useInlineLineEdit').UseInlineLineEdit
      editableLines: Set<number> // fileLines that may show a pencil
    }
  ```
- [ ] In `InlineVirtualRow`, destructure `edit` from props (~1146) and, inside the line branch (replace the `.lineContent` span body at ~1220-1229), render the input when this row is the edit focus, else content + pencil:
  ```tsx
  <span className={styles.lineContent}>
    {edit && edit.controller.editing && line.newLineNum != null &&
     edit.controller.editing.focusLine === line.newLineNum ? (
      <input
        className={styles.inlineEditInput}
        autoFocus
        value={edit.controller.buffer}
        onChange={(e) => edit.controller.setBuffer(e.target.value)}
        onKeyDown={(e) => {
          const c = edit.controller
          if (e.key === 'Enter') { e.preventDefault(); void c.moveDown() }
          else if (e.key === 'Escape') { e.preventDefault(); c.cancel() }
          else if (e.key === 'ArrowUp' && e.currentTarget.selectionStart === 0) {
            e.preventDefault(); void c.moveUp()
          } else if (e.key === 'ArrowDown' &&
                     e.currentTarget.selectionStart === e.currentTarget.value.length) {
            e.preventDefault(); void c.moveDown()
          }
        }}
      />
    ) : wordDiffInfo ? (
      <WordDiffContent
        segments={line.type === 'removed' ? wordDiffInfo.oldSegments : wordDiffInfo.newSegments}
        lineType={line.type}
      />
    ) : (
      <>
        <SyntaxHighlightedContent text={line.content} language={language} />
        {edit && line.newLineNum != null && edit.editableLines.has(line.newLineNum) && (
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
  ```
  Add `Pencil` to the existing `lucide-react` import at line 3.
- [ ] In `InlineDiffView`, accept the prop and build the controller. Update the signature (~1234-1242) to add `inlineEdit?: { absPath: string; onSaved: () => void }`, then after `items` is built (~1287) add:
  ```ts
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
    onSaved: inlineEdit?.onSaved ?? (() => {})
  })
  const editForRows = useMemo(
    () => inlineEdit
      ? { controller: editController, editableLines: new Set(editTargets.map((t) => t.fileLine)) }
      : undefined,
    [inlineEdit, editController, editTargets]
  )
  ```
  Add `import { buildEditableTargets } from '../utils/inlineEditNav'` and `import { useInlineLineEdit } from './useInlineLineEdit'` at the top of DiffViewer.tsx. Add `edit: editForRows` to the `rowProps` object (~1312-1320) and add `editForRows` to its dependency array.
- [ ] In `RepoView.tsx`, pass `inlineEdit` to the working-tree `<DiffViewer>` only (insert after `onDiscardHunk={handleDiscardHunk}` at ~831):
  ```tsx
  inlineEdit={
    workingTreeFile.staged
      ? undefined
      : { absPath: `${repoPath}/${workingTreeFile.path}`, onSaved: handleEditorFileSaved }
  }
  ```
- [ ] Typecheck: `npm run typecheck`
- [ ] Launch and manually verify: `npm run dev`
  1. Select an UNSTAGED modified file, **Diff** view, inline mode.
  2. Hover an added/context line → pencil appears; removed lines and hunk headers show NO pencil. Click a pencil → in-place `<input>` replaces just that row's content; the rest of the diff stays put.
  3. Edit + **Enter** → saves, diff refreshes via Part 2, edit advances to next editable row.
  4. With the edit on the LAST line of a hunk, press **ArrowDown** (caret at end) → the edit jumps to the FIRST editable line of the NEXT hunk (not an invisible next file line). This is the headline behavior surfacing in the UI.
  5. Open a historical commit diff (Back to Graph → a commit) → NO pencils anywhere (read-only). Confirm.
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/DiffViewer.tsx src/renderer/src/components/RepoView.tsx
  git commit -m "feat(inline-edit): in-place single-line editing in working-tree inline diff view"
  ```

---

### Task 7 (5b): `extendSelection` in the nav module (contiguous-only rule)

Multi-line extension is allowed only onto an adjacent file line (focus ± 1) so the spanned rows always map to a contiguous block — keeping the textarea exactly equal to file lines `[min..max]`.

**Files:**
- Modify: `src/renderer/src/utils/inlineEditNav.ts`
- Modify: `src/renderer/src/utils/__tests__/inlineEditNav.test.ts` (add a describe block)

**Interfaces:** Produces `extendSelection(anchorFileLine: number, focusFileLine: number, dir: 'up' | 'down', targets: EditableTarget[]): { anchorFileLine: number; focusFileLine: number } | null`.

**Steps:**

- [ ] Add the failing test block to `inlineEditNav.test.ts`:
  ```ts
  import { extendSelection } from '../inlineEditNav'

  describe('extendSelection', () => {
    const t = buildEditableTargets(items) // from the top-of-file fixture
    it('extends down onto the adjacent file line', () => {
      expect(extendSelection(11, 11, 'down', t)).toEqual({ anchorFileLine: 11, focusFileLine: 12 })
    })
    it('extends up onto the adjacent file line', () => {
      expect(extendSelection(12, 12, 'up', t)).toEqual({ anchorFileLine: 12, focusFileLine: 11 })
    })
    it('refuses to extend across a non-contiguous gap (hunk boundary: 12 -> 50)', () => {
      expect(extendSelection(12, 12, 'down', t)).toBeNull()
    })
    it('refuses to extend past the ends', () => {
      expect(extendSelection(51, 51, 'down', t)).toBeNull()
    })
  })
  ```
- [ ] Run it (expected FAIL): `npm run test -- inlineEditNav`
- [ ] Append to `inlineEditNav.ts`:
  ```ts
  /**
   * Grow/shrink a multi-line edit by one row in display order. Returns the new
   * {anchorFileLine, focusFileLine}, or null if the step is not allowed.
   *
   * Extension is permitted only onto an *adjacent* file line (focus ± 1), so
   * the spanned rows always map to a contiguous block of file lines — which
   * keeps the textarea content exactly equal to file lines [min..max].
   */
  export function extendSelection(
    anchorFileLine: number,
    focusFileLine: number,
    dir: 'up' | 'down',
    targets: EditableTarget[]
  ): { anchorFileLine: number; focusFileLine: number } | null {
    const next = dir === 'down'
      ? nextEditable(focusFileLine, targets)
      : prevEditable(focusFileLine, targets)
    if (!next) return null
    const expected = dir === 'down' ? focusFileLine + 1 : focusFileLine - 1
    if (next.fileLine !== expected) return null
    return { anchorFileLine, focusFileLine: next.fileLine }
  }
  ```
- [ ] Run (expected PASS): `npm run test -- inlineEditNav`
- [ ] Typecheck: `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/utils/inlineEditNav.ts src/renderer/src/utils/__tests__/inlineEditNav.test.ts
  git commit -m "feat(inline-edit): contiguous extendSelection for multi-line edits"
  ```

---

### Task 8 (5b): Fill in `extendUp`/`extendDown` + multi-line commit in the hook

Replace the Task 3 no-ops with real extend logic that recomputes the buffer from the spanned lines; the existing `commit()` already handles multi-line because it uses `min/max` of `anchorLine`/`focusLine`.

**Files:**
- Modify: `src/renderer/src/components/useInlineLineEdit.ts`
- Modify: `src/renderer/src/components/__tests__/useInlineLineEdit.test.ts` (add a describe block)

**Interfaces:** Consumes `extendSelection` (Task 7). No signature change.

**Steps:**

- [ ] Add the failing test block to `useInlineLineEdit.test.ts` (reuses the `targets`/`lineText`/mocks from that file):
  ```ts
  describe('multi-line extend', () => {
    it('extendDown grows the range and rebuilds the buffer from the spanned lines', () => {
      const { result } = setup()
      act(() => result.current.enter(1))
      act(() => result.current.extendDown())
      expect(result.current.editing).toEqual({ anchorLine: 1, focusLine: 2 })
      expect(result.current.buffer).toBe('one\ntwo')
    })

    it('commit of a multi-line edit block-replaces lines and preserves the rest', async () => {
      const { result } = setup()
      act(() => result.current.enter(1))
      act(() => result.current.extendDown())
      act(() => result.current.setBuffer('X\nY\nZ'))
      await act(async () => { await result.current.commit() })
      expect(writeMock).toHaveBeenCalledWith('/repo/f.txt', 'X\nY\nZ\nthree\n')
    })

    it('extendDown is a no-op across a non-contiguous gap', () => {
      const { result } = setup()
      act(() => result.current.enter(3)) // last contiguous target in this fixture
      act(() => result.current.extendDown())
      expect(result.current.editing).toEqual({ anchorLine: 3, focusLine: 3 })
    })
  })
  ```
- [ ] Run it (expected FAIL — extend is a no-op): `npm run test -- useInlineLineEdit`
- [ ] In `useInlineLineEdit.ts`, add `extendSelection` to the import and a buffer helper, and replace the placeholder `extendUp`/`extendDown`:
  ```ts
  import { EditableTarget, nextEditable, prevEditable, extendSelection } from '../utils/inlineEditNav'
  // ...
  function bufferForRange(anchor: number, focus: number, lineText: Map<number, string>): string {
    const lo = Math.min(anchor, focus)
    const hi = Math.max(anchor, focus)
    const out: string[] = []
    for (let ln = lo; ln <= hi; ln++) out.push(lineText.get(ln) ?? '')
    return out.join('\n')
  }
  ```
  ```ts
    const extendDown = useCallback(() => {
      if (!editing) return
      const ext = extendSelection(editing.anchorLine, editing.focusLine, 'down', targets)
      if (!ext) return
      setEditing(ext)
      setBuffer(bufferForRange(ext.anchorLine, ext.focusLine, lineText))
    }, [editing, targets, lineText])

    const extendUp = useCallback(() => {
      if (!editing) return
      const ext = extendSelection(editing.anchorLine, editing.focusLine, 'up', targets)
      if (!ext) return
      setEditing(ext)
      setBuffer(bufferForRange(ext.anchorLine, ext.focusLine, lineText))
    }, [editing, targets, lineText])
  ```
- [ ] Run (expected PASS): `npm run test -- useInlineLineEdit`
- [ ] Typecheck: `npm run typecheck`
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/useInlineLineEdit.ts src/renderer/src/components/__tests__/useInlineLineEdit.test.ts
  git commit -m "feat(inline-edit): multi-line extend + block-replace commit in hook"
  ```

---

### Task 9 (5b): Multi-line `<textarea>` row + Shift+Enter + Ctrl+Shift+Arrow wiring

When the edit spans >1 line, the focus row renders a `<textarea>` instead of an `<input>`; Shift+Enter inserts a literal newline; Ctrl+Shift+ArrowUp/Down call `extendUp`/`extendDown`. Apply to BOTH `FullFileEditableView` and `InlineDiffView`. The non-focus rows in the span are visually marked but not separately editable (the textarea owns them). (HIGH RISK rendering — manual verification.)

**Files:**
- Modify: `src/renderer/src/components/FullFileEditableView.tsx`
- Modify: `src/renderer/src/components/DiffViewer.tsx` (`InlineVirtualRow` line branch)
- Test: none (manual).

**Interfaces:** No new exports. Uses `edit.controller.extendUp/extendDown` (Task 8) and the `editing.anchorLine`/`focusLine` span.

**Steps:**

- [ ] Add a small shared key handler helper at the top of `FullFileEditableView.tsx` (and an equivalent inline in DiffViewer) that both `<input>` and `<textarea>` use:
  ```tsx
  function isMultiLine(editing: { anchorLine: number; focusLine: number } | null): boolean {
    return !!editing && editing.anchorLine !== editing.focusLine
  }
  ```
- [ ] In `FullFileEditableView`, change the editing-row render so it picks `<textarea>` when `isMultiLine(edit.editing)` and the row is within `[min(anchor,focus), max(anchor,focus)]`; only the focus row hosts the control. Replace the `isEditing` computation and the `<input>` branch with:
  ```tsx
  const ed = edit.editing
  const lo = ed ? Math.min(ed.anchorLine, ed.focusLine) : 0
  const hi = ed ? Math.max(ed.anchorLine, ed.focusLine) : -1
  const isFocusRow = !!ed && ed.focusLine === fileLine
  const isInSpan = !!ed && fileLine >= lo && fileLine <= hi
  // ...
  {isFocusRow ? (
    isMultiLine(ed) ? (
      <textarea
        className={styles.inlineEditTextarea}
        autoFocus
        rows={hi - lo + 1}
        value={edit.buffer}
        onChange={(e) => edit.setBuffer(e.target.value)}
        onKeyDown={onEditKeyDown}
      />
    ) : (
      <input className={styles.inlineEditInput} autoFocus value={edit.buffer}
             onChange={(e) => edit.setBuffer(e.target.value)} onKeyDown={onEditKeyDown} />
    )
  ) : isInSpan ? null /* covered by the textarea above */ : ( /* normal content + pencil */ )}
  ```
  where `onEditKeyDown` is:
  ```tsx
  const onEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const c = edit
    if (e.key === 'Enter' && e.shiftKey) { return /* allow newline in textarea */ }
    if (e.key === 'Enter') { e.preventDefault(); void c.moveDown(); return }
    if (e.key === 'Escape') { e.preventDefault(); c.cancel(); return }
    if (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') { e.preventDefault(); c.extendDown(); return }
    if (e.ctrlKey && e.shiftKey && e.key === 'ArrowUp') { e.preventDefault(); c.extendUp(); return }
    const t = e.currentTarget
    if (!e.shiftKey && e.key === 'ArrowUp' && t.selectionStart === 0) { e.preventDefault(); void c.moveUp() }
    else if (!e.shiftKey && e.key === 'ArrowDown' && t.selectionStart === t.value.length) {
      e.preventDefault(); void c.moveDown()
    }
  }
  ```
  Note: for `<input>` Shift+Enter cannot insert a newline, so Shift+Enter only matters once the row is already a textarea; that is acceptable (single-line stays single until the user extends).
- [ ] Apply the same `<textarea>`/`onEditKeyDown` treatment in `InlineVirtualRow`'s line branch in DiffViewer.tsx: when `edit.controller.editing` spans multiple lines and `line.newLineNum === editing.focusLine`, render a `<textarea rows={span}>`; for rows strictly inside the span but not the focus row, render an empty `.lineContent` (the textarea visually covers them). Reuse the same key-handler logic against `edit.controller`.
- [ ] Typecheck: `npm run typecheck`
- [ ] Launch and manually verify: `npm run dev`
  1. File view of an unstaged file: click a pencil, then **Ctrl+Shift+ArrowDown** → the row grows into a `<textarea>` covering the two lines, buffer = both lines joined by newline.
  2. Inside the textarea, **Shift+Enter** inserts a newline (does not commit); **Enter** commits the whole block and moves down. After commit the file shows the replacement (e.g. a 2-line block becomes however many lines you typed).
  3. **Esc** cancels the multi-line edit. **Ctrl+Shift+ArrowDown** at a hunk boundary does nothing (contiguous rule).
  4. Repeat 1–3 in the inline **Diff** view of an unstaged file.
- [ ] Commit:
  ```bash
  git add src/renderer/src/components/FullFileEditableView.tsx src/renderer/src/components/DiffViewer.tsx
  git commit -m "feat(inline-edit): multi-line textarea rows, Shift+Enter, Ctrl+Shift+Arrow extend"
  ```

---

### Task 10 (5b): Side-by-side (right pane) inline editing

Enable the same controller on the editable RIGHT side of `SideBySideDiffView` (the working-tree/new side). Left side stays read-only. Reuse the controller built in Task 6 by passing `inlineEdit` through to the side-by-side renderer.

**Files:**
- Modify: `src/renderer/src/components/DiffViewer.tsx`
  - `DiffViewer` (~702-708): forward `inlineEdit` to `<SideBySideDiffView>`.
  - `SideBySideDiffView` signature + `SbsVirtualRowProps` (~1397-1406) + `SbsVirtualRow` right-cell render (~1408+): add the `edit` plumbing; right cell uses `meta.rightLineIdx` → the paired `pair.right` DiffLine → its `newLineNum` to decide editability.
- Test: none (virtualized; manual). The editability math is already covered by Task 1's pure tests because the right side uses the same `newLineNum`/`type` rule.

**Interfaces:** Consumes the same `inlineEdit` prop + `useInlineLineEdit` controller. The right side is editable iff `pair.right && pair.right.type !== 'removed' && pair.right.newLineNum != null`.

**Steps:**

- [ ] Forward the prop from `DiffViewer` (~703):
  ```tsx
  <SideBySideDiffView hunks={parsed.hunks} language={language} hunkActions={hunkActions} inlineEdit={inlineEdit} />
  ```
- [ ] In `SideBySideDiffView`, accept `inlineEdit?: { absPath: string; onSaved: () => void }`, and build the controller exactly as in `InlineDiffView` (Task 6) — but derive `targets`/`lineText` from the right side of `pairLinesForSideBySide`'s output (or, simpler, reuse `buildEditableTargets(items)` over the same flat inline `items` model since file-line identity is shared). Build:
  ```ts
  const editLineText = useMemo(() => {
    const m = new Map<number, string>()
    for (const h of hunks) for (const l of h.lines) {
      if (l.type !== 'removed' && l.newLineNum != null) m.set(l.newLineNum, l.content)
    }
    return m
  }, [hunks])
  const editTargets = useMemo(
    () => buildEditableTargets(hunks.flatMap((h) => [
      { type: 'hunkHeader' as const, line: null },
      ...h.lines.map((l) => ({ type: 'line' as const, line: { type: l.type, newLineNum: l.newLineNum } }))
    ])),
    [hunks]
  )
  const editController = useInlineLineEdit({
    absPath: inlineEdit?.absPath ?? '', targets: editTargets, lineText: editLineText,
    onSaved: inlineEdit?.onSaved ?? (() => {})
  })
  ```
  Pass `{ controller: editController, editableLines: new Set(editTargets.map((t) => t.fileLine)) }` (when `inlineEdit`) through `SbsVirtualRowProps.edit` into `rowProps`.
- [ ] In `SbsVirtualRow`'s right-cell render, mirror Task 6/9: if `edit.controller.editing?.focusLine === item.pair.right?.newLineNum`, render the `<input>`/`<textarea>` (with `onEditKeyDown`); else render the right content + a pencil when `item.pair.right?.newLineNum` is in `edit.editableLines`. Left cell unchanged (no pencil, no input).
- [ ] Typecheck: `npm run typecheck`
- [ ] Launch and manually verify: `npm run dev`
  1. Unstaged file, **Diff** view, switch to **side-by-side**.
  2. Hover the RIGHT pane → pencils appear on added/context rows; the LEFT pane never shows a pencil. Click → in-place input on the right side only.
  3. Enter commits + advances; ArrowUp/Down at edges and Ctrl+Shift+Arrow extend behave as in inline mode.
  4. Empty right cells (pure deletions, where `pair.right === null`) show no pencil and are not editable.
- [ ] Bump version + commit (final 5b ship, matching the repo's per-feature version-bump convention):
  ```bash
  npm version patch --no-git-tag-version
  git add src/renderer/src/components/DiffViewer.tsx package.json
  git commit -m "feat(inline-edit): side-by-side right-pane in-place editing; bump version"
  ```
