# PRD: Diff Viewer Scroll Sync Fix

## Introduction

The side-by-side diff viewer (both the split DiffViewer mode and the FullDiffView) uses two separate scrollable panes with JavaScript scroll synchronization. This causes a visible 1-frame offset where one pane scrolls ahead of the other during fast scrolling. The fix is to use a single scrollable container with two columns rendered inside it, eliminating the need for sync logic entirely.

## Goals

- Eliminate the visible scroll offset between left and right diff panes
- Both panes scroll as one — no JavaScript sync needed
- Maintain all existing functionality (syntax highlighting, line selection, hunk actions, diff markers)
- No regression in performance for large diffs

## User Stories

### US-DS-001: Single-container scroll for FullDiffView
**Description:** As a user, I want the Full diff view's left and right panes to scroll perfectly in sync, so that I can compare old and new file content without visual jitter.

**Acceptance Criteria:**
- [ ] FullDiffView renders both left and right panes inside a single scrollable `<div>` container
- [ ] Each row renders as a flex row with a left cell and right cell side-by-side
- [ ] Scrolling is handled natively by the single container — no `onScroll` handler, no `scrollTop` sync, no `syncingRef`
- [ ] Remove `leftPaneRef`, `rightPaneRef`, `syncingRef`, and `handleScrollSync` from FullDiffView
- [ ] Pane headers (filename + line count) remain sticky at the top of each column
- [ ] The vertical scrollbar is on the right edge of the combined container (not per-pane)
- [ ] Line numbers, syntax highlighting, diff coloring, hunk dividers all render correctly
- [ ] Hunk action bars span the full width of both columns
- [ ] Line selection checkboxes for staging still work (left pane = removed lines, right pane = added lines)
- [ ] Binary file and large file placeholders still render correctly
- [ ] Renamed file header still renders above the panes
- [ ] Scrollbar diff markers (the minimap markers on the right edge) still work — they should track the single container's scroll position
- [ ] Typecheck passes

### US-DS-002: Single-container scroll for side-by-side DiffViewer mode
**Description:** As a user, I want the side-by-side diff view to scroll perfectly in sync, matching the FullDiffView fix.

**Acceptance Criteria:**
- [ ] The side-by-side mode in DiffViewer renders both panes inside a single scrollable container
- [ ] Each hunk renders its left and right sides as aligned row pairs
- [ ] Remove `leftPaneRef`, `rightPaneRef`, `syncingRef`, and `handleScrollSync` from DiffViewer
- [ ] Hunk headers span the full width
- [ ] Line numbers, syntax highlighting, diff markers all render correctly
- [ ] Word-level diff highlighting still works in side-by-side mode
- [ ] Typecheck passes

### US-DS-003: Cleanup and polish
**Description:** As a developer, I want to remove dead scroll sync code and verify no regressions.

**Acceptance Criteria:**
- [ ] All references to the old scroll sync mechanism are removed (handleScrollSync, syncingRef, leftPaneRef/rightPaneRef for sync purposes)
- [ ] CSS for the pane layout updated: panes are no longer `overflow-y: auto` individually, the parent container handles scrolling
- [ ] No visual regressions in inline mode (which doesn't use side-by-side, should be unaffected)
- [ ] File view mode unaffected
- [ ] Large diff threshold and truncation still work
- [ ] Typecheck passes, existing tests pass

## Functional Requirements

- FR-1: Both diff panes share a single scroll container — no JavaScript scroll synchronization
- FR-2: Rows are rendered as paired cells (left + right) inside flex rows
- FR-3: Pane headers stick to the top using `position: sticky`
- FR-4: Scrollbar diff markers track the single container's scroll position
- FR-5: All staging features (line selection, hunk actions) continue to work

## Non-Goals

- No virtualization of diff rows (react-window). The existing approach renders all visible rows — virtualization would be a separate performance initiative.
- No change to inline diff mode (single column, no sync needed)
- No change to file view mode

## Technical Considerations

- **Current layout:** Two separate `<div>` panes, each with `overflow-y: auto`, synced via `onScroll` + `scrollTop` assignment
- **New layout:** One `<div>` with `overflow-y: auto` containing rows where each row is `display: flex` with two 50% children
- **Sticky headers:** Use `position: sticky; top: 0` on the header row. Since there's one scroll container, sticky works naturally.
- **FullDiffView already has aligned rows** via `buildFullDiffRows()` — the data model already produces paired left/right rows. The change is purely in how they're rendered (from two separate column lists to one unified row list).
- **Side-by-side DiffViewer** currently renders hunks separately per pane. This needs restructuring to render each hunk as paired rows.
- **ScrollbarMarkers component** currently receives a ref to a pane. It needs to receive the single container ref instead.
- **CSS `sbsPane` class** currently has `overflow-y: auto; flex: 1`. Change to `overflow: visible; flex: 1` (scrolling moves to parent).

## Success Metrics

- Zero visible scroll offset between panes during fast scrolling
- No performance regression for diffs under 5000 lines
- All existing diff viewer tests pass
