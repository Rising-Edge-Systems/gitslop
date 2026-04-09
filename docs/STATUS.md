# GitSlop Project Status — March 23, 2026

## Current State

**Active branch:** `ralph/ux-overhaul` (HEAD at `7d5cb93`)
**App status:** Builds, launches, and runs. Typecheck passes.
**Last activity:** Comprehensive dead code cleanup after fixing duplicate commit detail panels.

## What Has Been Done

### Phase 1: UI Overhaul (branch: `ralph/ui-overhaul`)
The original UI overhaul done by Ralph (26 user stories, US-041 through US-066):
- Replaced all emoji/unicode icons with Lucide icons across every component
- Created design token system (`tokens.css`) and migrated all components to CSS modules
- Built three-column layout with react-resizable-panels
- Implemented SVG commit graph with lane assignment algorithm + canvas fallback for large repos
- Built commit detail panel, integrated diff viewer, redesigned staging area
- Added sidebar icon rail collapse, context menus, keyboard shortcuts, skeleton loading states
- Responsive layout for small windows, notification system, panel animations

### Phase 2: Sidebar Fix (branch: `ralph/sidebar-fix`)
The sidebar was stuck at ~5px wide due to react-resizable-panels squeezing conditionally-rendered Panels:
- **Root cause:** `react-resizable-panels` compresses newly-mounted Panels to ~1% when they're conditionally rendered into a Group that already allocated 100% to other Panels
- **Fix:** Removed sidebar from react-resizable-panels entirely. It's now a plain CSS flex `<div>` with explicit pixel width (260px default, 180-400px range)
- Added custom drag handle for resize (mousedown/mousemove/mouseup on document)
- Migrated `sidebarSize` from percentage to pixels with corrupt state migration
- Removed redundant summary cards from repo header (~80px of vertical space saved)
- Made staging area collapsible with persisted state

### Phase 3: UX Overhaul (branch: `ralph/ux-overhaul`)
Addressed three major UX issues plus visual polish:
- **Always-visible tab bar** — tabs render even with 1 repo, "+" button to open more
- **Permanent right detail panel** — no more floating overlay. DetailPanel is a fixed 340px column that always shows (placeholder when no commit selected, details when one is)
- **Center-stage diff viewer** — clicking a file in detail panel opens the diff full-width in the center area, replacing the commit graph temporarily
- **Staging area moved to right panel** — below commit details, commit graph gets full center height
- **Same react-resizable-panels bug** hit the detail panel — fixed by moving it to plain CSS flex div (same pattern as sidebar)
- **React error #310** — hooks were after early return in DetailPanel, fixed by moving all hooks above the conditional
- **Duplicate commit details** — CommitGraph had its own inline CommitDetailPanel that duplicated the right panel. Removed 170 lines of dead code.
- Ralph completed 8 frontend design polish stories (typography, spacing, hover states, focus outlines, color token consistency)

### Phase 4: GUI Test Suite (branch: `ralph/gui-tests`)
Built a DIY computer use system for automated GUI testing:
- `scripts/screen-control.py` — X11 screenshot, click, type, key, drag, window management via python-xlib
- `scripts/gui-tests/` — 25 test cases covering welcome screen, toolbar, sidebar, commit graph, detail panel, diff viewer, staging, context menus, responsive layout, keyboard shortcuts, notifications, themes, tabs, git operations
- Tests run via `python3 scripts/gui-tests/run.py`, produce JSON report + screenshots
- `--open-repo` CLI arg added to Electron main process for test automation
- Test repo fixtures with deterministic git state (branches, tags, stashes, staged/unstaged files)

## Architecture (Current)

