# PRD: GitSlop UI/UX Overhaul

## Introduction

GitSlop's current UI has fundamental usability and aesthetic problems that make it feel unpolished and frustrating to use. UI elements become inaccessible, buttons appear when they have no context (e.g., Push with no repo open), the commit history is a flat list with no graphical representation, there is no integrated diff view from commits, emoji-based icons look tacky, the layout is poorly proportioned, and a full-screen blink refresh disrupts the experience. This overhaul will rebuild GitSlop's entire frontend into a professional, GitKraken-quality experience across three phases: Foundation, Core Views, and Polish.

**Art Direction:** Minimal line icons (Lucide icon library), clean typography, generous spacing, muted color palette with accent colors for branch lanes. No emojis anywhere in the UI.

**Layout Model:** GitKraken-style three-column layout — left sidebar (branches/remotes/tags/stashes) → center graph (commit history with SVG branch visualization) → right detail panel (commit details, diff viewer, file changes).

## Goals

- Eliminate all inaccessible UI states — every element must be reachable and usable at all window sizes
- Replace all emoji/unicode icons with Lucide line icons for a consistent, professional look
- Implement a true SVG node-and-edge commit graph with colored branch lines
- Add commit-level diff viewing (click a commit → see its changed files and diffs)
- Make all toolbar actions context-aware — hide or disable buttons that don't apply to the current state
- Fix the full-screen blink refresh by moving to incremental state updates
- Redesign the layout with proper proportions, consistent spacing, and a clear visual hierarchy
- Deliver in three phases: Foundation → Core Views → Polish

## User Stories

---

## Phase 1: Foundation (Layout + Design System)

---

### US-041: Install and Configure Lucide Icons
**Description:** As a developer, I need a proper icon library integrated so we can replace all emoji/unicode symbols with consistent, professional line icons.

**Acceptance Criteria:**
- [ ] `lucide-react` package installed as a dependency
- [ ] One example icon renders correctly in the app (e.g., replace the settings gear emoji with Lucide `Settings` icon)
- [ ] Icons accept `size` and `className` props for consistent sizing
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-042: Replace All Emoji and Unicode Icons with Lucide Icons
**Description:** As a user, I want a professional-looking interface without tacky emojis so the app feels like a serious tool.

**Acceptance Criteria:**
- [ ] Every emoji and HTML entity icon in the UI is replaced with an appropriate Lucide icon
- [ ] Specific replacements (at minimum):
  - `⬇` (pull) → `ArrowDownToLine`
  - `⬆` (push) → `ArrowUpFromLine`
  - `⟳` (fetch/refresh) → `RefreshCw`
  - `📦` (stash) → `Archive`
  - `⚙` (settings) → `Settings`
  - `🔔` (notifications) → `Bell`
  - `☀`/`🌙` (theme) → `Sun`/`Moon`
  - `⑂` (branch) → `GitBranch`
  - `⤞` (merge) → `GitMerge`
  - `📄` (file) → `File`
  - `✕` (close) → `X`
  - `▶`/`▼` (collapse/expand) → `ChevronRight`/`ChevronDown`
  - Window controls (minimize/maximize/close) → `Minus`/`Square`/`X`
  - `✓`/`✗` (success/error) → `Check`/`AlertCircle`
  - `ℹ` (info) → `Info`
  - `⚠` (warning) → `AlertTriangle`
- [ ] No raw emoji or unicode symbols remain in any `.tsx` or `.ts` file in `src/renderer/`
- [ ] Icons are consistently sized (16px for inline, 18px for toolbar, 14px for status bar)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-043: Design Token System and CSS Modules Migration
**Description:** As a developer, I need a structured design token system and per-component CSS modules so spacing, typography, and colors are consistent, and styles are scoped and maintainable.

**Acceptance Criteria:**
- [ ] Create `src/renderer/src/styles/tokens.css` with CSS custom properties organized into clear categories:
  - Spacing scale: `--space-xs` (4px), `--space-sm` (8px), `--space-md` (12px), `--space-lg` (16px), `--space-xl` (24px), `--space-2xl` (32px)
  - Font sizes: `--font-xs` (11px), `--font-sm` (12px), `--font-md` (13px), `--font-lg` (14px), `--font-xl` (16px)
  - Border radius: `--radius-sm` (4px), `--radius-md` (6px), `--radius-lg` (8px)
  - Shadows: `--shadow-sm`, `--shadow-md`, `--shadow-lg`
  - Transition: `--transition-fast` (100ms), `--transition-normal` (200ms)
  - All existing color variables (Catppuccin palette) moved here
