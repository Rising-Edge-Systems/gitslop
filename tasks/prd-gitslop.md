# PRD: GitSlop — A Free, Professional Git GUI Client

## Introduction

GitSlop is a free, open-source, cross-platform GUI git client that rivals (and aims to surpass) GitKraken. It provides a polished, professional interface for managing git repositories — from visual branch graphs and inline diff views to a built-in code editor and toggleable CLI. It targets both git beginners who want visual clarity and power users who want speed and keyboard-driven workflows.

**Tech Stack:** Electron + React + TypeScript, shelling out to the user's installed `git` CLI for all git operations.

## Goals

- Provide a fully free alternative to GitKraken with no paywalled features
- Support all common git workflows through both GUI and keyboard shortcuts
- Render a clear, interactive branch/commit graph comparable to GitKraken's
- Offer visual diff, staging, and merge conflict resolution tools
- Include a built-in code editor and toggleable terminal for power users
- Work on Linux, macOS, and Windows
- Feel fast, polished, and professional — not like a hobby project

## User Stories

---

### US-001: Electron App Shell & Window Management
**Description:** As a developer, I need the foundational Electron + React app scaffold so all other features have a shell to live in.

**Acceptance Criteria:**
- [ ] Electron app boots and shows a React-rendered window
- [ ] Window supports minimize, maximize, close, and resize
- [ ] App has a custom titlebar with GitSlop branding
- [ ] Main process and renderer process are separated correctly
- [ ] Hot reload works in development mode
- [ ] TypeScript strict mode enabled, builds without errors
- [ ] `npm run dev` starts the app, `npm run build` produces a distributable

---

### US-002: Application Layout & Navigation Shell
**Description:** As a user, I want a clear application layout so I can navigate between different views and panels.

**Acceptance Criteria:**
- [ ] Left sidebar with collapsible sections (Branches, Remotes, Tags, Stashes)
- [ ] Center panel area for main content (graph, diff, editor)
- [ ] Bottom panel area for toggleable CLI terminal
- [ ] Top toolbar with action buttons (pull, push, fetch, branch, stash, etc.)
- [ ] Panels are resizable via drag handles
- [ ] Layout state persists across restarts
- [ ] Responsive — panels collapse gracefully at small window sizes

---

### US-003: Welcome Screen & Recent Repos
**Description:** As a user, I want a welcome screen when no repo is open so I can quickly open, clone, or init a repository.

**Acceptance Criteria:**
- [ ] Welcome screen shown when no repo is open
- [ ] "Open Repository" button that launches a folder picker
- [ ] "Clone Repository" button that opens a clone dialog
- [ ] "Init Repository" button that opens a folder picker + inits a new repo
- [ ] List of recently opened repositories (persisted across sessions)
- [ ] Clicking a recent repo opens it immediately
- [ ] Recent repos show path and last-opened date
- [ ] Remove individual entries from recent repos list

---

### US-004: Git CLI Wrapper Service
**Description:** As a developer, I need a service layer that executes git commands and parses their output so the UI can stay decoupled from git internals.

**Acceptance Criteria:**
- [ ] Service runs git commands via child_process in the main process
- [ ] IPC bridge exposes git operations to the renderer process
- [ ] Handles errors gracefully (git not installed, not a repo, auth failures)
- [ ] Commands are queued to prevent concurrent git operations on the same repo
- [ ] Supports cancellation of long-running operations
- [ ] Returns structured data (parsed JSON-like objects), not raw strings
- [ ] Detects user's git version on startup and warns if too old

---

### US-005: Open & Init Repositories
**Description:** As a user, I want to open an existing git repo or initialize a new one so I can start working.

**Acceptance Criteria:**
- [ ] "Open Repo" opens a native folder picker dialog
- [ ] If selected folder is a git repo, load it into the app
- [ ] If selected folder is NOT a git repo, show an error with option to init
- [ ] "Init Repo" creates a new git repo in the selected folder
- [ ] After opening/initing, app transitions from welcome screen to repo view
- [ ] Repo path shown in titlebar
- [ ] Recent repos list updated on open

---

