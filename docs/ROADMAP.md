# GitSlop Roadmap

## Completed
- [x] **UI Overhaul** — Lucide icons, CSS modules, SVG commit graph, three-column layout
- [x] **Sidebar Fix** — CSS flex sidebar, drag handle, icon rail
- [x] **UX Overhaul** — Tabs, permanent detail panel, center-stage diffs, staging in right panel
- [x] **Frontend Design Polish** — Typography, spacing, hover states, visual consistency
- [x] **Daily Driver** — Diff mode persistence, resizable panels, file tree view, full file viewer
- [x] **UI Polish & Menus** — Internal panel resizing, dark scrollbars, File/Edit/View/Help menu bar, collapsible panels, movable panel positions

All above merged to `main` as of April 9, 2026.

## Planned PRDs

### 1. Profiles & Identity Management
- Named profiles (profile name, author name, author email)
- Switch between profiles per-repo or globally
- Default profile selection
- Profile import/export

### 2. SSH Key Management
- Generate SSH keys from within the app
- Import existing SSH keys
- Associate keys with profiles
- SSH agent integration
- Test connection to remotes

### 3. Commit Signing
- GPG key management (list, import, generate)
- SSH signing support
- Per-profile signing key configuration
- Signature verification display (already partially implemented in commit details)

### 4. GitHub & GitLab Integration
- OAuth login for GitHub and GitLab
- View pull requests / merge requests in-app
- Create PRs/MRs from the app
- View CI/CD status
- Link issues to commits
- Review and comment on PRs

## Backlog (Not Yet Planned)
- Performance optimization for large repos (50k+ commits)
- Merge conflict resolution improvements
- Interactive rebase UI
- Submodule management improvements
- Plugin/extension system
- Custom themes
