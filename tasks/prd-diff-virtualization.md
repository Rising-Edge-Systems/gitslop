# PRD: Diff Viewer Virtualization

## Introduction

The FullDiffView and side-by-side DiffViewer render every row to the DOM, which becomes slow for large diffs (4000+ rows). Profiling shows the React render function completes in 8ms, but the browser takes significant time to create, layout, and paint thousands of DOM elements. Virtualizing the diff rows with react-window (already used by the commit graph) will render only the ~40 visible rows, making large diffs load instantly.

## Goals

- Virtualize diff row rendering so only visible rows are in the DOM
- Large diffs (4000+ rows) load as fast as small diffs
- No visual regression in diff appearance, syntax highlighting, or interactions
- Reuse react-window (already a project dependency)

## User Stories

### US-DV-001: Virtualize FullDiffView rows
**Description:** As a user, I want the Full diff view to render instantly even for large files, so that switching to Full view doesn't hang the UI.

**Acceptance Criteria:**
- [ ] FullDiffView uses react-window FixedSizeList to render only visible rows
- [ ] Row height is fixed (matching the current line height — measure from the existing CSS, likely ~20px)
- [ ] The FixedSizeList receives the `fullRows` array length as `itemCount`
- [ ] Each rendered row is a flex row with left cell (50% width) and right cell (50% width), same as the current non-virtualized layout
- [ ] Pane headers (filename + line count) render OUTSIDE the virtualized list, above it, as sticky headers
- [ ] Syntax highlighting (SyntaxHighlightedContent) works on visible rows
- [ ] Diff coloring (added/removed/context) works correctly
- [ ] Hunk divider bars render at the correct positions between hunks
- [ ] Line numbers display correctly on both sides
- [ ] Scrollbar diff markers (ScrollbarMarkers) still work — they render based on the full data array, not the visible rows
- [ ] Binary file and large file placeholders still render (these bypass virtualization)
- [ ] Container resizing (ResizeObserver) updates the list height
- [ ] Typecheck passes, existing tests pass

### US-DV-002: Virtualize side-by-side DiffViewer rows
**Description:** As a user, I want the side-by-side diff view to render instantly for large diffs.

**Acceptance Criteria:**
- [ ] The side-by-side mode in DiffViewer uses react-window FixedSizeList
- [ ] Each row renders as a paired flex row (left hunk line + right hunk line)
- [ ] Hunk headers render as full-width rows within the virtualized list
- [ ] Word-level diff highlighting works on visible rows
- [ ] Line numbers, syntax highlighting, diff coloring all render correctly
- [ ] Hunk action bars (stage/unstage/discard) render correctly at hunk boundaries
- [ ] Line selection checkboxes for staging still work
- [ ] Typecheck passes, existing tests pass

### US-DV-003: Staging interactions with virtualized rows
**Description:** As a user, I want line-level staging (selecting lines, staging/unstaging hunks) to work correctly with the virtualized diff view.

**Acceptance Criteria:**
- [ ] Clicking a line selection checkbox selects/deselects that line
- [ ] Shift-clicking for range selection works across virtualized rows (even if some rows in the range are off-screen)
- [ ] Hunk action bars (Stage Hunk, Unstage Hunk, Discard Hunk) work correctly
- [ ] Selected line highlighting persists when scrolling rows in and out of view
- [ ] The selection state is maintained in the parent component (not in the row DOM)
- [ ] Typecheck passes, existing tests pass

### US-DV-004: Remove large diff threshold
**Description:** As a developer, I want to remove or significantly raise the large diff collapse threshold since virtualization makes all diffs fast to render.

**Acceptance Criteria:**
- [ ] Remove LARGE_FILE_LINE_LIMIT and LARGE_FILE_THRESHOLD constants, or raise them to 50000+
- [ ] Remove the "Click to expand" / "Large diff" placeholder from DiffViewer (no longer needed with virtualization)
- [ ] Remove the "Large file — click to load" placeholder from FullDiffView (no longer needed)
- [ ] Remove `largeDiffExpanded`, `loadLargeFile`, `displayLimit` state variables that supported the collapse feature
- [ ] Remove truncation logic that limited displayed hunks
- [ ] Typecheck passes, existing tests pass

## Functional Requirements

- FR-1: Use react-window FixedSizeList for rendering diff rows in both FullDiffView and side-by-side mode
- FR-2: Row height must be fixed and consistent (measure from CSS, likely 20px per line)
- FR-3: The virtualized list must fill the available container height (use ResizeObserver)
- FR-4: Scrollbar markers render based on the full data, not the visible subset
- FR-5: All staging interactions work with virtualized rows
- FR-6: Remove the large diff collapse/expand mechanism

## Non-Goals

- No variable row height (would require react-window's VariableSizeList and height measurement — too complex for this iteration)
- No horizontal virtualization (lines can be long, but horizontal scrolling is fine)
- No change to inline diff mode (single column, already fast enough)

## Technical Considerations

- **react-window is already a dependency** — used by CommitGraph. Same FixedSizeList pattern.
- **Row height:** The existing CSS sets line-height for diff rows. Measure it and use as the fixed item size. If the current CSS uses variable heights (e.g. hunk headers are taller), either make them uniform or use a consistent height and add padding within.
- **Hunk dividers:** These are currently rendered inline between rows. With virtualization, they need to become rows themselves in the item list — add them to the data array as "divider" entries with a type field.
- **buildFullDiffRows:** Already returns a flat array of rows. Add a `type: 'row' | 'hunkDivider'` field to distinguish content rows from divider rows.
- **SyntaxHighlightedContent:** Runs per-row, should be fine with virtualization since only visible rows execute it.
- **ScrollbarMarkers:** Already computed from the full data array (fullDiffMarkers useMemo). No change needed — just pass the container ref.
- **Container height:** Use a ResizeObserver on the parent container to get the available height for the FixedSizeList. Same pattern as CommitGraph's containerHeight state.

## Success Metrics

- Full view for a 4000-row diff loads in < 200ms (down from 1-2 seconds)
- No visible difference in diff appearance between old and new implementation
- All staging features work identically
