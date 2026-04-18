# GitSlop Project Status — April 17, 2026

## Current State

**Branch:** `main`
**Version:** 1.2.5
**App status:** Builds, launches, and runs on Windows/Linux/macOS. Typecheck passes.

## Recent Work (v1.2.x — April 2026)

### v1.2.5 — Commit Detail & Staging Polish
- **Full commit message visible in detail panel**: `git show` output was being split by `\n` and only the first line kept, so the body got truncated at the first newline. Now uses a record-end marker and the full body comes through.
- **Commit description always visible**: replaced the "+ Description" toggle with an always-rendered textarea, with 8px breathing room between the subject and description.
- **Resizable staging columns**: drag handle between Unstaged and Staged sections, double-click to reset to 50/50, split persists in localStorage.
- **No more typing hijack**: `s`/`u` (and any future plain-letter shortcut) no longer steal characters from commit message and other text inputs.

### v1.2.4 — Auto-Stash on Pull & Hunk-Based Conflict Resolver
- **Auto-stash on pull** (default on, opt-out in Settings → Git): dirty working tree no longer blocks a pull. Local changes (including untracked files) are stashed, pull runs, then the stash pops. If the pop conflicts, the stash is preserved with a hint in the error.
- **Hunk-based merge conflict resolver**: scrollable stack of per-hunk cards with 3 lines of surrounding context, line numbers, and per-hunk Accept Ours / Accept Theirs / Accept Both buttons. File-level Accept All buttons in the summary bar. Full-file Result collapsed behind a toggle.
- **Conflict banner auto-dismisses** when conflicts are resolved externally (CLI, other tool, or in-app).
- **Untracked files** in the unstaged column now use the `+` icon matching Added files (instead of `?`), and folder counters merge `+added +untracked` into one group.
- **Graph refresh reliability**: auto-fetch now triggers a graph refresh when the incoming count changes; force-refresh bypasses the in-flight guard so it can't be swallowed by a slower load.
- **Windows screen-control script** (`scripts/screen-control-windows.py`) — pyautogui + pywin32 equivalent of the X11 tool.

### v1.2.3 — Staging Auto-Refresh, Credentials, Help Menu
- Staging area auto-refreshes on file system changes (new files, .gitignore edits)
- Right-click folders in tree view to Stage All / Unstage All child files
- Loading overlay with spinner during staging operations
- Help menu: Report a Bug, Suggest a Feature, Check for Updates
- Git push/pull/fetch/clone now use stored OAuth/PAT credentials (GIT_ASKPASS)
- Always create annotated tags so `--follow-tags` pushes them correctly

### v1.2.2 — Double-Click Checkout
- Double-click any branch/tag label in the commit graph to checkout that branch
- Loading overlay with spinner during checkout
- CI/CD now uses annotated tag messages as GitHub Release notes

### v1.2.1 — Staging Improvements & Multi-Commit Diff
- **Staging area**: Path/tree view toggle, per-file insertion/deletion stats (numstat), folder status counts (colored like WIP indicator)
- **Unified file status icons**: Lucide icons (FilePlus/FileEdit/FileMinus) across both staging and commit details
- **Multi-commit diff**: Select 2+ commits to see combined diff between oldest and newest, with all selected commits listed in detail panel
- **Unified Issues sidebar**: Single auto-detecting Issues section replaces separate GitHub/GitLab sections
- **Unified path/tree toggle**: Moved to right sidebar header, shared by both commit details and staging area
- **Split diff fix**: Added background to both panels to prevent text bleed-through
- **Graph line fix**: Lines no longer disappear when scrolling far in commit history

### v1.2.0 — Issues & Sidebar
- GitHub Issues sidebar section
- GitLab Issues sidebar section

### Earlier (v1.0.x — v1.1.x)
- Graph refresh and scaling (commit pagination, lane compaction, configurable depth)
- GitHub/GitLab OAuth login with multi-account support
- Staging diff overhaul with line/hunk staging in center panel
- 3-way merge conflict resolution
- Built-in Monaco editor and terminal
- CI/CD pipeline and auto-update infrastructure

## Architecture

```
┌─ TitleBar (36px, frameless) ─────────────────────────────────┐
├─ TabBar (32px) — always visible, "+" to add repos ──────────┤
├─ Toolbar (40px) — context-aware buttons ─────────────────────┤
├──────────────────────────────────────────────────────────────┤
│ Sidebar    │ Center Panel          │ Right Panel (340px)     │
│ (260px)    │                       │ [path/tree] [position]  │
│            │ Commit Graph          │                         │
│ Branches   │ (full height)         │ Detail Panel (top)      │
│ Files      │                       │  - commit info          │
│ Remotes    │ OR                    │  - changed files        │
│ Tags       │                       │  - multi-commit compare │
│ Stashes    │ Diff Viewer           │                         │
│ Submodules │ (when file selected)  │ Staging Area (bottom)   │
│ PRs / MRs  │                       │  - path or tree view    │
│ Issues     │ OR                    │  - staged/unstaged      │
│            │                       │  - commit form          │
│            │ Working Tree Diff     │                         │
├──────────────────────────────────────────────────────────────┤
│ Terminal Panel (toggleable, xterm.js + node-pty)             │
├──────────────────────────────────────────────────────────────┤
│ StatusBar (24px) — branch, fetch status, ahead/behind        │
└──────────────────────────────────────────────────────────────┘
```

## Open Task PRDs

- `tasks/prd-diff-viewer-scroll.md` — Single-container scroll sync for side-by-side diff
- `tasks/prd-diff-virtualization.md` — Virtualize diff rows with react-window for large diffs

## How to Run

```bash
npm install
npm run dev          # Dev mode with hot reload
npm run typecheck    # Type-check main + renderer
npm run test         # Run vitest test suite
npm run dist:win     # Build Windows installer
npm run dist:linux   # Build Linux .deb + .AppImage
npm run dist:mac     # Build macOS .dmg
```
