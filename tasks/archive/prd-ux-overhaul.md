# PRD: UX Overhaul — Tabs, Permanent Detail Panel, Center-Stage Diffs

## Introduction

GitSlop has three UX problems that make it feel incomplete:

1. **No visible tab bar** — multi-repo tab infrastructure exists in code (`useRepoTabs`, `TabBar.tsx`) but the tab bar only renders when 2+ repos are open, and there's no obvious way to open a second repo. Users think it's single-repo only.

2. **Floating detail panel feels disconnected** — clicking a commit opens a temporary overlay/drawer that slides in from the right. It feels like a popup, not part of the app. GitKraken uses a permanent right panel that's always part of the layout.

3. **Diffs are tiny and cramped** — the diff viewer renders inside the detail panel (which is either a narrow inline panel or a slide-in overlay). Diffs should be front and center — when you click a file, the diff should fill the main center area.

This PRD also includes a design polish pass to make the whole app feel cohesive and professional.

## Goals

- Tab bar always visible (even with 1 repo — shows as a single tab with + button to open more)
- Commit detail panel is a permanent part of the three-column layout, not a floating overlay
- Diff viewer opens in the center area (full width, replacing commit graph temporarily)
- App feels cohesive, polished, and pleasant — no visual rough edges

## User Stories

### US-UX-001: Always-Visible Tab Bar
**Description:** As a user, I want to see a tab bar even with one repo open so I know I can open multiple repos and switch between them.