### US-006: Clone Repository Dialog
**Description:** As a user, I want to clone a remote repository so I can start working on an existing project.

**Acceptance Criteria:**
- [ ] Clone dialog with fields: URL, destination folder, name (auto-filled from URL)
- [ ] Supports HTTPS and SSH URLs
- [ ] "Browse" button to pick destination folder
- [ ] Progress bar showing clone progress
- [ ] Cancel button to abort clone
- [ ] On success, automatically opens the cloned repo
- [ ] On failure, shows clear error message (auth failed, network error, etc.)
- [ ] SSH key passphrase prompt if needed

---

### US-007: Commit Graph — Data & Rendering
**Description:** As a user, I want to see a visual branch/commit graph so I can understand the project's history at a glance.

**Acceptance Criteria:**
- [ ] Parse `git log --all --graph` (or equivalent) into structured data
- [ ] Render a visual commit graph with colored branch lines
- [ ] Each commit shows: short hash, message (first line), author, relative date
- [ ] Branch/tag labels rendered as badges on their respective commits
- [ ] HEAD indicator clearly visible
- [ ] Graph renders correctly for merge commits, octopus merges, and linear history
- [ ] Virtualised scrolling — handles repos with 100k+ commits without lag
- [ ] Graph auto-refreshes when the repo changes (file watcher)

---

### US-008: Commit Graph — Interaction & Selection
**Description:** As a user, I want to interact with the commit graph to view details and perform actions on commits.

**Acceptance Criteria:**
- [ ] Click a commit to select it and show its details in a side/bottom panel
- [ ] Commit detail panel shows: full hash, author, date, full message, list of changed files
- [ ] Right-click a commit for context menu: cherry-pick, revert, reset to here, create branch here, create tag here, copy SHA
- [ ] Double-click a file in commit details to show the diff for that file
- [ ] Keyboard navigation: arrow keys to move between commits
- [ ] Multi-select commits with Shift+click for range operations (e.g., squash, rebase)

---

### US-009: Branch Sidebar — List & Management
**Description:** As a user, I want to see and manage all branches from the sidebar so I can switch contexts easily.

**Acceptance Criteria:**
- [ ] Sidebar section "Branches" lists all local branches
- [ ] Current branch highlighted/bolded
- [ ] Double-click a branch to check it out
- [ ] Right-click context menu: rename, delete, merge into current, rebase onto current, push, create PR (future)
- [ ] "New Branch" button opens a dialog: branch name, base branch/commit
- [ ] Branches sorted alphabetically, with current branch pinned to top
- [ ] Search/filter box to find branches in large repos
- [ ] Show ahead/behind count relative to tracking branch

---

### US-010: Remote Branches & Remote Management
**Description:** As a user, I want to see remote branches and manage remotes so I can collaborate with others.

**Acceptance Criteria:**
- [ ] Sidebar section "Remotes" lists all remotes, expandable to show their branches
- [ ] Double-click a remote branch to check it out as a local tracking branch
- [ ] Right-click remote branch: delete remote branch, fetch
- [ ] "Add Remote" dialog: name, URL
- [ ] "Edit Remote" dialog: change URL
- [ ] "Remove Remote" with confirmation
- [ ] Fetch all or fetch individual remotes

---

### US-011: Tags Sidebar
**Description:** As a user, I want to see and manage tags so I can mark releases and important commits.

**Acceptance Criteria:**
- [ ] Sidebar section "Tags" lists all tags
- [ ] Click a tag to scroll the graph to that commit
- [ ] Right-click: delete tag, push tag
- [ ] "New Tag" dialog: name, target commit (defaults to HEAD), message (for annotated tags)
- [ ] Tags sorted by date (newest first)
- [ ] Search/filter tags

---

### US-012: Stash Sidebar
**Description:** As a user, I want to see and manage stashes so I can temporarily shelve work.

**Acceptance Criteria:**
- [ ] Sidebar section "Stashes" lists all stashes with message and date
- [ ] Click a stash to view its diff
- [ ] Right-click: apply, pop, drop
- [ ] "Stash" button in toolbar: stash all changes, with optional message
- [ ] Option to include untracked files in stash
- [ ] Stash apply shows conflicts if any

