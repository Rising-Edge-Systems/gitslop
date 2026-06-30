# Text-View Enhancements & Release Fix — Design

**Date:** 2026-06-30
**Status:** Awaiting approval
**Scope:** Five independent work items against the text/diff views plus a CI fix. Each ships on its own; sequencing is recommended, not required.

---

## Background

The center "text views" are:

| View | Component | Virtualized? | Editor |
|------|-----------|--------------|--------|
| Diff — inline | `DiffViewer` → `InlineDiffView` | yes (react-window) | custom highlighter |
| Diff — side-by-side | `DiffViewer` → `SideBySideDiffView` | yes (react-window) | custom highlighter |
| Full | `FullDiffView` | yes (react-window) | custom highlighter |
| File | `<pre>` in `RepoView` | no | custom highlighter |
| Blame | `BlameView` | no | custom highlighter |
| Edit-this-file | `CodeEditor` | n/a | **Monaco** (native find/edit) |

Syntax highlighting is a hand-rolled tokenizer (`highlightLine` → `SyntaxHighlightedContent`, `DiffViewer.tsx:183-266, 2279`). There is **no** find, occurrence-highlight, or inline-line-edit anywhere outside Monaco. View mode is the persisted enum `DiffViewMode = 'inline' | 'side-by-side' | 'full' | 'file'` (`useLayoutState.ts:290`), collapsed in `RepoView` to a 3-way `centerViewMode: 'diff' | 'full' | 'file'`.

---

## Item 1 — Fix the release pipeline (urgent)

**Problem.** The v1.2.30 build & release run failed. Root cause from the failed log: GitHub rolled the `windows-latest` runner image to `windows-2025-vs2026`, and the `node-gyp` bundled for rebuilding the native `node-pty` module can't detect that Visual Studio toolchain:

```
Error: Could not find any Visual Studio installation to use
  ⨯ node-gyp failed to rebuild 'node_modules\node-pty'
##[error]Process completed with exit code 1.
```

v1.2.29 built fine on June 12; this broke June 17 purely from the image rollover. Linux/Mac jobs are unaffected.

**Approach.** Pin the Windows matrix entry in `.github/workflows/build.yml` from `windows-latest` to `windows-2022`, which ships an MSVC toolchain `node-gyp` detects. One-line change plus an explanatory comment.

Because the failed tag `v1.2.30` points at a commit that predates the workflow fix, re-running it would still fail. So: commit the workflow fix, bump to **1.2.31**, tag `v1.2.31`, push.

**Files:** `.github/workflows/build.yml` (line 36–37), `package.json` (version).

**Risk:** Low. `windows-2022` is a known-good, still-supported image. If GitHub deprecates it later, the durable follow-up is `microsoft/setup-msbuild` + `msvs_version`, but that's out of scope here.

---

## Item 2 — Stop the view refresh from resetting scroll on file change

**Problem.** When **any** file in the working tree changes on disk, the open text view reloads and jumps to the top. Two annoyances: (a) it fires for unrelated files, and (b) it loses scroll position — painful when validating an AI's in-progress edits near the bottom of a file.

**Root cause (traced).** `onRepoChanged` (`RepoView.tsx:576`) bumps `workingTreeRefreshKey`. That key is a dependency of all three working-tree loaders (`:207`, `:393`, `:431`), each of which sets `loading = true` (and the full loader nulls its content). The render gates require `!loading && content !== null` (`:815`, `:848`, `:882`), so the viewer **unmounts** to a "Loading…" placeholder, then the refetch mounts a **brand-new** react-window `List` at `scrollTop = 0`. No scroll preservation exists. `repo:changed` carries no path payload, so every change refreshes the open view regardless of relevance.

**Approach (confirmed: refresh in place, keep scroll, only the open file).** Three coordinated changes:

1. **Background refresh ≠ initial load.** In the working-tree loaders, only set `loading = true` (and clear content) when there is no current content *or* the file/commit identity changed. For a pure `workingTreeRefreshKey` bump while content already exists, fetch silently and swap the new content in **without** unmounting the viewer. The full loader stops nulling `oldContent`/`newContent` before the refetch resolves.

2. **Preserve scroll across the swap.** With the viewer kept mounted, react-window retains its scroll offset as long as the `List` element survives. As a safety net (in case row count shifts), capture the top visible line before the swap and restore scroll to it after. For the non-virtualized File/Blame views, the DOM scroll persists automatically once we stop unmounting.

3. **Only refetch the open file.** Extend the main-process watcher to include the set of changed repo-relative paths in the `repo:changed` IPC payload (collected across the debounce window). `RepoView`'s handler refetches the open working-tree file's diff/full/file content **only** when that path (or the index, for staged views) is among the changed paths; otherwise it leaves the view untouched. Other subscribers (status panel, file tree) keep their existing global refresh behavior — only the center view becomes path-aware.

