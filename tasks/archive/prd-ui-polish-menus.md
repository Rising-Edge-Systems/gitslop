# PRD: Internal Panel Resizing, Scrollbar Theming, Draggable Panels, Menu Bar

## Introduction

GitSlop needs four more usability improvements to reach daily-driver quality:

1. **Internal panel resizing** — The staging area and commit details each have internal sections separated by thin gray lines. Users should be able to drag those dividers to resize sections within each panel.
2. **Scrollbar theming** — Scrollbars are harsh white against the dark theme. They should match the app's color scheme.
3. **Draggable/rearrangeable panels** — Like VS Code, users should be able to drag panels to different positions (e.g., move the right sidebar to the bottom).
4. **Application menu bar** — File/Edit/View/Help menus at the top, matching what GitKraken provides.

## User Stories

### US-PM-001: Resizable Staging Area Internal Sections
**Description:** As a user, I want to drag the divider between the file lists and the commit form in the staging area to give more space to either section.

**Acceptance Criteria:**
- [ ] The thin gray line between the file lists (unstaged/staged columns) and the commit form section is a draggable handle
- [ ] Cursor changes to `row-resize` on hover over the divider
- [ ] Dragging adjusts the vertical split: file lists above, commit form below
- [ ] Minimum heights enforced: file lists min 80px, commit form min 120px
- [ ] Add `stagingInternalSplit: number` (percentage, 0-100 for file list share) to LayoutState with default 65
- [ ] Split persists across restarts
- [ ] Uses the same mousedown/mousemove/mouseup drag pattern as other drag handles
- [ ] Typecheck passes

### US-PM-002: Resizable Commit Details Internal Sections
**Description:** As a user, I want to drag the divider between commit metadata and the changed files list in the commit detail panel.

**Acceptance Criteria:**
- [ ] The thin gray line between commit metadata (subject, author, date, SHA, body) and the changed files section is a draggable handle
- [ ] Cursor changes to `row-resize` on hover
- [ ] Dragging adjusts the vertical split: metadata above, files list below
- [ ] Minimum heights enforced: metadata min 100px, files section min 80px
- [ ] Add `detailInternalSplit: number` (percentage for metadata share) to LayoutState with default 40
- [ ] Split persists across restarts
- [ ] Typecheck passes

### US-PM-003: Dark-Themed Scrollbars
**Description:** As a user, I want scrollbars to match the dark theme instead of being bright white.

**Acceptance Criteria:**
- [ ] Add custom scrollbar CSS using `::-webkit-scrollbar`, `::-webkit-scrollbar-track`, `::-webkit-scrollbar-thumb` pseudo-elements
- [ ] Scrollbar track: var(--bg-primary) or transparent
- [ ] Scrollbar thumb: var(--border) color, rounded (border-radius: 4px)
- [ ] Scrollbar thumb on hover: slightly brighter (var(--text-muted) or lighter border color)
- [ ] Scrollbar width: 8px (thin but usable)
- [ ] Applied globally in global.css so all scrollable areas get the themed scrollbars
- [ ] Both dark and light themes have appropriate scrollbar colors
- [ ] Typecheck passes

### US-PM-004: Application Menu Bar — File Menu
**Description:** As a user, I want a File menu with common repository operations.

**Acceptance Criteria:**
- [ ] A native Electron application menu with File/Edit/View/Help menus
- [ ] Build the menu in `src/main/index.ts` using Electron's `Menu.buildFromTemplate()` and `Menu.setApplicationMenu()`
- [ ] File menu items: New Window, Open Repository (Ctrl+O), Clone Repository (Ctrl+Shift+C), Init Repository, separator, Close Tab (Ctrl+W), Close Repository, separator, Settings (Ctrl+,), separator, Quit (Ctrl+Q)
- [ ] Open Repository triggers the native directory picker dialog
- [ ] Clone Repository sends IPC to renderer to open clone dialog
- [ ] Close Tab sends IPC to renderer to close the active tab
- [ ] Settings sends IPC to renderer to open settings panel
- [ ] Menu items that need a repo context (Close Tab, Close Repository) are disabled when no repo is open
- [ ] Typecheck passes

### US-PM-005: Application Menu Bar — Edit Menu
**Description:** As a user, I want an Edit menu with standard editing operations.