- [ ] Both dark and light themes use the same token names (values differ per theme via `[data-theme]` selectors)
- [ ] Split `global.css` (56KB) into per-component CSS modules:
  - `tokens.css` — design tokens and theme definitions (imported globally)
  - `global.css` — only truly global styles (resets, body, scrollbars, font-face)
  - `Sidebar.module.css`, `CommitGraph.module.css`, `StatusPanel.module.css`, `DiffViewer.module.css`, `Toolbar.module.css`, `Titlebar.module.css`, `StatusBar.module.css`, etc.
- [ ] Each component imports its own `.module.css` and uses scoped class names
- [ ] Existing hardcoded pixel values migrated to use design tokens
- [ ] No styles remain in `global.css` that belong to a specific component
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-044: Three-Column Layout Redesign
**Description:** As a user, I want a GitKraken-style three-column layout so I can see branches, the commit graph, and details simultaneously without panels fighting for space.

**Acceptance Criteria:**
- [ ] Layout restructured into three resizable columns:
  - **Left sidebar** (200-350px): Branches, remotes, tags, stashes, file tree
  - **Center panel** (flexible, takes remaining space): Commit graph (top), staging area (bottom, collapsible)
  - **Right detail panel** (250-500px, collapsible): Commit details, file changes, diff viewer
- [ ] **Hybrid right panel:** On wide screens (≥1400px), the detail panel is a dedicated inline column. On narrow screens (<1400px), it becomes a sliding overlay/drawer from the right that overlaps content.
- [ ] Terminal panel remains at the bottom, spanning the full width below all three columns
- [ ] All panel dividers are draggable with clear visual grab handles
- [ ] Minimum sizes enforced so panels can't be resized to unusable dimensions
- [ ] Sidebar can be collapsed to just icons (icon rail mode, ~48px wide)
- [ ] Right panel collapses completely when no commit is selected
- [ ] Layout proportions persist across restarts
- [ ] Window can be resized down to 1024x600 without any UI elements becoming inaccessible
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-045: Context-Aware Toolbar
**Description:** As a user, I want toolbar buttons to only appear when they're relevant so I'm not confused by actions I can't perform.

**Acceptance Criteria:**
- [ ] When no repo is open: toolbar shows only "Open Repository", "Clone", and "Init" buttons
- [ ] When a repo is open: toolbar shows git operation buttons (pull, push, fetch, branch, merge, stash)
- [ ] Buttons that require a remote (push, pull, fetch) are hidden if the repo has no remotes configured
- [ ] Buttons show a disabled state with tooltip explaining why when preconditions aren't met (e.g., "Nothing to push" when local is up to date)
- [ ] Active operations show a subtle inline spinner next to the button text, not replacing the button
- [ ] Toolbar never wraps or overflows — excess buttons go into a `...` overflow menu
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-046: Fix Full-Screen Blink Refresh
**Description:** As a user, I don't want the entire screen to flash white/blank when the app refreshes state, because it's disorienting and looks broken.

**Acceptance Criteria:**
- [ ] Identify the cause of full-screen re-renders (likely: top-level state change triggering full component tree remount, or file watcher causing complete repo reload)
- [ ] State updates are granular — changing one piece of state (e.g., staging a file) does not re-render unrelated components (e.g., commit graph, sidebar)
- [ ] File watcher updates are diffed against current state — only changed data triggers re-renders
- [ ] No visible flash, flicker, or blank screen during any normal operation (stage, unstage, commit, checkout, fetch, pull, push)
- [ ] Loading states use skeleton placeholders or spinners within their specific panel, never a blank screen
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-047: Sidebar Accessibility Fix
**Description:** As a user, I want to always be able to access the sidebar content so I can switch branches, browse tags, and navigate the file tree.

