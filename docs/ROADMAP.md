# GitSlop Roadmap

## Completed

- [x] **UI Overhaul** — Lucide icons, CSS modules, SVG commit graph, three-column layout
- [x] **Sidebar Fix** — CSS flex sidebar, drag handle, icon rail
- [x] **UX Overhaul** — Tabs, permanent detail panel, center-stage diffs, staging in right panel
- [x] **Frontend Design Polish** — Typography, spacing, hover states, visual consistency
- [x] **Daily Driver** — Diff mode persistence, resizable panels, file tree view, full file viewer
- [x] **UI Polish & Menus** — Internal panel resizing, dark scrollbars, File/Edit/View/Help menu bar, collapsible panels, movable panel positions
- [x] **GitHub Integration** — OAuth device flow login, multi-account support, PR listing/viewing/creation
- [x] **GitLab Integration** — OAuth 2.0 PKCE login, multi-account with custom instance URLs, MR listing/viewing/creation, auto-refresh tokens
- [x] **Graph Scaling** — Commit pagination (configurable depth), lane compaction for inactive branches, force refresh after remote operations
- [x] **Staging Overhaul** — Line/hunk staging, working-tree diffs in center viewer, file status badges
- [x] **Performance** — Git-aware file watcher, request deduplication, network ops bypass, tooltip crash fix, loading overlay safety valve

All above on `main` as of April 13, 2026.

## Next Up

### 1. Unified Detail & Staging Panel (GitKraken-style)
Combine the commit detail panel and staging area into a single context-aware right panel, matching GitKraken's workflow:
- When no commit is selected: show staging area (unstaged/staged files, commit form)
- When a commit is selected: show commit details (info, changed files, diff links)
- Smooth transition between modes with no layout shift
- Single panel reduces visual complexity and reclaims vertical space
- Consider: split view option where both are visible (current behavior) as a user preference

### 2. In-App Updates & Release Notifications
Let users know about new versions and update without leaving the app:
- `electron-updater` infrastructure already exists — wire it to a visible UI
- Show update-available notification in status bar or toolbar
- "What's new" changelog dialog showing release notes
- One-click "Download & Install" with progress indicator
- Option to defer update ("Remind me later")
- Auto-check on startup with configurable frequency (or disable)
- Consider: update channel selection (stable vs. beta)

## Planned

### 3. Profiles & Identity Management
- Named profiles (profile name, author name, author email)
- Switch between profiles per-repo or globally
- Default profile selection

### 4. SSH Key Management
- Generate SSH keys from within the app
- Import existing SSH keys
- Associate keys with profiles
- Test connection to remotes

### 5. Commit Signing
- GPG key management (list, import, generate)
- SSH signing support
- Per-profile signing key configuration

## Backlog

- Custom themes and theme editor
- Plugin/extension system
- Improved merge conflict resolution (3-way visual merge)
- Interactive rebase improvements
- Submodule management improvements
- Git LFS support
- Blame annotations in diff viewer
- Commit graph minimap for navigation
