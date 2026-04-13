# PRD: Comprehensive GUI Test Suite via DIY Computer Use

## Introduction

Build an automated GUI test suite for GitSlop that uses the DIY computer use system (`scripts/screen-control.py`) to visually and functionally verify every feature from the UI overhaul (US-041 through US-066). Tests interact with the real Electron app via X11 — taking screenshots, clicking, typing, pressing keys — then Claude evaluates each screenshot against acceptance criteria to produce a pass/fail verdict. The suite serves as both acceptance testing (validate features now) and regression testing (catch breakage after future changes).

## Goals

- Verify all 26 user stories (US-041 through US-066) are visually and functionally correct
- Produce a JSON report with pass/fail per test, screenshots, and AI evaluation notes
- Run as a single command: `python3 scripts/gui-tests/run.py`
- Also callable via `npm run gui-test` and as a Ralph skill step
- Test both dark and light themes
- Test responsive layout at multiple window sizes (1280x800, 1024x768, 800x500)
- Test actual git operations (stage, commit, push) not just UI chrome
- Save baseline screenshots for future regression diffing

## User Stories

### US-GT-001: Test Framework and Runner
**Description:** As a developer, I need a test framework that launches GitSlop, runs test cases, captures screenshots, and produces a structured report.

**Acceptance Criteria:**
- [ ] Create `scripts/gui-tests/run.py` — main test runner entry point
- [ ] Create `scripts/gui-tests/framework.py` — base classes: `GUITest`, `TestSuite`, `TestResult`
- [ ] `GUITest` base class provides: `screenshot(name)`, `click(x, y)`, `click_element(description)`, `type_text(text)`, `press_key(combo)`, `wait(seconds)`, `assert_screenshot(name, criteria_description)`
- [ ] Runner launches GitSlop (`npx electron --no-sandbox .`), waits for window to appear, runs all tests, kills app on completion
- [ ] Each test produces: `TestResult` with name, status (pass/fail/error), screenshot paths, evaluation notes, duration
- [ ] Final JSON report saved to `scripts/gui-tests/results/report.json`
- [ ] All screenshots saved to `scripts/gui-tests/results/screenshots/`
- [ ] Console output shows progress: `[PASS] test_name` or `[FAIL] test_name: reason`
- [ ] Exit code 0 if all pass, 1 if any fail
- [ ] Typecheck not applicable (Python)

### US-GT-002: AI Screenshot Evaluator
**Description:** As a developer, I need the test framework to evaluate screenshots against written criteria so tests can auto-judge pass/fail without human review.

**Acceptance Criteria:**
- [ ] Create `scripts/gui-tests/evaluator.py` — takes a screenshot path and criteria string, returns pass/fail with reasoning
- [ ] Evaluator uses a local checklist-based approach: parse the criteria into checkpoints, verify each visually
- [ ] For now, evaluator saves screenshots + criteria to the report for manual/AI review (Claude in the loop)
- [ ] When run within a Claude Code session, the runner can call the Read tool on screenshots for live AI evaluation
- [ ] Criteria format: plain English description of what should be visible (e.g., "Toolbar shows Pull, Push, Fetch buttons with Lucide icons, no emoji visible")
- [ ] Each evaluated screenshot gets a `verdict` field: `"pass"`, `"fail"`, or `"needs_review"`

### US-GT-003: Window Management Helpers
**Description:** As a test author, I need reliable helpers to find, focus, resize, and position the GitSlop window.

**Acceptance Criteria:**
- [ ] `find_gitslop_window()` — finds the Electron window by WM_CLASS `gitslop`
- [ ] `focus_gitslop()` — raises and focuses the window
- [ ] `resize_window(width, height)` — resizes to exact pixel dimensions for responsive testing
- [ ] `get_window_bounds()` — returns `(x, y, width, height)` of the window in screen coordinates
- [ ] `click_in_window(rel_x, rel_y)` — clicks at coordinates relative to the window top-left (abstracts away absolute screen position)
- [ ] `screenshot_window(output_path)` — captures just the GitSlop window, no desktop chrome
- [ ] All helpers handle window-not-found gracefully with clear error messages
- [ ] Helpers work regardless of where the window is positioned on screen