**Acceptance Criteria:**
- [ ] Sidebar sections (Branches, Remotes, Tags, Stashes, Files) are always scrollable when content overflows
- [ ] Collapsible sections use Lucide chevron icons with smooth rotation animation
- [ ] Sidebar has its own scroll container independent of other panels
- [ ] Keyboard accessible: Tab to focus sections, Enter to expand/collapse, arrow keys to navigate items
- [ ] Sidebar collapse/expand toggle button is always visible (pinned to top of sidebar)
- [ ] When collapsed to icon rail, hovering an icon shows a tooltip with the section name; clicking expands that section as a floating overlay
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Phase 2: Core Views (Graph, Diff, Staging)

---

### US-048: SVG Commit Graph — Rendering Engine
**Description:** As a user, I want a true graphical commit history with colored branch lines and nodes so I can visually understand branching, merging, and history at a glance — like GitKraken.

**Acceptance Criteria:**
- [ ] Commit graph rendered using SVG (not ASCII art or text-based)
- [ ] Each commit is a colored circle node positioned on a branch lane
- [ ] Branch lanes are vertical colored lines — each branch gets a distinct color from a curated palette
- [ ] Merge commits show connecting lines from the merged branch to the target branch
- [ ] Lines curve smoothly (bezier curves) at branch/merge points, not sharp angles
- [ ] HEAD commit is visually distinct (larger node, highlighted ring, or glow effect)
- [ ] Branch and tag labels rendered as pill badges next to their commit node
- [ ] Graph renders correctly for: linear history, feature branches, merge commits, octopus merges, detached HEAD
- [ ] Virtualized rendering — only visible rows are in the DOM (continue using react-window or similar)
- [ ] SVG rendering used by default for repos up to 50,000 commits
- [ ] Automatic Canvas fallback for repos exceeding 50,000 commits (same visual appearance, better performance)
- [ ] Handles 100,000+ commits without performance degradation in Canvas mode (test with a large repo like linux kernel)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-049: SVG Commit Graph — Interaction
**Description:** As a user, I want to interact with the commit graph to select commits, view details, and perform actions.

**Acceptance Criteria:**
- [ ] Single-click a commit node or row to select it — selection highlighted with accent color
- [ ] Selected commit's details populate the right detail panel
- [ ] Right-click a commit for context menu: checkout, cherry-pick, revert, reset (soft/mixed/hard), create branch here, create tag here, copy SHA
- [ ] Right-click a branch label for context menu: checkout, merge into current, rebase onto, delete, rename, push
- [ ] Hover over a commit shows a tooltip with full commit message preview
- [ ] Keyboard navigation: Up/Down arrows move selection, Enter opens commit details
- [ ] Scroll position is preserved when data refreshes (no jumping to top)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-050: Commit Detail Panel
**Description:** As a user, when I click a commit in the graph, I want to see its full details and changed files in the right panel so I can understand what changed.

**Acceptance Criteria:**
- [ ] Right panel shows when a commit is selected, auto-hides when deselected
- [ ] Panel header: commit subject (bold), full SHA (copyable), author name + email, authored date (absolute + relative)
- [ ] If commit is signed: show verification badge (Lucide `ShieldCheck`/`ShieldAlert` icon with status)
- [ ] Full commit message body displayed below header
- [ ] "Changed Files" section lists all files modified in the commit with status icons:
  - `FilePlus` (added), `FileMinus` (deleted), `FileEdit` (modified), `FileSymlink` (renamed)
- [ ] File count summary: "3 files changed, +42 −15"
- [ ] Click a file in the list to show its diff inline below, or in a dedicated diff sub-panel
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-051: Integrated Diff Viewer for Commits
**Description:** As a user, I want to see diffs for files in a commit so I can review what changed without leaving the app.

**Acceptance Criteria:**
- [ ] When a file is selected from the commit detail panel, its diff is rendered
- [ ] Supports inline (unified) and side-by-side modes, toggled via buttons
- [ ] Diff uses the existing DiffViewer component (word-level highlighting, syntax highlighting)
- [ ] Diff header shows: file path, change type (added/modified/deleted/renamed), old path for renames
- [ ] Binary files show "Binary file changed" message instead of diff
- [ ] Large diffs (1000+ lines) are collapsed by default with "Expand" button
- [ ] Navigation between files: previous/next file buttons or keyboard shortcuts ([ and ])
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-052: Redesigned Staging Area
**Description:** As a user, I want a clear, well-organized staging area in the center panel so I can review, stage, and unstage files before committing.