---

### US-013: Working Directory Status Panel
**Description:** As a user, I want to see the current status of my working directory — staged, unstaged, and untracked files.

**Acceptance Criteria:**
- [ ] Status panel shows three sections: Staged, Unstaged, Untracked
- [ ] Each file shows: filename, path, change type icon (added/modified/deleted/renamed)
- [ ] File counts shown in section headers
- [ ] Click a file to show its diff in the diff viewer
- [ ] Status auto-refreshes on file system changes (file watcher)
- [ ] Empty state messaging when working directory is clean

---

### US-014: Staging & Unstaging Files
**Description:** As a user, I want to stage and unstage files so I can prepare my commits precisely.

**Acceptance Criteria:**
- [ ] "Stage" button (+ icon) on each unstaged/untracked file
- [ ] "Unstage" button (- icon) on each staged file
- [ ] "Stage All" button to stage everything
- [ ] "Unstage All" button to unstage everything
- [ ] Drag and drop files between staged and unstaged sections
- [ ] Keyboard shortcut to stage/unstage selected file(s)
- [ ] Multi-select files with Ctrl/Shift+click for bulk stage/unstage

---

### US-015: Hunk & Line Staging
**Description:** As a user, I want to stage individual hunks or lines so I can make precise, atomic commits.

**Acceptance Criteria:**
- [ ] When viewing a diff of an unstaged file, each hunk has a "Stage Hunk" button
- [ ] Individual lines within a hunk can be selected and staged
- [ ] Staged hunks/lines move to the staged diff view
- [ ] "Unstage Hunk" button on staged hunks
- [ ] Visual indicators clearly distinguish staged vs unstaged portions of a file
- [ ] Works correctly for added, modified, and deleted files

---

### US-016: Diff Viewer — Side-by-Side & Inline
**Description:** As a user, I want to see file diffs with syntax highlighting in both side-by-side and inline modes.

**Acceptance Criteria:**
- [ ] Toggle between side-by-side and inline (unified) diff views
- [ ] Syntax highlighting for common languages (JS/TS, Python, Rust, Go, Java, C/C++, HTML, CSS, JSON, YAML, Markdown, shell)
- [ ] Line numbers shown for both old and new versions
- [ ] Added lines highlighted green, removed lines highlighted red, modified lines highlighted with word-level diff
- [ ] Word-level diff highlighting within changed lines
- [ ] Scroll sync between left and right panes in side-by-side mode
- [ ] Diff gutter shows +/- indicators
- [ ] Handle binary files gracefully (show "Binary file changed" message)
- [ ] Handle large files gracefully (truncate with "Show more" option)

---

### US-017: Commit Dialog
**Description:** As a user, I want to write a commit message and commit my staged changes.

**Acceptance Criteria:**
- [ ] Commit message input: subject line + expandable body
- [ ] Character count indicator on subject line (warn at 72 chars)
- [ ] "Commit" button (disabled when no staged changes or empty message)
- [ ] "Commit & Push" button for convenience
- [ ] Amend checkbox to amend the last commit (pre-fills message)
- [ ] Sign-off checkbox (appends Signed-off-by line)
- [ ] Keyboard shortcut to commit (Ctrl+Enter)
- [ ] After commit, clear message and refresh status

---

### US-018: Push, Pull, Fetch Operations
**Description:** As a user, I want to push, pull, and fetch with clear feedback so I can sync with remotes.

**Acceptance Criteria:**
- [ ] Toolbar buttons for Push, Pull, Fetch
- [ ] Push: pushes current branch to its tracking remote
- [ ] Pull: pulls with configurable strategy (merge or rebase, set in preferences)
- [ ] Fetch: fetches all remotes
- [ ] Progress indicator during operations
- [ ] Force push option (with confirmation dialog warning about data loss)
- [ ] Pull shows incoming commits count before pulling
- [ ] Push shows outgoing commits count
- [ ] Error handling: auth failure, network error, rejected push (need to pull first)
- [ ] Push dialog for setting upstream when branch has no tracking branch