### US-GT-004: Test Repo Setup and Teardown
**Description:** As a test author, I need a temporary git repo with known state so tests have predictable data to verify against.

**Acceptance Criteria:**
- [ ] Create `scripts/gui-tests/fixtures.py` — test repo creation utilities
- [ ] `create_test_repo()` — creates a temp git repo with: 5+ commits on main, a feature branch with 3 commits, a merge commit, 2 tags, 1 stash, staged + unstaged + untracked files
- [ ] Commit messages, authors, and file contents are deterministic (same every run)
- [ ] `cleanup_test_repo(path)` — removes the temp repo
- [ ] `open_repo_in_gitslop(repo_path)` — uses screen-control to open the repo (click Open Repository, navigate to path, confirm)
- [ ] Alternatively: launch GitSlop with the repo path as a command-line argument if supported
- [ ] Also supports using the gitslop project repo itself for real-world testing

### US-GT-005: Test — Welcome Screen
**Description:** As a tester, I want to verify the welcome screen renders correctly with all expected elements.

**Acceptance Criteria:**
- [ ] Screenshot on launch shows: "GS" wordmark, "GitSlop" title, "A powerful, open-source Git client" subtitle
- [ ] Three action cards visible: "Open Repository" with FolderOpen icon, "Clone Repository" with GitBranch icon, "Init Repository" with FolderPlus icon
- [ ] Keyboard shortcut hints visible on cards: Ctrl+O, Ctrl+Shift+C, Ctrl+Shift+I
- [ ] Recent Repositories section visible (shows repos or "No recent repositories" message)
- [ ] Toolbar shows only Open, Clone, Init buttons (no git operation buttons)
- [ ] Status bar shows "No repository open"
- [ ] No emoji visible anywhere — all icons are Lucide line icons
- [ ] Test in both dark and light theme (toggle via titlebar theme button)

### US-GT-006: Test — Toolbar Context-Aware Buttons
**Description:** As a tester, I want to verify the toolbar adapts correctly when a repo is opened.

**Acceptance Criteria:**
- [ ] With no repo: toolbar shows Open, Clone, Init, Settings — no Pull/Push/Fetch/Branch/Merge/Stash
- [ ] After opening a repo: toolbar shows Pull, Push, Fetch, Branch, Merge, Stash with Lucide icons
- [ ] Settings gear icon always visible (far right)
- [ ] All icons are Lucide (no emoji/unicode)
- [ ] Hover over disabled button shows tooltip with reason
- [ ] Active operation shows inline spinner next to button text (test by clicking Fetch)

### US-GT-007: Test — Titlebar
**Description:** As a tester, I want to verify the titlebar layout and interactions.

**Acceptance Criteria:**
- [ ] Titlebar shows: "GitSlop" wordmark (left), repo name + branch (center), window controls (right)
- [ ] Window controls: theme toggle (Sun/Moon), minimize (Minus), maximize (Square), close (X)
- [ ] With repo open: center shows "reponame · branchname" with GitBranch icon
- [ ] Click center repo info — verify click-to-copy feedback ("Copied!" badge appears)
- [ ] Theme toggle switches between dark and light theme
- [ ] Minimize, maximize buttons work (verify window state change)

### US-GT-008: Test — Status Bar
**Description:** As a tester, I want to verify the status bar shows correct information.

**Acceptance Criteria:**
- [ ] With repo open: left shows branch name with GitBranch icon and ahead/behind counts
- [ ] Center shows last operation status (e.g., timestamp of last action)
- [ ] Right shows: encoding indicator (UTF-8), line ending indicator (LF), refresh button, notification bell
- [ ] Text is muted by default, becomes visible on hover
- [ ] Notification bell shows unread count badge when notifications exist
- [ ] Click notification bell — history dropdown opens with past notifications