**Acceptance Criteria:**
- [ ] Edit menu items: Undo (Ctrl+Z), Redo (Ctrl+Shift+Z), separator, Cut (Ctrl+X), Copy (Ctrl+C), Paste (Ctrl+V), Select All (Ctrl+A), separator, Find (Ctrl+F)
- [ ] Standard editing commands use Electron's built-in role-based menu items (role: 'undo', 'redo', 'cut', 'copy', 'paste', 'selectAll')
- [ ] Find sends IPC to renderer to open search palette (Ctrl+K)
- [ ] Typecheck passes

### US-PM-006: Application Menu Bar — View Menu
**Description:** As a user, I want a View menu to toggle UI panels and zoom.

**Acceptance Criteria:**
- [ ] View menu items: Toggle Sidebar (Ctrl+B), Toggle Terminal (Ctrl+`), separator, Zoom In (Ctrl+=), Zoom Out (Ctrl+-), Reset Zoom (Ctrl+0), separator, Toggle Full Screen (F11), separator, Toggle Developer Tools (Ctrl+Shift+I)
- [ ] Toggle Sidebar/Terminal send IPC to renderer to toggle the respective panel
- [ ] Zoom uses Electron's built-in webContents.setZoomLevel() or role-based zoom items
- [ ] Full Screen uses Electron's win.setFullScreen() toggle
- [ ] Developer Tools uses role: 'toggleDevTools'
- [ ] Typecheck passes

### US-PM-007: Application Menu Bar — Help Menu
**Description:** As a user, I want a Help menu with links and about info.

**Acceptance Criteria:**
- [ ] Help menu items: Keyboard Shortcuts (Ctrl+?), separator, Documentation (opens browser to GitHub wiki/docs), Report Issue (opens browser to GitHub issues), separator, About GitSlop
- [ ] Keyboard Shortcuts sends IPC to renderer to open the shortcuts panel
- [ ] Documentation and Report Issue use shell.openExternal() to open URLs in the default browser
- [ ] About GitSlop shows a dialog with: app name, version (from package.json), Electron/Chromium/Node versions
- [ ] Typecheck passes

### US-PM-008: Panel Drag-and-Drop Rearrangement
**Description:** As a user, I want to drag panels to different positions in the layout, like VS Code allows.

**Acceptance Criteria:**
- [ ] Users can drag the right panel (commit details + staging) to the bottom position (below center, spanning full width)
- [ ] Users can drag it back to the right position
- [ ] Add `rightPanelPosition: 'right' | 'bottom'` to LayoutState with default 'right'
- [ ] When in bottom position: the right panel renders below the center panel as a horizontal strip, full width minus sidebar
- [ ] When in bottom position: the detail/staging split becomes horizontal (side by side) instead of vertical (stacked)
- [ ] A small drag affordance (grip dots) on the panel header enables dragging
- [ ] Position persists across restarts
- [ ] The terminal panel is unaffected (always at the very bottom)
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Staging area and commit details internal dividers are draggable with persisted ratios
- FR-2: Custom scrollbar CSS applied globally, matching dark/light theme
- FR-3: Native Electron application menu with File/Edit/View/Help
- FR-4: Menu actions communicate with renderer via IPC
- FR-5: Right panel can be positioned on the right or bottom via drag-and-drop
- FR-6: All new layout values persist to localStorage via useLayoutState

## Non-Goals

- Not implementing full arbitrary panel layout like VS Code (only right↔bottom for the detail panel)
- Not implementing tab drag between panel positions
- Not adding a custom in-app menu (using native Electron menu)

## Technical Considerations

- **Electron menu**: Built in main process (`src/main/index.ts`). Uses `Menu.buildFromTemplate()`. IPC for renderer communication via `mainWindow.webContents.send()`.
- **Scrollbar CSS**: Webkit pseudo-elements work in Electron's Chromium. Add to `global.css` with `[data-theme]` selectors for dark/light variants.
- **Internal drag handles**: Same mousedown/mousemove/mouseup pattern as sidebar and right panel drag handles. Track container height via ref, compute pixel positions from percentage split.
- **Panel position**: When `rightPanelPosition === 'bottom'`, render the detail+staging div below the center panel instead of beside it, adjusting flex-direction.
