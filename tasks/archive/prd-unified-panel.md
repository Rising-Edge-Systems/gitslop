# PRD: Unified Detail & Staging Panel

## Introduction

Replace the stacked DetailPanel + StatusPanel layout in the right column with a single context-aware panel that switches between commit details and staging area based on what's selected in the commit graph — matching GitKraken's workflow. A virtual "WIP" (Work In Progress) row at the top of the commit graph represents uncommitted local changes and acts as the entry point to the staging area.

This eliminates the cramped split layout, gives each mode the full panel height, and creates an intuitive connection between the commit graph and the right panel.

## Goals

- Unify commit details and staging into one context-switching panel
- Add a WIP row to the commit graph that represents uncommitted changes
- Match GitKraken's UX: click WIP = staging, click commit = details, nothing selected = staging
- Remove the drag handle and split between DetailPanel and StatusPanel
- Preserve all existing staging and commit detail functionality
- Zero layout shift when switching between modes

## User Stories

### US-UP-001: WIP Row in Commit Graph
**Description:** As a user, I want to see a "WIP" row at the top of the commit graph representing my uncommitted local changes, so that I can see at a glance whether I have pending work and click it to access the staging area.

**Acceptance Criteria:**
- [ ] A virtual WIP row appears at position 0 in the commit graph (above all commits) when there are any working tree changes (staged, unstaged, or untracked files)
- [ ] The WIP row is hidden when the working tree is completely clean
- [ ] The WIP row has a distinct visual style: dotted/dashed circle node (not solid like commits), uses the HEAD lane (lane 0), shows text like "Working Tree Changes" or "WIP" in the message column
- [ ] The WIP row shows a summary of changes: e.g. "3 files changed" or "2 staged, 5 unstaged" in place of the author column
- [ ] The WIP row updates reactively when files change (via the existing `onRepoChanged` watcher event)
- [ ] The WIP row connects visually to the HEAD commit below it with a dashed/dotted line (not solid)
- [ ] The WIP row does not have a hash, author name, or date — those columns show contextual info or are blank
- [ ] Clicking the WIP row selects it (highlighted like a selected commit) and triggers the panel switch to staging mode
- [ ] The WIP row works correctly with react-window virtualization (it's index 0, all commit indices shift by 1)
- [ ] Typecheck and tests pass

### US-UP-002: Unified Right Panel — Mode Switching
**Description:** As a user, I want the right panel to automatically switch between staging area and commit details based on what I've selected in the commit graph, so that I have a single clean panel instead of two cramped stacked panels.

**Acceptance Criteria:**
- [ ] The right panel renders ONE of two modes: "staging" or "detail"
- [ ] Mode is "staging" when: the WIP row is selected, OR nothing is selected
- [ ] Mode is "detail" when: a real commit row is selected
- [ ] Switching between modes is instant — no loading state, no layout shift, no animation delay
- [ ] In "staging" mode: the panel shows the full StatusPanel content (unstaged files section, staged files section, commit form) using the full panel height
- [ ] In "detail" mode: the panel shows the full DetailPanel content (commit metadata, changed files list) using the full panel height. No collapse toggle on the detail panel header.
- [ ] The commit form state (subject, body, amend checkbox, sign-off, GPG sign) persists silently when switching from staging to detail mode and back — no warning dialogs, no data loss
- [ ] On initial repo load, the WIP row is auto-selected if there are working tree changes; otherwise HEAD is auto-selected (existing behavior)
- [ ] Typecheck and tests pass

### US-UP-003: Staging Mode — Collapsible Sections (GitKraken-style)
**Description:** As a user, I want to individually collapse the "Unstaged Changes" and "Staged Changes" sections in the staging panel, so that I can focus on one section at a time like in GitKraken.

**Acceptance Criteria:**
- [ ] The staging panel has two collapsible sections: "Unstaged Changes" (with file count badge) and "Staged Changes" (with file count badge)
- [ ] Each section has a clickable header with a chevron that toggles collapse
- [ ] The commit form (subject, body, commit button) is always visible below the staged changes section, not collapsible
- [ ] When a section is collapsed, only its header row is visible (one line with chevron + title + count)
- [ ] Collapse state persists across mode switches (switching to detail and back remembers which sections were collapsed)
- [ ] File actions (stage, unstage, discard) still work: clicking a file shows its diff in the center panel, right-click context menu works, drag-and-drop between sections works
- [ ] "Stage All" and "Unstage All" buttons are in each section's header row
- [ ] Typecheck and tests pass

### US-UP-004: Remove Stacked Panel Layout
**Description:** As a developer, I want to remove the old stacked DetailPanel + StatusPanel layout and the drag handle between them, so that the codebase is clean and there's only one right panel implementation.

**Acceptance Criteria:**
- [ ] AppLayout.tsx renders a single unified panel component in the right column instead of DetailPanel + StatusPanel with a drag handle
- [ ] The `detailStagingSplit` and `detailPanelCollapsed` layout state fields are removed or deprecated (no longer needed)
- [ ] The drag handle between detail and staging is removed
- [ ] Both the "right" and "bottom" panel position variants in AppLayout use the unified panel
- [ ] The `stagingCollapsed` layout state is repurposed or removed (replaced by per-section collapse in US-UP-003)
- [ ] No dead code left from the old stacked layout
- [ ] Existing keyboard shortcuts and toolbar actions that reference the staging area or detail panel still work
- [ ] Typecheck and tests pass

### US-UP-005: Working Tree File Diffs in Center Panel
**Description:** As a user, I want clicking a file in the staging area to open its diff in the center panel (replacing the commit graph temporarily), so that I get a full-width view of my changes — matching the behavior when clicking files in commit details.

**Acceptance Criteria:**
- [ ] Clicking a staged or unstaged file in the staging panel opens its diff in the center panel (this is existing behavior from the workingTreeFile feature — verify it still works after the refactor)
- [ ] Clicking "Back to Graph" returns to the commit graph with the WIP row still selected
- [ ] The diff view mode toggle (Diff / Full / File) works for working tree diffs
- [ ] Untracked files show the file content view (no diff to compare against)
- [ ] The center panel header shows the file path and "Working Tree" instead of a commit hash
- [ ] Typecheck and tests pass

## Functional Requirements

- FR-1: Add a virtual WIP row to CommitGraph that represents uncommitted working tree changes
- FR-2: The WIP row must appear at index 0 and shift all commit indices by 1
- FR-3: The WIP row must update its change summary when `repo:changed` events fire
- FR-4: The right panel must switch between staging and detail modes based on graph selection
- FR-5: Commit form state must be preserved in React state (not unmounted) when switching modes
- FR-6: The staging panel must have individually collapsible Unstaged and Staged sections
- FR-7: Remove the stacked DetailPanel + StatusPanel layout and inter-panel drag handle
- FR-8: Working tree file diffs route to the center panel via the existing `workingTreeFile` mechanism
- FR-9: Auto-select WIP row on repo load when there are uncommitted changes

## Non-Goals

- No inline diff viewer within the staging panel (diffs go to center panel)
- No split view option to show both staging and details simultaneously (one mode at a time)
- No drag-and-drop reordering of staged files
- No partial commit (committing only some staged files) — stage/unstage handles this
- No stash integration in the WIP row (stashes remain in the sidebar)

## Technical Considerations

- **CommitGraph virtualization:** The WIP row is prepended to the `nodes` array. All index-based operations (selectedIndex, scrollToRow, handleRowClick) must account for the +1 offset. The WIP "node" is a special object, not a real GitCommit.
- **State preservation:** Use conditional rendering with CSS `display: none` OR keep both StatusPanel and DetailPanel mounted but hidden, to preserve React state (especially commit form input values). Do NOT unmount StatusPanel when switching to detail mode.
- **Component reuse:** StatusPanel and DetailPanel already exist and work. The unified panel wraps them and toggles visibility. Avoid rewriting their internals.
- **Layout state cleanup:** Remove `detailStagingSplit`, `detailPanelCollapsed`, `stagingCollapsed` from useLayoutState. Add `wipSelected: boolean` or derive it from the selected index.
- **WIP data source:** The WIP row's file counts come from `getStatus` (already called by StatusPanel on mount and on `repo:changed`). Share this data rather than calling getStatus again.
- **react-window itemCount:** When WIP row is visible, `itemCount = commits.length + 1`. When hidden (clean tree), `itemCount = commits.length`. The row renderer must handle index 0 as the WIP row specially.

## Success Metrics

- Right panel shows full-height content in both modes (no cramped split)
- Switching between WIP and commits feels instant (< 50ms)
- Commit form state survives round-trip: type message, click commit, click WIP, message is still there
- Zero regression in staging functionality (stage, unstage, commit, discard, drag-and-drop)
- Zero regression in commit detail functionality (file list, diff click, branches containing)

## Open Questions

- Should the WIP row show a miniature progress bar or visual indicator of staged vs unstaged ratio?
- Should double-clicking the WIP row open the first changed file's diff automatically?
