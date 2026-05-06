# GitSlop Project Status — May 5, 2026

## Current State

**Branch:** `main`
**Version:** 1.2.12
**App status:** Builds, launches, and runs on Windows/Linux/macOS. Typecheck passes.

## Recent Work (v1.2.x — April–May 2026)

### v1.2.12 — macOS Title Bar Layout
- **GitSlop wordmark and menus no longer sit under the macOS traffic lights.** With `frame: false` + `titleBarStyle: 'hidden'`, the native close/minimize/maximize buttons are still drawn in the top-left and were overlapping the wordmark and *File* menu trigger. Added an 80px left inset to `MenuBar` on macOS so they clear the buttons.
- **Removed redundant minimize/maximize/close buttons on macOS.** The custom Lucide-icon window controls duplicated the native traffic lights. They now render only on Linux/Windows. Theme toggle stays cross-platform.
- **`window.electronAPI.platform` exposed.** New preload field for renderer-side platform branching; future macOS-only tweaks no longer need ad-hoc UA sniffing.

### v1.2.11 — Custom macOS Installer (Bypass Squirrel.Mac)
- **Auto-update on macOS now works for unsigned builds.** `electron-updater` proxies the install through Squirrel.Mac, which silently rejects updates for any bundle without a Developer ID signature — that's why 1.2.9 → 1.2.10 went "successfully downloaded, Restart to Update does nothing." Replaced the install path with a detached shell script that extracts the cached ZIP, strips quarantine xattrs, swaps `/Applications/GitSlop.app`, and `open`s the new bundle. Squirrel is no longer involved on macOS.
- **Non-admin users supported.** The installer detects whether `/Applications` is writable. Admin accounts run silently; non-admin accounts get the standard macOS "type your password to authorize" dialog via `osascript ... with administrator privileges`. Either way, no Apple Developer ID needed.
- **Linux/Windows unchanged** — they still use `autoUpdater.quitAndInstall()` because their installers don't have the Squirrel.Mac signing requirement.
- **One-time bootstrap required.** Existing 1.2.9/1.2.10 macOS users need to install 1.2.11 manually once (download the DMG, drag onto `/Applications`, replace). After that, every future release auto-updates through the new path.

### v1.2.10 — macOS Auto-Update Fix
- **macOS auto-updater no longer fails with "ZIP file not provided".** `electron-updater` on macOS requires a `.zip` artifact to apply updates (it can't auto-apply a DMG), but the build only emitted a DMG. Added `zip` alongside `dmg` in the mac `target` array so each release publishes both, and updated the GitHub Actions upload glob to include `release/*.zip`. `latest-mac.yml` now lists the ZIP, and the in-app updater can complete the install. Existing 1.2.9 macOS users need to install 1.2.10 manually once; auto-updates resume from there.

### v1.2.9 — Inline File Editor & Search Palette Wiring
- **Edit working-tree files inside GitSlop.** New *Edit this file* button in the working-tree diff breadcrumb swaps the diff for an inline Monaco editor on the same file. Ctrl+S writes through and refreshes the diff. *Back to Diff* returns to the diff view; if you have unsaved edits, the button shows a `•` indicator and the click prompts before discarding.
- **Search palette → graph scroll wired.** `Ctrl+K` → pick a commit now scrolls the graph to that row, selects it, and loads the detail (uses the existing `graph:scroll-to-commit` event the graph already exposed). The previous `// TODO: scroll graph to commit` is gone.
- **Search palette → file opens in editor.** `Ctrl+K` → pick a file now opens it in the inline editor via a new queued `working-tree:enter-edit-mode` request that waits one render for the working-tree state to propagate before triggering. Replaces the second `// TODO` no-op.
- **Monaco bundled-loader fix.** `@monaco-editor/react` was defaulting to a CDN fetch from `unpkg.com`, which stalled forever in Electron's renderer (showed as an infinite Loading screen the first time the editor mounted). Pointed `loader.config({ monaco })` at the locally-bundled `monaco-editor` package and supplied a Vite `?worker`-built editor worker via `MonacoEnvironment.getWorker`, so the editor renders offline.

### v1.2.8 — Multi-Select Staging Actions & Ignore
- **Multi-file stage / unstage / discard from the right-click menu.** Right-clicking a file that's part of a multi-selection now operates on every selected file in the same group (staged, or unstaged + untracked) instead of just the right-clicked one. Labels show a count, e.g. *Stage (3)* / *Discard Changes (3)*. Discard prompts once with a summary that splits modifications-discarded vs untracked-deleted.
- **Right-click → Ignore (matches GitKraken).** New *Ignore* entry on files appends an anchored `/path` to `.gitignore`; *Ignore Folder* on tree-view directories appends `/folder/`. Creates `.gitignore` if it doesn't exist and dedupes against existing trimmed lines.
- **Welcome screen no longer clips with many recent repos.** The flex-centered container used `align-items: center`, which pushed the GitSlop logo above the scroll area when the recent list was long. Switched to `safe center` so it stays centered when content fits and falls back to top-aligned + scrollable when it doesn't.

### v1.2.7 — Diff Viewer, Graph, and Stash Overhaul
- **New/untracked files render in every diff view.** Previously the Diff and Full views were blank for added files and the UI forced File view. The renderer now synthesizes a proper `/dev/null` → `b/<path>` unified diff so every line shows as added in Diff, Full, and File.
- **Working-tree diff auto-refreshes on disk changes.** Edit a file in another editor while its diff is open — the pane updates on its own now, wired through the existing `repo:changed` watcher.
- **Commit graph preserves scroll + selection after a diff.** Opening a diff used to unmount the graph; coming back dropped you to the top. The graph stays mounted (hidden via CSS) so state survives.
- **Commit graph dots stay pixel-synced while scrolling.** The overlay's scroll offset was derived from the visible row index — snapped to row boundaries, so mid-row scrolls desynced dots from rows. Now read directly from the list's `scrollTop`.
- **Double-click a commit body to check it out.** Previously double-click only worked on branch/tag ref labels. Context-menu Checkout also now force-refreshes so the HEAD move actually lands in the UI.
- **Stashes are first-class.**
  - Light-gray rounded square + `STASH@{N}` chip instead of being miscategorized as remote refs.
  - The entire stash stack is visible — `git log --all` only walks `stash@{0}`, so older stashes used to disappear whenever a new one was pushed; now every stash hash is passed as an explicit rev.
  - Synthetic "index on …" / "untracked files on …" parents are filtered out so the graph doesn't show phantom commits.
  - Right-click a stash → Apply / Pop / Drop / Copy menu.
- **Edit the HEAD commit message inline.** Double-click the subject in the detail panel, type, Ctrl+Enter to save. Runs `git commit --amend` with your configured GPG signing, then auto-reselects the amended commit.

### v1.2.6 — Bug-Fix Round
- **No more ligatures.** Disabled programming ligatures globally (and in Monaco) so `<=`, `!=`, `->` stay as typed instead of becoming `≤`, `≠`, `→` — VHDL and other code now reads correctly.
- **Branch toolbar button works.** Was a no-op; now opens the new-branch dialog and is disabled when no repo is open.
- **Branch dialogs grow to fit content.** Long remote URLs (Set Upstream & Push, etc.) no longer overflow the fixed 420px width — dialogs now expand up to 720px / 90vw.
- **WIP row resets after commit.** The `// WIP` placeholder returns once a commit succeeds (instead of keeping the previous subject text).

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