**Files:** `src/main/index.ts` (`sendRepoChanged` ~`:2124-2140`, watcher event handlers ~`:2217-2291`), `src/preload/index.ts` (`onRepoChanged` ~`:393`), `src/renderer/src/components/RepoView.tsx` (`onRepoChanged` handler `:576`, the three loaders + render gates). react-window scroll API in `DiffViewer.tsx` for the restore safety net.

**Risk:** Medium. Touches the loader/gate logic and the IPC payload shape. Mitigated by keeping the global refresh intact for non-center subscribers and treating path-filtering as an additive optimization on top of the must-have (in-place + scroll-preserving) refresh.

---

## Item 3 — Ctrl+F find in all text views

**Problem.** No in-text find exists outside Monaco.

**Approach.** A VSCode-style find widget + a shared find controller, wired into every custom view.

- **Widget.** A `FindWidget` overlay pinned top-right inside the center view container (make `centerDiffContainer` `position: relative`). Contains: query input, match counter ("3 of 17"), prev/next buttons, close (✕), and toggles for **case-sensitive**, **whole-word**, **regex** (start with case + whole-word; regex is cheap to add given we already iterate the model). Styled after `SearchPalette` conventions.
- **Controller.** A `useFindController(lines, query, opts)` hook that computes matches against the view's underlying line model (array of `{ text }`), returning `Match[] = { lineIndex, start, end }` and tracking `currentIndex`. Works for every view because each already has a flat line/row model; nothing relies on DOM scanning (required, since the views are virtualized).
- **Keybinding.** Register `Ctrl+F` in the existing shortcut registry (the `CodeEditor` `Ctrl+S` pattern), `enabled` only when a custom text view is active (`centerViewMode` ∈ diff/full/file/blame and not in Monaco edit mode). `Enter`/`Shift+Enter` = next/prev, `Esc` = close. When Monaco is focused, our handler is disabled and Monaco's native find takes over.
- **Match rendering.** Add a per-line highlight layer: a function `renderWithHighlights(text, syntaxTokens, ranges)` that intersects syntax tokens with highlight ranges and emits `<mark className={findMatch}>` (and `findMatchCurrent` for the active match). This is the single rendering primitive reused by Item 4. Wire it into `SyntaxHighlightedContent` and the side-by-side/full row renderers.
- **Scroll-to-match.** Drive react-window's `List` scroll API (`scrollToRow`) to bring the current match's row into view; `scrollIntoView`/`scrollTop` for the non-virtualized File/Blame views.
- **Scrollbar markers.** Reuse the existing marker-gutter infra (`computeMarkers`, `ScrollbarMarkers`, `DualScrollbarMarkers`, `DiffViewer.tsx:727, 827`) to add a find-match tick layer.

**Scope of views:** diff inline, diff side-by-side, full, file, blame. Monaco keeps its native find.

**Files:** new `FindWidget.tsx` (+ CSS module) and `useFindController.ts`; edits to `DiffViewer.tsx` (row renderers, markers, scroll API, widget mount points for the three internal lists), `RepoView.tsx` (File view + widget hosting + Ctrl+F registration), `BlameView.tsx` (widget + highlight), `useKeyboardShortcuts` registration.

**Risk:** Medium. Largest UI surface after inline edit, but well-bounded; the highlight primitive and scroll/marker infra already have analogues to copy.

---

## Item 4 — Highlight all occurrences of the selected text

**Problem.** Selecting a string should highlight all its other occurrences, like VSCode.