### US-GT-009: Test — Sidebar Expanded
**Description:** As a tester, I want to verify the full sidebar renders correctly with all sections.

**Acceptance Criteria:**
- [ ] Sidebar visible on left with tabs: Branches and Files
- [ ] Branches tab shows: local branches with GitBranch icons, current branch highlighted
- [ ] Collapse/expand chevrons on section headers rotate smoothly
- [ ] Sidebar is independently scrollable (content doesn't clip)
- [ ] Collapse toggle button (PanelLeftClose) visible at top
- [ ] All icons are Lucide — no emoji
- [ ] Branch items are keyboard accessible (Tab to focus, Enter to checkout)

### US-GT-010: Test — Sidebar Collapse to Icon Rail
**Description:** As a tester, I want to verify the sidebar collapses to an icon rail and back.

**Acceptance Criteria:**
- [ ] Click collapse button — sidebar collapses to 48px icon rail
- [ ] Icon rail shows section icons vertically (Branches, Files, Remotes, Tags, Stashes, Submodules)
- [ ] Click an icon in rail — floating overlay panel opens with that section's content
- [ ] Click outside overlay — it closes
- [ ] Click expand button (PanelLeftOpen) — sidebar restores to full width
- [ ] Collapse state persists: close and reopen app — same collapse state

### US-GT-011: Test — Three-Column Layout
**Description:** As a tester, I want to verify the three-column layout structure works correctly.

**Acceptance Criteria:**
- [ ] With repo open and no commit selected: two columns visible (sidebar + center)
- [ ] Click a commit in the graph — right detail panel appears as third column (on wide window)
- [ ] All panel dividers are draggable (drag to resize, verify panels change size)
- [ ] Double-click a divider — panel resets to default size
- [ ] Terminal panel spans full width below all columns (toggle with Ctrl+`)
- [ ] Minimum sizes enforced: sidebar doesn't shrink below ~12%, center below ~30%

### US-GT-012: Test — Hybrid Detail Panel
**Description:** As a tester, I want to verify the detail panel switches between inline and overlay modes.

**Acceptance Criteria:**
- [ ] At 1280x800: click a commit — detail panel renders as inline column (third column)
- [ ] Resize window to 1200px wide: detail panel switches to overlay mode (slides from right with backdrop shadow)
- [ ] Overlay dismissible: click close button (X), click backdrop, or press Escape
- [ ] Resize back to 1400px+: detail panel returns to inline column mode

### US-GT-013: Test — SVG Commit Graph Rendering
**Description:** As a tester, I want to verify the commit graph renders correctly with SVG nodes and branch lines.

**Acceptance Criteria:**
- [ ] Commit graph shows colored circle nodes for each commit
- [ ] Branch lanes are vertical colored lines connecting commits
- [ ] HEAD commit visually distinct (larger node with glow ring)
- [ ] Merge commits show connecting bezier curve lines between lanes
- [ ] Branch and tag labels rendered as pill badges next to commit nodes
- [ ] Each commit row shows: short hash, message, author, relative date
- [ ] Scrolling through commits shows continuous graph lines with no gaps
- [ ] "ralph/ui-overhaul" branch label visible on HEAD commit

### US-GT-014: Test — Commit Graph Interaction
**Description:** As a tester, I want to verify commit graph click, keyboard, and context menu interactions.

**Acceptance Criteria:**
- [ ] Single-click a commit row — it highlights with accent color
- [ ] Selected commit opens the detail panel on the right
- [ ] Right-click a commit — context menu appears with: checkout, cherry-pick, revert, reset, create branch, create tag, copy SHA
- [ ] Right-click a branch label — context menu with: checkout, merge, rebase, delete, rename, push
- [ ] Hover over a commit — tooltip shows full commit message preview (after ~600ms)
- [ ] Keyboard: Up/Down arrows move selection, Enter opens commit details
- [ ] Context menus close on: click outside, Escape, scroll

### US-GT-015: Test — Commit Detail Panel
**Description:** As a tester, I want to verify the commit detail panel shows full commit information.

**Acceptance Criteria:**
- [ ] Click a commit — detail panel shows: subject (bold), full SHA (copyable), author name + email, date (absolute + relative)
- [ ] Full commit message body displayed below header
- [ ] Changed Files section lists files with Lucide status icons: FilePlus (added), FileMinus (deleted), FileEdit (modified)
- [ ] File count summary shows: "N files changed, +insertions -deletions"
- [ ] Click SHA — copies to clipboard (verify copy feedback)
- [ ] Close button (X) dismisses the panel

### US-GT-016: Test — Integrated Diff Viewer
**Description:** As a tester, I want to verify diffs render correctly in the detail panel.

**Acceptance Criteria:**
- [ ] Click a file in the commit detail panel — diff renders below the file list
- [ ] Inline (unified) mode shows additions in green, deletions in red
- [ ] Toggle to side-by-side mode — verify split view renders
- [ ] Diff header shows: file path, change type (Added/Modified/Deleted/Renamed)
- [ ] Large diffs (1000+ lines) collapsed by default with "Expand" button
- [ ] Previous/next file navigation buttons work (or [ / ] keyboard shortcuts)
- [ ] Empty diff shows "No changes in this file" message
- [ ] Error loading diff shows error message (not blank panel)

### US-GT-017: Test — Staging Area
**Description:** As a tester, I want to verify the redesigned staging area works correctly.

**Acceptance Criteria:**
- [ ] Staging area visible below commit graph with collapsible header showing file count badge
- [ ] Two-column layout: "Unstaged Changes" (left) and "Staged Changes" (right)
- [ ] Each file shows: Lucide status icon, file name, directory path (muted)
- [ ] Click + button on an unstaged file — it moves to staged column
- [ ] Click - button on a staged file — it moves back to unstaged column
- [ ] "Stage All" and "Unstage All" buttons work
- [ ] Clicking a file shows its diff in the detail panel
- [ ] Discard button (Trash2) on unstaged files shows confirmation dialog
- [ ] Commit form visible at bottom of staged column: subject input, commit button
- [ ] Type a commit message and click Commit — verify commit succeeds (new commit appears in graph)

### US-GT-018: Test — Context Menus
**Description:** As a tester, I want to verify the custom context menu component works everywhere.

**Acceptance Criteria:**
- [ ] Right-click a commit node — styled context menu appears at mouse position
- [ ] Menu items show: Lucide icon (left), label (center), keyboard shortcut hint (right)
- [ ] Dangerous actions (e.g., delete) styled with red text
- [ ] Menu stays within viewport bounds (doesn't clip off-screen)
- [ ] Menu closes on: click outside, Escape, scroll
- [ ] Right-click a branch in sidebar — branch context menu appears
- [ ] Right-click a file in staging area — file context menu appears
- [ ] Right-click a tag in sidebar — tag context menu appears

### US-GT-019: Test — Loading States and Skeletons
**Description:** As a tester, I want to verify skeleton screens appear during loading instead of blank screens.

**Acceptance Criteria:**
- [ ] Open a repo — skeleton placeholders visible briefly before content loads (screenshot during transition if possible)
- [ ] Sidebar shows skeleton list items while loading
- [ ] Commit graph shows skeleton rows while loading
- [ ] Diff viewer shows spinner while computing diff
- [ ] No blank/white flash during any normal operation (stage, unstage, commit)

### US-GT-020: Test — Responsive Layout (Small Windows)
**Description:** As a tester, I want to verify the layout adapts correctly at different window sizes.

**Acceptance Criteria:**
- [ ] At 1280x800 (default): full three-column layout, all toolbar labels visible
- [ ] Resize to 1024x768: detail panel in overlay mode, sidebar still expanded
- [ ] Resize to 900x600: sidebar auto-collapses to icon rail
- [ ] Resize to 800x500 (minimum): toolbar buttons icon-only, no text labels; status bar hides center section; titlebar hides repo path
- [ ] Text truncates with ellipsis — no wrapping or overflow
- [ ] Resize back to 1280x800: sidebar auto-restores, all labels return
- [ ] Cannot resize below 800x500 (minimum enforced by Electron)

### US-GT-021: Test — Notification System
**Description:** As a tester, I want to verify toast notifications and the notification history work correctly.

**Acceptance Criteria:**
- [ ] Trigger a notification (e.g., successful fetch) — toast appears in bottom-right corner
- [ ] Toast has: Lucide icon (color-coded), message text, dismiss X button
- [ ] Toast slides in from right, auto-dismisses after ~4s
- [ ] Max 3 toasts visible at once (stack upward)
- [ ] Click notification bell in status bar — history dropdown opens
- [ ] History shows past notifications with timestamps
- [ ] Error toasts persist longer (~8s) and include expandable details

### US-GT-022: Test — Keyboard Shortcuts
**Description:** As a tester, I want to verify all keyboard shortcuts trigger the correct actions.

**Acceptance Criteria:**
- [ ] Ctrl+B: toggles sidebar (expanded → collapsed → expanded)
- [ ] Ctrl+`: toggles terminal panel
- [ ] Ctrl+K: opens search/command palette
- [ ] Ctrl+?: opens keyboard shortcuts panel
- [ ] Ctrl+Shift+P: triggers push (verify push dialog or operation starts)
- [ ] Ctrl+Shift+L: triggers pull
- [ ] Ctrl+Shift+F: triggers fetch
- [ ] Ctrl+Shift+S: opens stash dialog
- [ ] Escape: closes open overlays/dialogs
- [ ] Ctrl+Tab / Ctrl+Shift+Tab: cycles between repo tabs (if multiple open)

### US-GT-023: Test — Panel Animations
**Description:** As a tester, I want to verify smooth panel transitions (this is a visual polish test).

**Acceptance Criteria:**
- [ ] Collapse sidebar — smooth 200ms animation (take rapid screenshots to verify intermediate state exists)
- [ ] Expand sidebar — smooth animation
- [ ] Open detail panel — smooth fade-in
- [ ] Open terminal — smooth animation
- [ ] No layout flash or jitter during any panel transition

### US-GT-024: Test — Error Boundary
**Description:** As a tester, I want to verify the error boundary catches crashes gracefully.

**Acceptance Criteria:**
- [ ] Error boundary exists (verified by code inspection — no GUI trigger needed)
- [ ] If triggered: error screen shows error message, collapsible stack trace, and "Reload App" button
- [ ] Titlebar remains functional during error state (can close/minimize window)

### US-GT-025: Test — Multi-Repo Tabs
**Description:** As a tester, I want to verify the tab bar works for multiple repositories.

**Acceptance Criteria:**
- [ ] Open one repo — no tab bar visible (single tab hidden)
- [ ] Open a second repo (use Init to create a temp repo) — tab bar appears with two tabs
- [ ] Active tab visually distinct (highlighted/underlined)
- [ ] Click a tab — switches to that repo's view
- [ ] Close a tab (X button) — tab removed, other tab becomes active
- [ ] Close last tab — returns to welcome screen
- [ ] Tabs show repo name with GitBranch icon
- [ ] Middle-click a tab — closes it
- [ ] Tabs are reorderable via drag-and-drop

### US-GT-026: Test — Both Themes
**Description:** As a tester, I want to verify both dark and light themes render correctly.

**Acceptance Criteria:**
- [ ] Default theme is dark: dark background, light text, blue accent colors
- [ ] Click theme toggle (Sun/Moon in titlebar) — switches to light theme
- [ ] Light theme: light background, dark text, appropriate contrast
- [ ] All components render correctly in light theme: toolbar, sidebar, commit graph, detail panel, staging area, status bar
- [ ] Toggle back to dark — correct dark theme restored
- [ ] No elements with hardcoded colors that break in either theme

### US-GT-027: Test — Git Operations End-to-End
**Description:** As a tester, I want to verify that actual git operations work through the UI, not just that buttons render.

**Acceptance Criteria:**
- [ ] Create a test repo with known state, open it in GitSlop
- [ ] Modify a file via terminal/script, verify it appears in Unstaged Changes
- [ ] Stage the file (click + button), verify it moves to Staged Changes
- [ ] Type commit message, click Commit, verify: new commit appears in graph, staging area clears
- [ ] Create a new branch via Branch button or context menu, verify it appears in sidebar
- [ ] Stash changes (via Stash button), verify stash appears in sidebar Stashes section
- [ ] Apply stash, verify changes return to working tree
- [ ] Discard a file change, verify file removed from unstaged

## Functional Requirements

- FR-1: The test runner must launch GitSlop as a subprocess, wait for the window to appear (poll via X11), and kill it on completion or timeout
- FR-2: All mouse interactions must use window-relative coordinates (not absolute screen coordinates) so tests work regardless of window position
- FR-3: Screenshots must capture only the GitSlop window (not the full desktop)
- FR-4: Each test must be independent — if one test fails, subsequent tests still run
- FR-5: The runner must support `--filter <pattern>` to run specific tests by name
- FR-6: The runner must support `--theme dark|light|both` to control theme testing
- FR-7: The runner must support `--size <WxH>` to set window size for responsive tests
- FR-8: Window resize must use X11 `ConfigureWindow` requests (not xdotool)
- FR-9: Test timing must account for animation durations (200-300ms) and rendering delays
- FR-10: The JSON report must include: test name, status, duration, screenshot paths, criteria, evaluation notes
- FR-11: Baseline screenshots saved to `scripts/gui-tests/baselines/` for future regression comparison
- FR-12: The runner must be callable via `npm run gui-test` (package.json script)
- FR-13: Tests must clean up any git state changes they make (restore stashes, delete test branches, etc.)
- FR-14: The runner must handle the case where GitSlop crashes during a test (log the crash, continue with next test)

## Non-Goals

Nothing is out of scope per user request. However, the following are deferred to future iterations:
- Pixel-perfect baseline diffing (save baselines now, implement diffing later)
- CI/CD integration (tests require a display server)
- Performance benchmarking (load time, scroll FPS)
- Accessibility auditing (screen reader testing)

## Technical Considerations

- **Display**: Tests require X11 display `:1`. Will not work on Wayland-only or headless systems without Xvfb.
- **Dependencies**: `python-xlib`, `Pillow` (already installed in project .venv)
- **Screen control**: All interactions go through `scripts/screen-control.py` or the underlying python-xlib functions imported as a module
- **App launch**: Use `npx electron --no-sandbox .` (production build) for stability. Run `npx electron-vite build` first.
- **Timing**: Use `time.sleep()` for animation waits. Consider a `wait_for(predicate, timeout)` helper that polls screenshots for expected state.
- **Coordinate calculation**: The `translate_coords` X11 call gives window position. All clicks should be `window_x + rel_x, window_y + rel_y`.
- **Existing tests**: Unit tests in `src/renderer/src/**/__tests__/` and `src/main/__tests__/` cover logic. GUI tests cover visual and integration aspects.

## Success Metrics

- All 23 test cases pass on a fresh launch of GitSlop
- Full test suite completes in under 5 minutes
- Screenshots are clear enough for AI evaluation (1280x800 minimum window size)
- Report JSON is structured enough for programmatic analysis
- Zero false positives (tests don't fail due to timing issues or flaky coordinate math)

## Open Questions

- Should we add a `--headless` mode using Xvfb for CI environments?
- Should baseline screenshots be committed to git or gitignored?
- Should the evaluator integrate directly with the Claude API for automated AI verdicts?