---

### US-019: Merge
**Description:** As a user, I want to merge branches visually so I can integrate changes.

**Acceptance Criteria:**
- [ ] Right-click branch → "Merge into current branch"
- [ ] Or use top menu/toolbar: merge dialog with branch picker
- [ ] Preview: show how many commits will be merged
- [ ] Fast-forward merge when possible (configurable)
- [ ] If conflicts arise, transition to merge conflict resolution view
- [ ] Abort merge button available during conflict resolution
- [ ] Success notification after clean merge

---

### US-020: Rebase
**Description:** As a user, I want to rebase branches so I can maintain clean linear history.

**Acceptance Criteria:**
- [ ] Right-click branch → "Rebase current onto this branch"
- [ ] Interactive rebase: show list of commits with pick/squash/edit/drop options
- [ ] If conflicts arise during rebase, show conflict resolution view with continue/abort/skip
- [ ] Progress indicator showing which commit is being replayed (e.g., "3 of 7")
- [ ] Abort rebase button always accessible
- [ ] Warning when rebasing published commits

---

### US-021: Cherry-Pick
**Description:** As a user, I want to cherry-pick commits so I can selectively apply changes.

**Acceptance Criteria:**
- [ ] Right-click commit in graph → "Cherry-pick"
- [ ] Multi-select commits for batch cherry-pick
- [ ] If conflicts, show conflict resolution view
- [ ] Success notification with link to new commit
- [ ] Abort cherry-pick option

---

### US-022: Reset (Soft, Mixed, Hard)
**Description:** As a user, I want to reset my branch to a previous commit with different modes.

**Acceptance Criteria:**
- [ ] Right-click commit → "Reset current branch to here"
- [ ] Dialog with mode selection: Soft, Mixed (default), Hard
- [ ] Clear explanation of what each mode does
- [ ] Hard reset requires explicit confirmation ("Type HARD to confirm")
- [ ] After reset, refresh graph and status

---

### US-023: Revert Commit
**Description:** As a user, I want to revert a commit so I can undo changes safely without rewriting history.

**Acceptance Criteria:**
- [ ] Right-click commit → "Revert"
- [ ] Creates a new revert commit
- [ ] If conflicts, show conflict resolution view
- [ ] Revert of merge commits: prompt for parent number
- [ ] Success notification

---

### US-024: Merge Conflict Resolution Tool
**Description:** As a user, I want a visual 3-way merge tool so I can resolve conflicts without leaving the app.

**Acceptance Criteria:**
- [ ] 3-pane view: Ours (left), Theirs (right), Result (bottom)
- [ ] Syntax highlighting in all panes
- [ ] Conflict markers highlighted and clickable
- [ ] "Accept Ours", "Accept Theirs", "Accept Both" buttons per conflict
- [ ] Manual editing in the Result pane
- [ ] Navigation: "Next Conflict" / "Previous Conflict" buttons
- [ ] Conflict count indicator (e.g., "Conflict 2 of 5")
- [ ] "Mark as Resolved" button per file
- [ ] "Resolve All" using a chosen strategy (ours/theirs) for bulk resolution
- [ ] After all files resolved, prompt to continue merge/rebase/cherry-pick

---

### US-025: Built-in Code Editor
**Description:** As a user, I want a built-in code editor so I can make quick edits without switching to an external editor.