**Acceptance Criteria:**
- [ ] Staging area lives in the bottom portion of the center panel (below the graph), collapsible
- [ ] Two-column file list: "Unstaged Changes" (left) and "Staged Changes" (right)
- [ ] Each file shows: status icon (Lucide), file name, directory path (muted)
- [ ] Stage a file: click `+` button or drag from unstaged → staged
- [ ] Unstage a file: click `−` button or drag from staged → unstaged
- [ ] "Stage All" and "Unstage All" buttons at the top of each column
- [ ] Clicking a file in either column shows its diff in the right detail panel
- [ ] Discard button (with confirmation) on unstaged files
- [ ] File counts shown in section headers: "Unstaged Changes (5)" / "Staged Changes (2)"
- [ ] Commit message input and commit button at the bottom of the staged column
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-053: Welcome Screen Redesign
**Description:** As a user, I want a polished welcome screen when no repo is open so I can quickly get started.

**Acceptance Criteria:**
- [ ] Full-width centered layout with GitSlop wordmark (not emoji logo)
- [ ] Three action cards with Lucide icons:
  - `FolderOpen` — "Open Repository" (launches folder picker)
  - `GitBranch` — "Clone Repository" (opens clone dialog with URL input and destination picker)
  - `FolderPlus` — "Initialize Repository" (launches folder picker, inits repo)
- [ ] "Recent Repositories" list below actions:
  - Each entry shows: repo name (bold), full path (muted), last opened date (relative, e.g., "2 days ago")
  - Hover shows "Remove from recent" `X` button
  - Click opens the repo
- [ ] If recent list is empty, show a subtle "No recent repositories" message
- [ ] Keyboard shortcut hints shown on action cards (e.g., "Ctrl+O")
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Phase 3: Polish (Animations, Edge Cases, Refinement)

---

### US-054: Panel Resize and Collapse Animations
**Description:** As a user, I want smooth transitions when panels resize or collapse so the UI feels responsive and polished, not jarring.

**Acceptance Criteria:**
- [ ] Collapsing/expanding sidebar animates width over 200ms ease-out
- [ ] Collapsing/expanding right detail panel animates width over 200ms ease-out
- [ ] Collapsing/expanding terminal panel animates height over 200ms ease-out
- [ ] Panel content fades in after expand completes (no layout flash during animation)
- [ ] Dragging a panel divider is smooth with no jitter or lag
- [ ] Double-clicking a divider resets that panel to its default size
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-055: Contextual Right-Click Menus
**Description:** As a user, I want right-click context menus throughout the app so I can quickly perform actions without hunting through toolbars.

**Acceptance Criteria:**
- [ ] Context menus use a consistent custom component (not browser default)
- [ ] Menus have Lucide icons next to each action
- [ ] Menu items show keyboard shortcut hints (right-aligned, muted text)
- [ ] Dangerous actions (delete branch, hard reset, discard changes) are red-colored with separator above
- [ ] Context menus work on:
  - Commit graph nodes (checkout, cherry-pick, revert, reset, branch, tag, copy SHA)
  - Branch labels in graph and sidebar (checkout, merge, rebase, delete, rename, push)
  - Files in staging area (stage, unstage, discard, open in editor, copy path)
  - Tags in sidebar (checkout, delete, push)
  - Stashes in sidebar (apply, pop, drop)
- [ ] Menu closes on click outside, Escape key, or scroll
- [ ] Menu positions itself to stay within viewport bounds
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-056: Loading States and Skeleton Screens
**Description:** As a user, I want to see appropriate loading indicators instead of blank screens or stale data so I know the app is working.

**Acceptance Criteria:**
- [ ] Initial repo load shows skeleton placeholders in each panel (not a blank screen)
- [ ] Sidebar sections show skeleton list items while branches/tags load
- [ ] Commit graph shows skeleton rows while history loads
- [ ] Diff viewer shows a centered spinner while computing diff
- [ ] Long operations (clone, fetch, push, pull) show progress in the status bar with percentage and operation name
- [ ] Skeleton styles match the actual content dimensions (no layout shift when data loads)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-057: Responsive Layout for Small Windows
**Description:** As a user, I want the layout to adapt gracefully when I resize the window small so nothing becomes inaccessible.