```
┌─ TitleBar (36px) ─────────────────────────────────────────┐
├─ TabBar (32px) — always visible, "+" to add repos ────────┤
├─ Toolbar (40px) — context-aware buttons ──────────────────┤
├───────────────────────────────────────────────────────────┤
│ Sidebar    │ Center Panel          │ Right Panel (340px)  │
│ (260px)    │                       │                      │
│ CSS flex   │ Commit Graph          │ Detail Panel (60%)   │
│ div with   │ (full height)         │  - commit info       │
│ drag       │                       │  - changed files     │
│ handle     │ OR                    │                      │
│            │                       │ Staging Area (40%)   │
│ Branches   │ Diff Viewer           │  - unstaged files    │
│ Files      │ (when file selected)  │  - staged files      │
│ Remotes    │                       │  - commit form       │
│ Tags       │                       │                      │
│ Stashes    │                       │                      │
├───────────────────────────────────────────────────────────┤
│ Terminal Panel (react-resizable-panels, toggleable)       │
├───────────────────────────────────────────────────────────┤
│ StatusBar (24px) — branch, fetch status, indicators       │
└───────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**
- Sidebar and detail panel are plain CSS flex divs — NOT react-resizable-panels (that library has a fatal bug with conditional rendering)
- react-resizable-panels is ONLY used for the vertical center+terminal split
- Layout state persisted to localStorage via `useLayoutState()` hook
- Per-tab state (selected commit, sidebar collapsed) via `useRepoTabs()` hook
- All hooks in DetailPanel must be above the early return (React error #310)

## What's Left To Do

### Known Issues (High Priority)
1. **Staging area designed for wide panel, crammed into 340px** — The StatusPanel was originally designed for a ~900px center panel. In the 340px right panel, the two-column layout (unstaged | staged) is cramped. Ralph attempted to adapt it (stacking vertically, compact buttons) but it needs more work.
2. **Commit graph click targeting** — Clicking commits to select them can be inconsistent. The virtualized react-window list handles its own click events and the hit area may not cover the full row.
3. **No way to open a second repo from the tab bar** — The "+" button should open a file picker or the welcome screen, but this flow may not be fully wired.

### Known Issues (Medium Priority)
4. **Titlebar/tab bar info duplication** — With one tab open, both the tab bar and titlebar show the repo name. Ralph's US-FD-007 addressed this (titlebar shows branch only when tabs visible) but should be verified.
5. **Light theme** — All work has been in dark theme. Light theme may have contrast or color issues that haven't been tested.
6. **Detail panel not resizable** — The detail panel is a fixed 340px. Users may want to drag it wider/narrower. Could add a drag handle similar to the sidebar.
7. **Sidebar drag handle visual** — The drag handle between sidebar and center is subtle. Ralph added a "⋮" dots indicator on hover but this should be verified.

### Potential Future Work
8. **Performance with large repos** — Canvas fallback for 50k+ commits exists but hasn't been tested with real large repos.
9. **File-level staging from diff view** — When viewing a diff in the center panel, users can't stage individual hunks from that view (hunk staging only works in the staging area's own diff viewer).
10. **Merge PR branches** — All work is on feature branches. `ralph/sidebar-fix` and `ralph/ux-overhaul` should be reviewed and merged into `main`.
11. **GUI test suite needs updating** — The tests were built before the right panel and layout changes. Click coordinates and expected UI states are outdated.

## Branch History

| Branch | Status | Description |
|--------|--------|-------------|
| `main` | Base | Original GitSlop before UI overhaul |
| `ralph/gitslop-v1` | Archived | Pre-overhaul snapshot |
| `ralph/ui-overhaul` | Complete | 26 stories: icons, CSS modules, SVG graph, layout |
| `ralph/gui-tests` | Complete | 25 GUI tests + DIY computer use framework |
| `ralph/sidebar-fix` | Complete | 7 stories: sidebar layout fix + polish |
| `ralph/ux-overhaul` | **Active** | Tabs, permanent detail panel, center diffs, staging in right panel, cleanup |

## Ralph Archives

Previous Ralph runs are archived in `scripts/ralph/archive/`:
- `2026-03-16-gitslop-v1/` — original gitslop v1 PRD
- `2026-03-17-ui-overhaul/` — UI overhaul (26 stories)
- `2026-03-18-gui-tests/` — GUI test suite (25 stories)
- `2026-03-18-sidebar-fix/` — sidebar fix (7 stories)

## How to Run

```bash
# Build and launch
npx electron-vite build
npx electron --no-sandbox . --open-repo /path/to/repo

# Dev mode (hot reload)
npm run dev  # note: package.json has -- --no-sandbox in dev script

# Typecheck
npm run typecheck

# GUI tests (requires X11 display :1, python-xlib, Pillow)
python3 scripts/gui-tests/run.py

# Screenshot tool
python3 scripts/screen-control.py screenshot-window gitslop /tmp/screenshot.png
```
