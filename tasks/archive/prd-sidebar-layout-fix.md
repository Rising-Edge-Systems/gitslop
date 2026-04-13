# PRD: Fix Sidebar Layout + UI Polish Pass

## Introduction

The GitSlop sidebar is completely broken — it renders at ~5px wide and cannot be resized, making branches, files, tags, and all sidebar content totally inaccessible. Beyond the sidebar, the overall layout has UX issues: 35% of screen height is wasted on headers/summary cards, the staging area and commit graph fight for vertical space, and the app doesn't feel polished enough for daily use.

This PRD covers two phases:
1. **Fix the sidebar** — rip it out of react-resizable-panels, use CSS flex with a drag handle
2. **UI polish pass** — tighten the layout, reduce wasted space, improve information density, and make it feel like a professional tool

## Root Cause Analysis (Sidebar)

1. The sidebar `<Panel>` is conditionally rendered inside a react-resizable-panels `<Group>`
2. When the Panel mounts, the Group has already allocated 100% to the center Panel
3. react-resizable-panels compresses the new Panel to ~1% width
4. The corrupt size persists to localStorage, making the bug permanent
5. There is no way to resize the sidebar once it's stuck at ~5px

## Goals

- Sidebar renders at 260px wide by default and is fully usable
- Sidebar can be resized by dragging (min 180px, max 400px)
- Sidebar collapses to 48px icon rail via Ctrl+B
- No crashes when toggling sidebar states
- Reduce header/chrome from ~276px to ~100px — more room for actual content
- Commit graph gets more vertical space
- Staging area is usable without scrolling through 100+ files
- The app feels cohesive, responsive, and professional

## User Stories

### US-SB-001: Remove Sidebar from react-resizable-panels
**Description:** As a developer, I need to remove the sidebar from react-resizable-panels so it renders at a usable width.

**Acceptance Criteria:**
- [ ] The sidebar is NOT wrapped in a `<Panel>` component — it's a plain `<div>` child of `.app-body`
- [ ] The sidebar `<div>` has `style={{ width: sidebarWidth, flexShrink: 0, height: '100%', overflow: 'hidden' }}`
- [ ] Default `sidebarWidth` is 260px
- [ ] The `handleSidebarResize` callback, `sidebarPanelRef`, `handleSidebarDividerDoubleClick` for the sidebar Panel are removed from AppLayout
- [ ] Both left and right sidebar positions work (div rendered before or after the Group in the flex container)
- [ ] When collapsed, the sidebar div renders at 48px with the icon rail (same `<Sidebar collapsed={true}>` component)
- [ ] The center content (react-resizable-panels Group) takes remaining space via `flex: 1; min-width: 0`
- [ ] Typecheck passes
- [ ] Verify visually: sidebar shows at 260px with branches/files content visible and scrollable

### US-SB-002: Custom Drag Handle for Sidebar Resize
**Description:** As a user, I want to drag the sidebar edge to resize it.

**Acceptance Criteria:**
- [ ] A 5px wide drag handle div between sidebar and center panel
- [ ] `cursor: col-resize` on hover, subtle highlight on hover (var(--border) background)
- [ ] Dragging resizes the sidebar in real time (mousedown on handle → mousemove on document → mouseup on document)
- [ ] Min 180px, max 400px enforced during drag
- [ ] Double-click resets to 260px default
- [ ] Drag works for left and right sidebar positions (direction reversed for right)
- [ ] No jitter — use `requestAnimationFrame` or direct state updates during drag
- [ ] Typecheck passes
- [ ] Verify visually: handle visible, drag works smoothly

### US-SB-003: Persist Sidebar Width + Migrate Corrupt State
**Description:** As a user, I want sidebar width to persist. Existing corrupt values must be fixed on load.

**Acceptance Criteria:**
- [ ] `sidebarSize` in `useLayoutState` stores pixel width (not percentage)
- [ ] On load, if `sidebarSize < 100` (was a percentage), replace with 260px default
- [ ] If `sidebarSize < 180` or `> 400`, clamp to valid range
- [ ] Width saved with 300ms debounce during drag
- [ ] Typecheck passes

### US-SB-004: Sidebar Toggle (Ctrl+B) Without Crashes
**Description:** As a user, I want Ctrl+B to toggle between expanded sidebar and icon rail reliably.

**Acceptance Criteria:**
- [ ] Ctrl+B cycles: expanded → icon rail → expanded (no hidden/invisible state)
- [ ] Collapse button in sidebar header triggers same toggle
- [ ] Expanded: full sidebar content visible at persisted width
- [ ] Icon rail: 48px with section icons, click opens overlay
- [ ] 200ms CSS transition on width for smooth animation
- [ ] No crash (`Invalid panel layout` error must not occur)
- [ ] Rapid toggling 20 times produces no glitch
- [ ] Collapse state persists across restarts
- [ ] Typecheck passes
- [ ] Verify visually: toggle works in both directions