**Acceptance Criteria:**
- [ ] At window width < 1200px: right detail panel auto-collapses to a bottom sheet overlay instead of inline panel
- [ ] At window width < 900px: sidebar auto-collapses to icon rail mode
- [ ] At window width < 700px: toolbar buttons collapse to icon-only (no text labels) and overflow to `...` menu
- [ ] Minimum window size enforced at 800x500 — no content is clipped or inaccessible below this
- [ ] Panel min-width constraints prevent dragging panels to unusable sizes
- [ ] Text truncates with ellipsis rather than wrapping or overflowing
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-058: Notification System Redesign
**Description:** As a user, I want unobtrusive notifications that don't disrupt my workflow but still keep me informed.

**Acceptance Criteria:**
- [ ] Toast notifications appear in the bottom-right corner, stacking upward (max 3 visible)
- [ ] Each toast has: Lucide icon (color-coded by type), message text, dismiss `X` button
- [ ] Toasts auto-dismiss after 4s (info/success) or 8s (warning/error)
- [ ] Error toasts include a "Show Details" expandable section for stack traces or git stderr output
- [ ] Notification bell in status bar shows unread count badge
- [ ] Clicking the bell opens a notification history dropdown (last 50 items)
- [ ] Toast entrance/exit animated with slide-in from right / fade-out
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-059: Titlebar and Status Bar Redesign
**Description:** As a user, I want a clean titlebar and status bar that show useful information without clutter.

**Acceptance Criteria:**
- [ ] **Titlebar:**
  - GitSlop wordmark (left, text only — no emoji)
  - Current repo name + branch (center, clickable to copy)
  - Window controls (right, Lucide icons: `Minus`, `Square`/`Copy` for restore, `X`)
  - Draggable area for window movement
- [ ] **Status bar (bottom):**
  - Left: current branch name with Lucide `GitBranch` icon, ahead/behind counts
  - Center: last operation status ("Pushed to origin/main 2m ago")
  - Right: notification bell, encoding indicator, line ending indicator
- [ ] Status bar text is `--font-xs` size, muted until hovered
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

- FR-1: All emoji and unicode character icons must be replaced with Lucide React icons
- FR-2: Layout must use a three-column GitKraken-style arrangement (sidebar / graph / detail)
- FR-3: Commit graph must render as SVG with colored branch lanes, bezier curves, and node circles
- FR-4: Commit graph must be virtualized and handle 50,000+ commits
- FR-5: Toolbar buttons must be context-aware — hidden when no repo, disabled with tooltip when preconditions unmet
- FR-6: No full-screen flash or blank-screen refresh during any normal operation
- FR-7: All panels must remain accessible at window sizes down to 1024x600
- FR-8: Selecting a commit in the graph must show its details and changed files in the right panel
- FR-9: Clicking a changed file in the commit detail panel must show its diff
- FR-10: Staging area must support drag-and-drop between unstaged and staged columns
- FR-11: All context menus must use a custom component with icons, shortcut hints, and consistent styling
- FR-12: Loading states must use skeleton screens, not blank white/empty areas
- FR-13: Design tokens (spacing, font sizes, radii, shadows) must be used for all spacing/sizing
- FR-14: The welcome screen must show recent repos, and provide open/clone/init actions
- FR-15: Panel collapse/expand must animate smoothly (200ms ease-out)

## Non-Goals (Out of Scope)

- No custom icon design or brand illustration — Lucide icons only
- No change to the Electron main process git operations (IPC handlers stay the same)
- No new git features (e.g., interactive rebase UI, bisect) — this is purely UI/UX
- No migration away from React or the current tech stack
- No mobile or web version considerations
- No accessibility audit beyond keyboard navigation basics (WCAG compliance is a future effort)
- No i18n or localization
- No performance profiling of git operations themselves — only UI rendering performance

## Design Considerations