**Approach (match VSCode's `editor.selectionHighlight`).** On selection change within a text view, read the selection and, when it satisfies VSCode's rules, highlight all matches via the **same** per-line highlight primitive from Item 3 (distinct class `selectionHighlight`, lower-emphasis than find).

VSCode's rules, which we replicate:
- A single, **non-empty** selection (multi-cursor disables it).
- The selection is on **one line** (no newline).
- The selection is **not pure whitespace**.
- Matching is **case-sensitive**; when the selection exactly spans a word, match **whole-word**, otherwise match the literal substring.
- The active selection's own range is not double-highlighted (it already shows as the browser selection).

Implementation: a `useSelectionHighlight(lines)` hook listening on `selectionchange`/`mouseup` scoped to the active text container, producing the same `Match[]` shape fed into `renderWithHighlights`. Occurrences also get scrollbar-gutter ticks (a lighter layer than find). Clears on deselection. Find-match highlight and selection highlight coexist with different colors, exactly as VSCode does.

**Files:** new `useSelectionHighlight.ts`; reuses the Item 3 highlight primitive and marker infra; small wiring in each view.

**Risk:** Low–Medium once Item 3 exists — it's mostly the trigger logic + a second highlight class. This is why Items 3 and 4 ship together.

---

## Item 5 — Inline line editing in text views

**Problem.** Editing a line should be possible in place — hover a line, click an edit icon, edit it without leaving the diff (diff stays visible) — with smart keyboard behavior. The full "Edit this file" Monaco swap is too heavy for quick tweaks.

**Approach (confirmed: custom in-place rows, built incrementally).**

**Coordinate model.** All edit state lives in **working-tree file-line coordinates** (the on-disk file's line numbers). A displayed row is editable iff it maps to a current file line:
- Diff inline/side-by-side: context lines and **added** lines map to a current file line and are editable (on the new/right side); pure **deleted** rows and hunk headers are **not** editable.
- Full view: the "new" rows map to file lines.
- File view: every row is a file line (all editable).
- Blame and any **historical commit / index** view: **read-only** (no edit affordance — you can't edit a past snapshot in place).

**Edit state.** `editing: { anchorLine, focusLine } | null`. The inclusive range `[min, max]` is the set of file lines currently in edit mode.

**Interaction.**
- **Hover** an editable row → a pencil icon appears at the row edge. Click → enter edit mode for that single line (`anchor = focus = line`). The row's content cell becomes an `<input>` (single line) prefilled with the current file text, same height as the row; the diff around it stays rendered.
- **ArrowUp / ArrowDown** at the input's edge → commit the current line into an in-memory working buffer and move the edit to the **previous/next displayed editable row in display order** (skipping deleted rows and hunk headers). Because navigation follows *display order over editable rows*, arrowing past the top/bottom of a hunk lands on the adjacent hunk's nearest editable line — never an invisible intervening file line. This directly satisfies the "arrow past a hunk → next hunk, not the invisible next line" requirement as an emergent property, no special-casing.
- **Ctrl+Shift+ArrowUp / ArrowDown** → extend `focusLine` by one editable row in display order, putting multiple lines into edit mode. The block renders as a single `<textarea>` spanning the selected rows; reversing direction shrinks it.
- **Enter** in single-line input → commit and move down (spreadsheet-style). **Shift+Enter** → insert a newline (promotes to the multi-line textarea, i.e. splitting/adding lines).
- **Esc** → cancel the current unsaved edit and exit edit mode. Clicking outside commits.

**Saving.** Edits accumulate in a working copy of the file's lines. On commit (blur out of the edit system, explicit save, or short debounce), write via `window.electronAPI.file.write(path, newContent)`. That fires `repo:changed`, but with **Item 2** in place the diff refreshes in place with scroll preserved — so the edit's effect appears without disruption. (Item 2 is therefore a prerequisite for a pleasant inline-edit experience.)

**Virtualization handling.** Single-line edit swaps a row's content cell for an `<input>` of identical height — no layout disruption. Multi-line edit renders a `<textarea>` sized to the selected rows' combined height; if content grows beyond that, it scrolls internally for v1 (variable-height expansion in react-window is a later refinement). The editing range must stay mounted while scrolled; react-window keeps a row mounted only while visible, so for v1 we keep the edit affordance usable while the edited rows are on-screen and commit-on-scroll-away if needed.

**Incremental phases.**
- **5a (MVP):** hover edit icon + single-line in-place edit in the working-tree **File** view and **diff inline** view; ArrowUp/Down move the edit row in display order; Enter commit+down; Esc cancel; save to disk. Ships the core value.
- **5b:** Ctrl+Shift+Arrow multi-line editing (textarea), Shift+Enter newline, side-by-side support. Arrow-past-hunk behavior comes free from the display-order model.

**Files:** new `useInlineLineEdit.ts` (edit state + display-order navigation map); edits to `DiffViewer.tsx` (row renderers for inline/sbs/full to host the input/textarea + hover icon), `RepoView.tsx` (File view rows + save plumbing), reuse `file.read`/`file.write` (`preload/index.ts:382-387`).

**Risk:** High. This is the largest, most bug-prone item — caret/selection management, commit-on-navigate, virtualization edge cases, and write-back races. Hence the MVP/▸follow-up split, each tested before moving on.

---

## Recommended sequencing

1. **Item 1** (release fix) — unblocks shipping; trivial.
2. **Item 2** (scroll-preserving refresh) — high value on its own and a prerequisite for Item 5.
3. **Items 3 + 4** (find + occurrence highlight) — share the highlight primitive and marker infra; ship together.
4. **Item 5** (inline editing) — largest/riskiest; built on Item 2; phased 5a then 5b.

Each lands as its own commit + version bump and changelog entry (matching the `docs/STATUS.md` / `docs/ROADMAP.md` style). Items are independently revertible.

## Out of scope

- Find/replace (replace) — find-only for now.
- Regex find can be a fast-follow if the initial case/whole-word toggles suffice.
- Variable-height react-window expansion for very large multi-line inline edits.
- Editing historical commit snapshots in place.