**Acceptance Criteria:**
- [ ] Monaco editor (VS Code's editor) embedded in a tab/panel
- [ ] Open files from the file tree, diff viewer, or commit details
- [ ] Syntax highlighting for common languages
- [ ] File tabs for multiple open files
- [ ] Modified indicator on unsaved tabs
- [ ] Save with Ctrl+S
- [ ] Undo/redo support
- [ ] Line numbers, minimap, word wrap toggle
- [ ] Integration: saving a file triggers status panel refresh

---

### US-026: Toggleable CLI Terminal
**Description:** As a power user, I want a built-in terminal so I can run git commands (or any shell commands) without leaving the app.

**Acceptance Criteria:**
- [ ] Terminal panel at the bottom, toggled with a keyboard shortcut (Ctrl+`)
- [ ] Uses xterm.js for terminal emulation
- [ ] Starts a shell (bash/zsh/cmd/powershell depending on OS) in the repo directory
- [ ] Multiple terminal tabs
- [ ] Resizable panel height via drag handle
- [ ] Terminal output triggers repo status refresh (debounced)
- [ ] Copy/paste works correctly
- [ ] Font size matches app theme settings

---

### US-027: Search — Commits, Files, Branches
**Description:** As a user, I want to search across commits, files, and branches so I can find what I'm looking for quickly.

**Acceptance Criteria:**
- [ ] Global search bar (Ctrl+P / Ctrl+K) with command-palette style
- [ ] Search modes: Commits (message, SHA, author), Files (filename, content), Branches/Tags
- [ ] Results displayed in a filterable dropdown
- [ ] Selecting a commit result scrolls graph to it
- [ ] Selecting a file result opens it in the editor
- [ ] Selecting a branch result checks it out (with confirmation)
- [ ] Search is debounced and fast (< 200ms for local results)

---

### US-028: Commit History & Filtering
**Description:** As a user, I want to filter and explore commit history so I can find specific changes.

**Acceptance Criteria:**
- [ ] Filter by: author, date range, file path, commit message text
- [ ] Filters combinable (e.g., author + date range)
- [ ] Filter UI as a collapsible bar above the graph
- [ ] Active filters shown as removable chips/badges
- [ ] "Show commits touching this file" from file context menu
- [ ] Filtered view clearly indicates it's filtered (not the full history)
- [ ] Clear all filters button

---

### US-029: File Tree View
**Description:** As a user, I want to browse the repository's file tree so I can navigate the project structure.

**Acceptance Criteria:**
- [ ] File tree in a sidebar tab (alongside branch sidebar)
- [ ] Expandable/collapsible folder hierarchy
- [ ] File icons by type/extension
- [ ] Right-click: open in editor, show history, show blame, copy path
- [ ] Double-click to open in built-in editor
- [ ] Git status indicators on files (modified, staged, untracked, conflicted)
- [ ] Search/filter within the file tree

---

### US-030: Git Blame View
**Description:** As a user, I want to see git blame annotations so I can understand who changed each line and when.

**Acceptance Criteria:**
- [ ] Blame gutter alongside file content in the editor view
- [ ] Shows author, date, and commit SHA per line block
- [ ] Hover on blame annotation shows full commit message
- [ ] Click blame annotation to view that commit in the graph
- [ ] Color-code blame blocks by age or author
- [ ] Toggle blame on/off

---

### US-031: Theme System — Dark & Light
**Description:** As a user, I want to choose between dark and light themes so I can work comfortably in any lighting.

**Acceptance Criteria:**
- [ ] Dark theme (default) and light theme
- [ ] Toggle in settings and via keyboard shortcut
- [ ] All UI elements styled correctly in both themes (no broken/unreadable sections)
- [ ] Theme preference persisted across sessions
- [ ] Smooth transition when switching themes
- [ ] Consistent color palette — professional, not garish

---

### US-032: Keyboard Shortcuts System
**Description:** As a user, I want comprehensive keyboard shortcuts so I can work without touching the mouse.

**Acceptance Criteria:**
- [ ] Default shortcuts for all common actions (commit, push, pull, stage, etc.)
- [ ] Keyboard shortcut reference panel (Ctrl+?)
- [ ] Shortcuts shown in tooltips and context menus
- [ ] No conflicting shortcuts
- [ ] Key shortcuts:
  - Ctrl+Enter: Commit
  - Ctrl+Shift+P: Push
  - Ctrl+Shift+L: Pull
  - Ctrl+Shift+F: Fetch
  - Ctrl+`: Toggle terminal
  - Ctrl+K: Command palette / search
  - Ctrl+B: Toggle sidebar
  - Ctrl+S: Save (in editor)
  - Ctrl+Z/Y: Undo/redo (in editor)

---

### US-033: Settings & Preferences Panel
**Description:** As a user, I want a settings panel to configure the application to my liking.

**Acceptance Criteria:**
- [ ] Settings accessible from menu and keyboard shortcut (Ctrl+,)
- [ ] Sections: General, Appearance, Git, Editor, Keybindings
- [ ] General: default clone directory, auto-fetch interval, proxy settings
- [ ] Appearance: theme (dark/light), font family, font size, sidebar position
- [ ] Git: default pull strategy (merge/rebase), sign commits (GPG), auto-stash on pull, default branch name
- [ ] Editor: tab size, word wrap, minimap on/off
- [ ] Keybindings: view and customize all shortcuts
- [ ] Settings stored in a JSON config file in user's app data directory
- [ ] Changes take effect immediately (no restart required)

---

### US-034: Notifications & Status Bar
**Description:** As a user, I want clear feedback about operations so I know what's happening.

**Acceptance Criteria:**
- [ ] Status bar at the bottom showing: current branch, sync status (ahead/behind), active operation
- [ ] Toast notifications for completed operations (commit, push, pull, etc.)
- [ ] Error notifications with "Show Details" expansion
- [ ] Notification history accessible from status bar
- [ ] Loading spinners on toolbar buttons during async operations
- [ ] Operation progress bar for clone, fetch, push, pull

---

### US-035: Auto-Fetch & File Watching
**Description:** As a user, I want the app to stay up-to-date automatically so I always see the current state.

**Acceptance Criteria:**
- [ ] File system watcher detects changes in the working directory
- [ ] Status panel and diff viewer auto-refresh on file changes (debounced)
- [ ] Auto-fetch from remotes on a configurable interval (default: 5 minutes)
- [ ] Auto-fetch can be disabled in settings
- [ ] Incoming changes indicator in status bar after fetch
- [ ] Refresh button for manual full reload

---

### US-036: Context Menus Throughout
**Description:** As a user, I want right-click context menus on all interactive elements for quick access to actions.

**Acceptance Criteria:**
- [ ] Context menu on commits: cherry-pick, revert, reset, create branch, create tag, copy SHA
- [ ] Context menu on branches: checkout, merge, rebase, rename, delete, push
- [ ] Context menu on files (status): stage, unstage, discard changes, open in editor, show history
- [ ] Context menu on remotes: fetch, edit, remove
- [ ] Context menu on tags: checkout, delete, push
- [ ] Context menu on stashes: apply, pop, drop
- [ ] All context menu items show keyboard shortcuts where applicable

---

### US-037: Discard Changes
**Description:** As a user, I want to discard changes to files so I can revert unwanted modifications.

**Acceptance Criteria:**
- [ ] Right-click file → "Discard Changes" (with confirmation)
- [ ] "Discard All Changes" button (with confirmation)
- [ ] Discard individual hunks from the diff viewer
- [ ] Confirmation dialog clearly states the action is irreversible
- [ ] Works for modified, deleted, and new (untracked) files

---

### US-038: Submodule Support
**Description:** As a user, I want basic submodule support so I can work with repos that use them.

**Acceptance Criteria:**
- [ ] Sidebar shows submodules section when present
- [ ] Submodule status: initialized, dirty, out of date
- [ ] Init/update submodule from context menu
- [ ] Open submodule as a separate repo in a new tab/window
- [ ] Submodule changes visible in status panel

---

### US-039: GPG Commit Signing
**Description:** As a user, I want to sign my commits with GPG so I can verify authorship.

**Acceptance Criteria:**
- [ ] Setting to enable commit signing by default
- [ ] GPG key selection in settings (reads from git config or lists available keys)
- [ ] Signed commits shown with a verification badge in the graph
- [ ] Sign individual commits via checkbox in commit dialog
- [ ] Clear error message if GPG key is not found or passphrase fails

---

### US-040: Cross-Platform Packaging & Distribution
**Description:** As a developer, I need the app to build and package correctly on all platforms.

**Acceptance Criteria:**
- [ ] Electron Builder configured for Linux (.deb, .AppImage), macOS (.dmg), Windows (.exe, .msi)
- [ ] Auto-update mechanism via electron-updater
- [ ] App icon and branding on all platforms
- [ ] Code signing configured (placeholder for future certificates)
- [ ] README with build instructions for all platforms
- [ ] CI pipeline config (GitHub Actions) for automated builds

---

## Functional Requirements

- FR-1: The app must shell out to the user's installed `git` CLI for all git operations
- FR-2: The app must detect if git is not installed and show a helpful error
- FR-3: The app must support repositories of any size (100k+ commits) without freezing
- FR-4: The commit graph must render branch lines with distinct colors per branch
- FR-5: All destructive operations (hard reset, force push, discard, branch delete) must require confirmation
- FR-6: The app must watch the file system and auto-refresh when files change
- FR-7: The diff viewer must support syntax highlighting for at least 12 common languages
- FR-8: The built-in terminal must spawn the user's default shell
- FR-9: The app must persist user settings, recent repos, and layout state across sessions
- FR-10: All async operations must show progress feedback and support cancellation where possible
- FR-11: The app must handle SSH and HTTPS authentication, including passphrase prompts
- FR-12: The app must work offline (git operations that don't require network)
- FR-13: Keyboard shortcuts must be provided for all common operations
- FR-14: The app must use Electron's IPC for main↔renderer communication (no direct Node.js in renderer)

## Non-Goals

- Not building a GitHub/GitLab integration (no PR creation, issue tracking, etc.) — this is a git client, not a platform client
- Not supporting non-git VCS (Mercurial, SVN, etc.)
- Not building a web version — desktop only
- Not implementing custom merge algorithms — relies on git's built-in merge
- Not supporting shallow/partial clones in the UI (git does it, but we won't expose controls)
- No built-in CI/CD integration
- No collaborative/real-time editing features
- No custom keybinding editor in v1 (just show defaults; customization via config file)

## Design Considerations

- **Visual Language:** Clean, minimal, dark by default. Think VS Code's aesthetics — neutral grays, accent colors for branch lines and status indicators. No unnecessary ornamentation.
- **Layout:** Three-column when needed (sidebar, main, detail), but should feel spacious, not cramped. Generous padding and spacing.
- **Typography:** Monospace for code, hashes, and terminal. System UI font for everything else.
- **Icons:** Consistent icon set (Lucide or Phosphor). No mixing icon families.
- **Animations:** Subtle transitions (panel open/close, theme switch). No flashy animations. Respect `prefers-reduced-motion`.
- **Accessibility:** Keyboard navigable throughout. ARIA labels on interactive elements. Sufficient contrast ratios.

## Technical Considerations

- **Git CLI Parsing:** Use `--format` flags on git commands to get structured output where possible (e.g., `git log --format='%H|%an|%s|%d'`). Fall back to regex parsing only when structured output isn't available.
- **Performance:** Virtualised lists for commit graph (react-window or react-virtuoso). Lazy-load commit details. Debounce file watcher events.
- **IPC:** All git operations happen in the main process. Renderer requests via IPC. Consider a dedicated worker thread for heavy parsing.
- **Monaco Editor:** Lazy-load Monaco to reduce initial bundle size. Use Monaco's built-in git diff support.
- **xterm.js:** Use for terminal emulation. Connect to node-pty for shell spawning.
- **State Management:** Consider Zustand or Jotai for lightweight state. Avoid Redux overhead.
- **File Watching:** Use chokidar for cross-platform file watching. Debounce at ~300ms.
- **Testing:** Jest for unit tests, Playwright for E2E tests.

## Success Metrics

- App starts in under 3 seconds on a modern machine
- Opening a repo with 50k commits renders the graph in under 2 seconds
- All common git operations accessible in 2 clicks or fewer (or via keyboard shortcut)
- Zero paywalled features — complete parity with GitKraken's paid tier
- Cross-platform: tested and working on Ubuntu 22+, macOS 13+, Windows 10+

## Open Questions

- Should we support multiple repos open simultaneously (tabs/windows)?
- Should the graph layout algorithm be custom or use an existing library (e.g., dagre)?
- Do we want a plugin/extension system in the future?
- Should we integrate with system keychain for credential storage?
- LFS support — include in v1 or defer?
