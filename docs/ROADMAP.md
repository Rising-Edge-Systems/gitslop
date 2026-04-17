# GitSlop Roadmap

## Completed

- [x] **UI Overhaul** — Lucide icons, CSS modules, SVG commit graph, three-column layout
- [x] **Sidebar Fix** — CSS flex sidebar, drag handle, icon rail
- [x] **UX Overhaul** — Tabs, permanent detail panel, center-stage diffs, staging in right panel
- [x] **Frontend Design Polish** — Typography, spacing, hover states, visual consistency
- [x] **Daily Driver** — Diff mode persistence, resizable panels, file tree view, full file viewer
- [x] **UI Polish & Menus** — Internal panel resizing, dark scrollbars, menu bar, collapsible panels, movable panel positions
- [x] **GitHub Integration** — OAuth device flow login, multi-account support, PR listing/viewing/creation
- [x] **GitLab Integration** — OAuth 2.0 PKCE login, multi-account with custom instance URLs, MR listing/viewing/creation
- [x] **Graph Scaling** — Commit pagination, lane compaction, configurable history depth
- [x] **Staging Overhaul** — Line/hunk staging, working-tree diffs in center viewer
- [x] **Performance** — Git-aware file watcher, request deduplication, loading safety valve
- [x] **Unified Detail & Staging Panel** — Context-aware right panel: staging when WIP selected, commit details when commit selected
- [x] **In-App Updates** — Status bar notification, update dialog with release notes, download progress, one-click install
- [x] **Profiles & Identity Management** — Named profiles with author name/email, per-repo or global switching
- [x] **SSH Key Management** — Generate, import, associate with profiles, test connections
- [x] **Commit Signing** — GPG/SSH signing support, per-profile signing key configuration
- [x] **Issues Sidebar** — Unified GitHub/GitLab Issues section with auto-detection
- [x] **Multi-Commit Diff** — Select 2+ commits to compare, full commit details in panel
- [x] **Staging Path/Tree View** — Tree view with folder status counts, per-file numstat, Lucide status icons
- [x] **Double-Click Checkout** — Double-click branch/tag labels to checkout with loading overlay
- [x] **Graph Line Fix** — Lines no longer disappear when scrolling far in history
- [x] **CI/CD Release Notes** — Annotated tag messages used as GitHub Release notes
- [x] **Staging Auto-Refresh** — File watcher updates staging on external changes; Stage All / Unstage All on folders
- [x] **Credentialed Git Network Ops** — push/pull/fetch/clone use stored OAuth/PAT tokens via GIT_ASKPASS
- [x] **Help Menu** — Report Bug, Suggest Feature, Check for Updates
- [x] **Auto-Stash on Pull** — Pull over a dirty tree by stashing, pulling, popping. Opt-out in settings.
- [x] **Hunk-Based Merge Conflict Resolver** — Per-hunk accept buttons with surrounding context
- [x] **Reactive Conflict Banner** — Banner + resolver auto-dismiss when conflicts cleared externally

All above on `main` as of April 17, 2026 (v1.2.4).

## Next Up

### 1. Diff Viewer Scroll Sync
Replace dual-pane scroll sync (1-frame offset on fast scroll) with a single scrollable container rendering both columns, eliminating sync logic entirely.

### 2. Diff Viewer Virtualization
Virtualize diff rows with react-window for large diffs (4000+ rows). Currently renders every row to DOM which becomes slow.

## Backlog

- Custom themes and theme editor
- Plugin/extension system
- Interactive rebase improvements
- Submodule management improvements
- Git LFS support
- Blame annotations in diff viewer
- Commit graph minimap for navigation
