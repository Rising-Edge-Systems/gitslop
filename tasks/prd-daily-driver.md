# PRD: Daily Driver Usability Improvements

## Introduction

GitSlop needs to be usable as a daily replacement for GitKraken. This PRD addresses six specific usability gaps: file view modes in commit details, full file viewing, diff mode persistence, broken sidebar rail overlays, and comprehensive panel resizing with persistence.

## Goals

- Changed files in commit details support both flat path and directory tree views
- Users can view full file content, not just diffs
- Diff view mode (inline vs split) persists across files and sessions
- Sidebar icon rail buttons open section overlays when clicked
- All panel boundaries are user-resizable via drag handles
- All panel sizes persist across restarts

## User Stories

### US-DD-001: Diff View Mode Persistence
**Description:** As a user, I want my diff view preference (inline vs split) to persist so I don't have to switch it every time I open a new file.

**Acceptance Criteria:**
- [ ] Add `diffViewMode: 'inline' | 'side-by-side'` to the layout state in `useLayoutState.ts`
- [ ] Default value is `'inline'`
- [ ] When user toggles between inline and split in DiffViewer, the new mode is saved to layout state
- [ ] DiffViewer reads the persisted mode as its initial mode instead of always defaulting to `'inline'`
- [ ] Opening a new file uses the last-selected mode — NOT resetting to inline
- [ ] The preference survives app restart (persisted to localStorage via existing debounced save)
- [ ] Pass a callback prop from AppLayout → RepoView → DiffViewer to lift mode changes up to layout state
- [ ] Typecheck passes

### US-DD-002: Fix Sidebar Icon Rail Overlays
**Description:** As a user, I want the sidebar icon rail buttons to open floating overlays with section content when clicked.

**Acceptance Criteria:**
- [ ] The overlay code already exists in Sidebar.tsx (handleRailIconClick, railOverlay, RAIL_SECTIONS) — verify it renders
- [ ] If overlays don't appear, debug CSS: check `position`, `z-index`, `left` offset, and `overflow` on parent containers
- [ ] The overlay should appear to the right of the icon rail (left: 48px from rail edge)
- [ ] Overlay shows full section content: branches list for branches icon, file tree for files icon, etc.
- [ ] Clicking outside the overlay or pressing Escape closes it
- [ ] Clicking a different rail icon switches the overlay to that section
- [ ] The expand button (top icon, PanelLeftOpen) still expands the full sidebar
- [ ] Typecheck passes
- [ ] Verify visually: click each rail icon, overlay appears with correct content

### US-DD-003: Resizable Right Panel Width (Left-Right Drag)
**Description:** As a user, I want to drag the right panel (commit details + staging) wider or narrower.

**Acceptance Criteria:**
- [ ] A 5px vertical drag handle between the center panel and the right panel
- [ ] Drag handle shows `cursor: col-resize` on hover with subtle highlight
- [ ] Dragging resizes the right panel width in real time (min 280px, max 600px, default 340px)
- [ ] Double-click resets to 340px default
- [ ] Use `rightPanelSize` from useLayoutState (already in the interface but unused) — make it store pixels
- [ ] Right panel width persists across restarts
- [ ] Reuse the same drag handle pattern from the sidebar (mousedown/mousemove/mouseup on document)
- [ ] Typecheck passes
- [ ] Verify visually: drag handle appears, resizing works

### US-DD-004: Resizable Right Panel Vertical Split (Detail vs Staging)
**Description:** As a user, I want to drag the boundary between commit details and the staging area to give more space to either one.

**Acceptance Criteria:**
- [ ] A 5px horizontal drag handle between the detail panel section and the staging area section in the right panel
- [ ] Drag handle shows `cursor: row-resize` on hover with subtle highlight
- [ ] Dragging resizes the vertical split ratio in real time
- [ ] Minimum height for either section: 100px
- [ ] Default split: 60% detail / 40% staging (current behavior)
- [ ] Add `detailStagingSplit: number` to useLayoutState (percentage 0-100 for detail panel share)
- [ ] Split ratio persists across restarts
- [ ] Drag handle pattern: same mousedown/mousemove/mouseup approach, but tracking clientY delta
- [ ] Typecheck passes
- [ ] Verify visually: drag handle between sections, resizing works