- **Icon library:** [Lucide React](https://lucide.dev/) — clean, consistent, MIT-licensed, 1500+ icons
- **Color palette:** Keep Catppuccin base but refine — ensure 4.5:1 contrast ratios for text
- **Branch colors:** Curated palette of 8-10 distinct, accessible colors that work on both dark and light themes, cycling for additional branches. Power users can override individual branch colors in settings.
- **Typography:** Keep system fonts + monospace (JetBrains Mono/Fira Code) but enforce consistent sizing via tokens
- **CSS approach:** Split `global.css` into per-component CSS modules (e.g., `Sidebar.module.css`, `CommitGraph.module.css`) with a shared `tokens.css` for design tokens. Each component owns its own styles.
- **Graph rendering:** SVG for branch lines/curves by default, with automatic Canvas fallback for repos exceeding 50k commits. HTML overlay for commit row content (text, badges) — this allows virtualization of rows while SVG/Canvas handles the visual connections.

## Technical Considerations

- **SVG/Canvas Graph:** SVG by default — only render lines for visible rows plus a small buffer using `react-window`'s render range. When commit count exceeds 50k, switch to a Canvas renderer with the same visual appearance. Both renderers must share the same layout algorithm for branch lane assignment.
- **State Granularity:** The blink refresh is likely caused by a top-level state change (e.g., `repoData` object replacement) cascading through the entire component tree. Split state into independent atoms: `branches`, `commits`, `status`, `selectedCommit`, etc.
- **Memoization:** Heavy components (CommitGraph, DiffViewer, Sidebar) must use `React.memo` with proper comparison functions to prevent unnecessary re-renders.
- **Lucide Tree-Shaking:** Import icons individually (`import { GitBranch } from 'lucide-react'`) not from a barrel export, to keep bundle size minimal.
- **CSS Modules:** Vite natively supports `.module.css` files — no extra configuration needed. Each component imports `styles from './Component.module.css'` and uses `styles.className`. Design tokens stay in a global `tokens.css` imported at the app root.
- **Branch Color Overrides:** Store user color overrides in `electron-store` settings, keyed by branch name. Merge with the default curated palette at render time.

## Success Metrics

- No UI element becomes inaccessible at any window size ≥ 1024x600
- Zero emoji or unicode symbol characters in the rendered UI
- Commit graph renders 10,000 commits with < 100ms initial paint and 60fps scrolling
- No full-screen blink/flash during any operation
- All toolbar buttons are contextually appropriate (no push button with no repo)
- Users can go from selecting a commit → viewing a file diff in ≤ 2 clicks

## Resolved Decisions

- **Right detail panel:** Hybrid — dedicated inline column on wide screens (≥1400px), sliding overlay/drawer on narrow screens (<1400px)
- **Branch colors:** Curated palette by default, with per-branch color overrides available in settings for power users
- **CSS architecture:** Split `global.css` into per-component CSS modules (`.module.css`) with a shared `tokens.css` for design tokens
- **Graph rendering:** SVG by default, automatic Canvas fallback for repos exceeding 50,000 commits

## Phase 4: Stability, Bug Fixes, and Multi-Repo Tabs

---

### US-060: Add Error Boundary to Prevent Blank-Screen Crashes
**Description:** As a user, I don't want the entire app to become a blank unresponsive window when something goes wrong — I want a graceful error screen with a way to recover.

**Acceptance Criteria:**
- [ ] Create an `ErrorBoundary` React component that wraps the main app content
- [ ] When a render error occurs, display a styled error screen with: error message, stack trace (collapsible), and "Reload App" button
- [ ] ErrorBoundary wraps `<AppLayout>` in App.tsx so the titlebar remains functional even during crashes
- [ ] Add `window.onerror` and `window.onunhandledrejection` handlers in main.tsx to catch non-React errors
- [ ] Errors are logged to the notification history so users can report them
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-061: Fix Sidebar Collapse/Expand — Ensure Sidebar Is Always Accessible
**Description:** As a user, I need to be able to open the sidebar at all times — the current implementation locks it shut and I cannot access branches, tags, or files.

**Acceptance Criteria:**
- [ ] Icon rail (collapsed sidebar) renders correctly with visible, clickable section icons
- [ ] Clicking any icon in the rail opens the corresponding section as a floating overlay
- [ ] The expand button (PanelLeftOpen icon) at the top of the icon rail restores the full sidebar
- [ ] Auto-collapse at <900px works but includes a visible "expand" affordance (icon or button) that the user can click
- [ ] If `sidebarCollapsed` is persisted as `true` from a previous session, the icon rail still renders with working expand controls
- [ ] Ctrl+B keyboard shortcut toggles sidebar visibility regardless of collapsed state
- [ ] Test: resize window below 900px → sidebar collapses → click expand → sidebar opens → resize window above 900px → sidebar stays open
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-062: Fix Commit Graph Scroll Rendering
**Description:** As a user, I want the commit graph nodes and branch lines to render correctly at all scroll positions, not disappear when I scroll.

**Acceptance Criteria:**
- [ ] Identify and fix the sync issue between `scrollOffset` (manual scroll tracking) and `visibleRange` (react-window's onRowsRendered)
- [ ] SVG graph nodes render at correct Y positions at all scroll positions
- [ ] Canvas fallback also renders correctly at all scroll positions
- [ ] Scrolling smoothly through 1000+ commits shows continuous graph lines with no gaps or missing nodes
- [ ] Buffer of rendered nodes above/below viewport is sufficient to prevent visual gaps during fast scrolling
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-063: Fix Diff Viewer — Show Errors and Ensure Content Displays
**Description:** As a user, when I click a file to view its diff, I want to see the actual diff content or a clear error message — not a blank panel.

**Acceptance Criteria:**
- [ ] When `showCommitFileDiff` IPC returns an error, display the error message in the diff area (not blank)
- [ ] When IPC throws an exception, display "Failed to load diff" with the error details
- [ ] When diff content is empty (no changes), show "No changes in this file" message
- [ ] Verify that file read IPC (`file.read`) works for the code editor — display error if it fails
- [ ] Add loading spinner while diff is being fetched
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-064: Fix File Watcher Infinite Loop
**Description:** As a developer, I need the file watcher to ignore changes caused by git operations to prevent infinite refresh loops that can crash the app.

**Acceptance Criteria:**
- [ ] File watcher in main process ignores changes inside `.git/` directory (refs, objects, logs, index, etc.)
- [ ] Only working tree file changes trigger `repo:changed` events
- [ ] Add a "suppression window" — when a git operation is in progress (push, pull, fetch, commit, checkout, merge, rebase), suppress watcher events for 1 second after operation completes
- [ ] Multiple rapid watcher events are debounced to a single `repo:changed` (existing 300ms debounce may need increase)
- [ ] Verify: performing a commit does not cause cascading refreshes across all components
- [ ] Typecheck passes

---

### US-065: Multi-Repo Tabs
**Description:** As a user, I want to have multiple repositories open simultaneously in tabs so I can switch between projects without closing and reopening.

**Acceptance Criteria:**
- [ ] Tab bar rendered below the titlebar, above the toolbar
- [ ] Each open repo is a tab showing: repo name, close (X) button
- [ ] Click a tab to switch to that repo's full view (sidebar, graph, staging, detail panel)
- [ ] Each tab maintains its own state: selected commit, scroll position, staged files, sidebar collapse state
- [ ] Opening a new repo (via welcome screen, toolbar, or file picker) adds a new tab instead of replacing the current view
- [ ] Closing the last tab returns to the welcome screen
- [ ] Active tab is visually distinct (highlighted, underlined, or background color)
- [ ] Tabs are reorderable via drag-and-drop
- [ ] Tab state persists across app restarts (which repos were open, which was active)
- [ ] Keyboard shortcut: Ctrl+Tab / Ctrl+Shift+Tab to cycle between tabs
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### US-066: Stability Test Suite
**Description:** As a developer, I need automated tests that verify the app doesn't crash during common operations so we catch regressions.

**Acceptance Criteria:**
- [ ] Unit tests for the lane assignment algorithm edge cases (already exists, verify comprehensive)
- [ ] Unit test for ErrorBoundary component: verify it catches render errors and displays fallback UI
- [ ] Unit test for file watcher debouncing: verify rapid events are coalesced
- [ ] Integration test: simulate opening a repo → verify sidebar, graph, and status panel all render without throwing
- [ ] Integration test: simulate commit selection → verify detail panel renders file list
- [ ] All tests pass with `npm test`
- [ ] Typecheck passes

---

## Open Questions

- Should multi-repo tabs share a single terminal, or should each tab have its own terminal instance with the cwd set to that repo?
- Should the tab bar be hideable/collapsible when only one repo is open?