**Acceptance Criteria:**
- [ ] Tab bar renders below the titlebar, always visible (even with 1 tab)
- [ ] Single tab shows: repo name with GitBranch icon, no close button (can't close the last tab — returns to welcome screen instead)
- [ ] A "+" button at the right end of the tab bar opens the welcome screen / repo picker to add another repo
- [ ] With 2+ tabs: each tab shows repo name, close (X) button, active tab is visually highlighted
- [ ] Middle-click closes a tab (already implemented in TabBar.tsx)
- [ ] Ctrl+Tab / Ctrl+Shift+Tab cycles tabs (already implemented)
- [ ] Tab bar height is ~32px, compact, doesn't waste vertical space
- [ ] Tabs are draggable to reorder (already implemented in TabBar.tsx)
- [ ] Typecheck passes
- [ ] Verify in browser: tab bar visible with single repo, + button works

### US-UX-002: Permanent Right Detail Panel (GitKraken-Style)
**Description:** As a user, I want the commit detail panel to be a permanent part of the layout so viewing commit details feels integrated, not like a popup.

**Acceptance Criteria:**
- [ ] Remove the overlay/drawer mode entirely — the detail panel is always an inline panel on the right
- [ ] When no commit is selected: the right panel shows a placeholder ("Select a commit to view details") with a muted icon
- [ ] When a commit is selected: the right panel shows commit info (hash, author, date, message, changed files list)
- [ ] The right panel is resizable via the existing react-resizable-panels Separator
- [ ] The right panel has a minimum width of ~280px and can be collapsed to 0 via a toggle button
- [ ] A toggle button in the panel header allows collapsing/expanding the right panel (similar to sidebar collapse)
- [ ] When collapsed: the center panel takes full width, a thin bar or button on the right edge allows re-expanding
- [ ] Panel collapse state persists in layout state
- [ ] The detail panel does NOT contain the diff viewer — clicking a file opens the diff in the center (next story)
- [ ] Typecheck passes
- [ ] Verify in browser: right panel is always part of the layout, shows placeholder when no commit selected

### US-UX-003: Center-Stage Diff Viewer
**Description:** As a user, when I click a file in the commit detail panel, I want the diff to open large and readable in the center area — not crammed into a side panel.

**Acceptance Criteria:**
- [ ] Clicking a file in the detail panel's "Changed Files" list opens the diff in the CENTER panel area
- [ ] The diff replaces the commit graph view temporarily (the graph is hidden, diff is shown full-width in the center)
- [ ] A breadcrumb or back button at the top of the diff view ("← Back to Commit Graph" or "← commit-hash / filename") allows returning to the graph
- [ ] The diff view shows: file path, change type (Added/Modified/Deleted/Renamed), inline or side-by-side toggle, line numbers, syntax highlighting
- [ ] The diff has plenty of vertical and horizontal space — it fills the entire center panel
- [ ] Pressing Escape or clicking the back button returns to the commit graph
- [ ] File navigation ([ and ] keys) still works to cycle between files in the commit
- [ ] The staging area below the diff/graph is unaffected — it stays at the bottom
- [ ] Typecheck passes
- [ ] Verify in browser: clicking a file opens full-width diff in center, back button returns to graph

### US-UX-004: Polish — Tab Bar Styling
**Description:** As a developer, I want the tab bar to look polished and cohesive with the rest of the app.

**Acceptance Criteria:**
- [ ] Tab bar has a subtle bottom border separating it from the content below
- [ ] Active tab has a colored bottom border indicator (var(--accent) color, 2px)
- [ ] Inactive tabs are muted, brighten on hover
- [ ] The "+" button is styled as a subtle icon button (Plus icon from Lucide, 16px)
- [ ] Tab close (X) buttons only appear on hover (not always visible — reduces visual noise)
- [ ] Tab bar background matches titlebar (var(--bg-secondary))
- [ ] Tabs truncate long repo names with ellipsis
- [ ] Tab bar scrolls horizontally if there are too many tabs (overflow-x: auto with hidden scrollbar)
- [ ] Typecheck passes
- [ ] Verify in browser: polished tab bar with hover effects, accent indicator on active tab

### US-UX-005: Polish — Detail Panel Empty State and Layout
**Description:** As a developer, I want the right detail panel to look good in all states.

**Acceptance Criteria:**
- [ ] Empty state (no commit selected): centered muted icon (GitCommit or similar) with "Select a commit to view details" text
- [ ] Panel header shows "Commit Details" title with a collapse toggle button (ChevronRight when collapsed, ChevronLeft when expanded)
- [ ] When collapsed: panel width is 0, a 24px wide vertical bar shows on the right edge with a ChevronLeft icon to expand
- [ ] File list items in the detail panel are clickable with hover highlight — clicking opens diff in center
- [ ] Currently selected file in the list is highlighted (if a diff is open in center)
- [ ] Scrollable when content overflows
- [ ] Panel border on the left side: 1px solid var(--border)
- [ ] Typecheck passes
- [ ] Verify in browser: empty state looks clean, collapse/expand works, file clicks open diffs

### US-UX-006: Polish — Center Panel Diff View
**Description:** As a developer, I want the center diff view to look professional and easy to read.

**Acceptance Criteria:**
- [ ] Diff header bar: file path (bold), change type badge (Added=green, Modified=blue, Deleted=red), inline/split toggle buttons, file counter (1/N), prev/next file buttons
- [ ] Diff content fills the entire center area with proper padding
- [ ] Line numbers column has a subtle background (var(--bg-secondary))
- [ ] Added lines have green-tinted background, deleted lines have red-tinted background
- [ ] Word-level diff highlighting within changed lines
- [ ] Large diffs (1000+ lines) show a "Large diff — click to expand" placeholder
- [ ] Binary files show "Binary file changed" with a Package icon
- [ ] The back button/breadcrumb is styled as a subtle link at the top, not a heavy button
- [ ] Typecheck passes
- [ ] Verify in browser: diff is large, readable, professional-looking

### US-UX-007: Polish — Global Spacing, Typography, Micro-Interactions
**Description:** As a developer, I want the overall app to feel cohesive with consistent spacing, typography, and subtle interactions.

**Acceptance Criteria:**
- [ ] All section headers (Commit Graph, Staging Area, Branches, etc.) use consistent typography: var(--font-sm), font-weight 600, uppercase, letter-spacing 0.5px, var(--text-muted) color
- [ ] All interactive elements have visible focus states (outline or ring) for keyboard navigation
- [ ] Hover states on clickable items use consistent var(--bg-hover) or var(--border) background transition
- [ ] All borders use var(--border) consistently — no hardcoded colors
- [ ] Commit graph row hover shows a subtle background highlight
- [ ] Selected commit row shows accent-colored left border (3px var(--accent))
- [ ] Staging area file items have consistent 8px padding and hover highlight
- [ ] Status bar text brightens on hover (already implemented — verify it's consistent)
- [ ] No orphaned borders, double borders, or 1px alignment gaps between panels
- [ ] Typecheck passes
- [ ] Verify in browser: consistent look across all panels, no visual rough edges

## Functional Requirements

- FR-1: Tab bar always visible, even with 1 repo. "+" button opens repo picker.
- FR-2: Detail panel is a permanent inline panel (react-resizable-panels), not an overlay.
- FR-3: Detail panel shows placeholder when no commit selected.
- FR-4: Clicking a file in detail panel opens diff in center area, replacing the commit graph.
- FR-5: Back button/Escape returns from diff to commit graph.
- FR-6: File navigation ([ ] keys) cycles through files within the center diff view.
- FR-7: Detail panel can be collapsed to 0 with a toggle, persistent.
- FR-8: All visual changes use design tokens (CSS custom properties), not hardcoded values.

## Non-Goals

- Not implementing split diff pane (side-by-side view already exists in DiffViewer)
- Not changing the sidebar layout (just fixed in previous PRD)
- Not changing the terminal panel
- Not implementing file editing / live staging from the diff view
- Not implementing drag-and-drop between staging columns (existing click-to-stage is sufficient)

## Design Considerations

- **GitKraken reference**: Three-column layout with permanent panels. Left = branches, Center = graph + diffs, Right = commit details.
- **VS Code reference**: Tab bar with + button, active tab indicator, hover-to-reveal close buttons.
- **Diff viewers reference**: GitHub's diff view — full width, green/red backgrounds, file breadcrumb at top.
- **Existing components to reuse**: DiffViewer.tsx (already feature-complete), DetailPanel.tsx (needs restructuring), TabBar.tsx (needs always-visible + styling).

## Technical Considerations

- **TabBar.tsx** — modify to always render, add "+" button, style updates
- **App.tsx** — remove the `tabs.length > 1` condition for rendering TabBar
- **AppLayout.tsx** — detail panel always rendered inline (remove overlay branch), add collapse toggle
- **DetailPanel.tsx** — remove `overlay` prop/mode, add empty state, remove inline DiffViewer
- **RepoView.tsx / MainContent.tsx** — add a "diff view" mode that replaces the commit graph when a file is selected
- **DiffViewer.tsx** — no changes to the component itself, just where it's rendered (center instead of detail panel)
- **useLayoutState.ts** — add `detailPanelCollapsed: boolean` to persisted state
- **State flow**: file selection in DetailPanel → state lifted to AppLayout/RepoView → center panel shows diff

## Success Metrics

- Tab bar visible on first launch with 1 repo
- Clicking a commit shows details in permanent right panel (no overlay/drawer)
- Clicking a file shows full-width diff in center area (readable, not cramped)
- Toggling detail panel collapse 20 times is stable
- No visual artifacts, double borders, or inconsistent spacing
- App feels like a cohesive professional tool, not a collection of parts

## Open Questions

- Should the detail panel collapse direction be to the right (shrink to 0) or to a thin icon strip (like sidebar rail)?
- Should the center diff view also work for staging diffs (click a file in staging area → view diff in center)?