### US-DD-005: Changed Files Tree View in Detail Panel
**Description:** As a user, I want to toggle between a flat path list and a directory tree view for changed files in the commit detail panel.

**Acceptance Criteria:**
- [ ] Two small toggle buttons above the changed files list: "Path" (List icon) and "Tree" (FolderTree icon)
- [ ] Path view: current flat list of file paths with status icons (existing behavior)
- [ ] Tree view: files grouped into a collapsible directory tree structure — directories are collapsible nodes, files are leaves
- [ ] Tree view shows: folder icon for directories, status icon for files, +/- counts on files
- [ ] Clicking a file in either view triggers the same `onFileClick` callback (opens diff in center)
- [ ] The selected file is highlighted in both views
- [ ] View mode persists: add `fileListView: 'path' | 'tree'` to layout state
- [ ] Typecheck passes
- [ ] Verify visually: toggle works, tree view shows nested directories

### US-DD-006: View Full File Content (Not Just Diff)
**Description:** As a user, I want to see the full content of a file in a commit, not just the diff.

**Acceptance Criteria:**
- [ ] When viewing a file's diff in the center panel, a toggle button in the diff header bar switches between "Diff" and "Full File" view
- [ ] "Diff" view: current behavior — shows additions/deletions with green/red highlighting
- [ ] "Full File" view: fetches and displays the complete file content at that commit (using `git show HASH:path`)
- [ ] Full file view has syntax highlighting (reuse the existing syntax highlighting from DiffViewer/CodeEditor)
- [ ] Full file view shows line numbers
- [ ] Add a new IPC handler `git:showFileAtCommit(repoPath, hash, filePath)` that runs `git show HASH:PATH`
- [ ] The toggle preference does NOT persist — defaults to "Diff" each time (diff is the primary use case)
- [ ] Binary files show "Binary file — cannot display" in full file mode
- [ ] Typecheck passes
- [ ] Verify visually: toggle works, full file displays with syntax highlighting

## Functional Requirements

- FR-1: Diff view mode saved to localStorage via useLayoutState, read by DiffViewer as initialMode
- FR-2: Sidebar rail icon clicks open floating overlay panels (already coded, needs CSS/rendering fix)
- FR-3: Right panel width resizable via drag handle, persisted to `rightPanelSize` in layout state
- FR-4: Right panel vertical split resizable via drag handle, persisted to `detailStagingSplit` in layout state
- FR-5: Changed files list supports Path (flat) and Tree (directory tree) views, toggled with buttons
- FR-6: Full file content viewable via `git show HASH:PATH`, displayed with syntax highlighting
- FR-7: All new layout values use the existing debounced localStorage persistence in useLayoutState

## Non-Goals

- Not making the center panel (commit graph area) resizable relative to the right panel — drag handle handles this
- Not implementing hunk-level staging from the center diff viewer
- Not adding drag reordering of files in the file list
- Not adding file search/filter in the changed files list (could be future work)

## Technical Considerations

- **Drag handle pattern**: Sidebar already has a working implementation in AppLayout.tsx (lines 230-266). Reuse the same mousedown/mousemove/mouseup on document approach. Track `isDragging` via ref, update state via setState, add `user-select: none` class to body during drag.
- **useLayoutState.ts**: Add new fields: `diffViewMode`, `detailStagingSplit`, `fileListView`. The `rightPanelSize` field already exists but is unused — activate it.
- **DiffViewer.tsx**: Currently manages mode via local `useState`. Need to accept an `onModeChange` callback prop to lift mode changes to layout state.
- **Tree view**: Build a utility function that takes `CommitFileDetail[]` and returns a tree structure: `{ name, path, children[], file? }`. Render with recursive component.
- **git show HASH:PATH**: Add to `git-service.ts` and `git-ipc.ts` — simple `git show` command. Add to preload API types.
- **Sidebar rail overlay**: The overlay code exists but may be hidden by CSS overflow or z-index issues on the parent container. The sidebar div in AppLayout has `overflow: hidden` which could clip the overlay.

## Success Metrics

- Diff mode persists across file changes and restarts
- All rail icon buttons open overlays on click
- User can resize every panel boundary by dragging
- Panel sizes survive restart
- File tree view provides quick navigation for commits with many files

## Open Questions

- Should the tree view auto-expand all directories or start collapsed?
- Should full file view support editing (probably not — that's a separate feature)?