### US-SB-005: Compact Repo Header — Remove Summary Cards
**Description:** As a user, I want the repo header to be compact so more screen space is available for the commit graph and staging area.

**Acceptance Criteria:**
- [ ] Remove the 4 large summary cards (Current Branch, Staged, Unstaged, Untracked) — they duplicate info shown in the sidebar, staging area headers, and status bar
- [ ] Replace with a single compact info bar (~32px tall) showing: branch name (already in status bar — just keep status bar), staged/unstaged/untracked counts as small badges inline
- [ ] OR simply remove the summary cards entirely — the staging area header already shows "Unstaged Changes (N)" and "Staged Changes (N)", and the branch is in the titlebar and status bar
- [ ] The repo name + path header ("gitslop / /home/benki/...") can stay but should be ~40px not ~60px
- [ ] Net vertical space saved: at least 80px (the summary cards height)
- [ ] The "Close" and refresh buttons remain accessible
- [ ] Typecheck passes
- [ ] Verify visually: compact header, more room for graph

### US-SB-006: Collapsible Staging Area with Better Density
**Description:** As a user, I want the staging area to be collapsible to a single line so I can maximize commit graph space when I'm not staging.

**Acceptance Criteria:**
- [ ] Staging area header ("Staging Area · N files") is always visible as a clickable bar
- [ ] Clicking the header toggles staging area open/closed
- [ ] When closed: only the ~30px header bar is visible, commit graph gets all remaining space
- [ ] When open: staging area expands to show file lists and commit form (current behavior)
- [ ] Collapse state persists in layout state
- [ ] The staging area chevron (already exists) rotates on collapse/expand
- [ ] Typecheck passes
- [ ] Verify visually: collapsed staging area gives commit graph much more vertical space

### US-SB-007: Visual Polish — Drag Handle, Transitions, Spacing
**Description:** As a developer, I want the sidebar and layout to feel polished with proper transitions and visual details.

**Acceptance Criteria:**
- [ ] Sidebar expand/collapse has smooth 200ms width transition
- [ ] Drag handle shows 3 subtle dots (vertical ellipsis) centered vertically on hover
- [ ] All panel borders use consistent `var(--border)` color
- [ ] No orphaned 1px gaps or misaligned borders between sidebar, center, and detail panels
- [ ] The "Filter History" bar (currently clipped at left edge) renders correctly within the center panel, not behind the sidebar
- [ ] Text that was previously peeking out at 2px on the left edge is completely gone
- [ ] Typecheck passes
- [ ] Verify visually: polished transitions, no visual artifacts

## Functional Requirements

- FR-1: Sidebar is a `<div>` with explicit pixel width, NOT a react-resizable-panels `<Panel>`
- FR-2: Sidebar width controlled via React state + inline style `{{ width: sidebarWidth }}`
- FR-3: Drag handle uses `mousedown`/`mousemove`/`mouseup` on `document` for smooth dragging
- FR-4: Sidebar div has `flexShrink: 0` so flex container doesn't compress it
- FR-5: Sidebar div has `overflow: hidden` and `height: 100%`
- FR-6: Center panel area has `flex: 1` and `min-width: 0`
- FR-7: Responsive auto-collapse (< 900px → icon rail) continues to work
- FR-8: Per-tab state restore for `sidebarCollapsed` continues to work
- FR-9: Summary cards removed, info consolidated into existing status bar / staging headers

## Non-Goals

- Not redesigning sidebar content (branches, files, tabs internal layout)
- Not changing the commit graph rendering (SVG nodes, lanes)
- Not changing the detail panel or terminal panel behavior
- Not changing the toolbar or titlebar

## Technical Considerations

- **AppLayout.tsx** — primary file: sidebar rendering, drag handle, state
- **useLayoutState.ts** — `sidebarSize` changes from percentage to pixels, migration logic
- **Sidebar.tsx** — no changes needed (receives `collapsed` prop)
- **RepoView.tsx** — remove summary cards, adjust header
- **StatusPanel.tsx** — staging area collapse already partially works (chevron exists)
- **global.css** — `.app-body` already `display: flex`
- Use `useRef` for drag state to avoid re-renders during drag
- Use `useCallback` for drag handlers

## Success Metrics

- Sidebar renders at 260px on first launch with full content visible
- Sidebar resizable between 180-400px via drag
- Ctrl+B toggles without crash, 20 rapid toggles is stable
- The `Invalid panel layout` crash never occurs
- ~80px of vertical space recovered from removing summary cards
- Staging area collapses to single header bar
- No visual artifacts, peeking text, or misaligned borders
