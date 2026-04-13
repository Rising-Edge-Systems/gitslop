# GitSlop Project Status — April 13, 2026

## Current State

**Active branch:** `fix/repo-loading-performance` (off `main`)
**Version:** 1.0.1
**App status:** Builds, launches, and runs on Windows/Linux/macOS. Typecheck passes, 127 tests pass.

## Recent Work (April 2026)

### Repo Loading Performance Fix
Resolved a critical freeze when opening repos with large gitignored directories (e.g. FPGA build outputs, Python `.venv`). Root causes:
- **Chokidar file watcher** scanned the entire working tree including hundreds of thousands of gitignored files. Now uses `git ls-files` to watch only tracked directories.
- **Serial command queue** blocked local operations behind slow network fetches. Replaced with request deduplication — identical concurrent git commands share one subprocess.
- **Tooltip crash** caused infinite error storm from accessing `event.currentTarget` in a `setTimeout` after React nulled it.
- **Loading overlay** could get stuck permanently if CommitGraph didn't mount. Added 15s safety-valve timeout.
- **HEAD auto-select** — commit graph now auto-selects the HEAD commit on initial load.

### GitHub & GitLab Integration Fix
- All GitHub API handlers were checking the legacy `githubToken` field while new logins use `githubAccounts[]`. Fixed with unified `getGitHubToken()` helper.
- GitLab `parseRemote` only checked the first account's instance URL. Now iterates all accounts, enabling custom instances (e.g. `git.intrepidcs.net`).
- GitLab MR state filter sent `'open'` instead of `'opened'` (the API-expected value).

### GitLab OAuth (April 2026)
- Full OAuth 2.0 PKCE flow for GitLab login (browser-based)
- Multi-account support with per-instance tokens
- Auto-refresh for OAuth tokens
- Settings UI with OAuth tab in Add GitLab Account form

### Earlier (March-April 2026)
- Graph refresh and scaling features (commit pagination, lane compaction, configurable history depth)
- GitHub OAuth device flow login
- Staging diff view overhaul with line/hunk staging in center panel
- Working-tree file diffs routed to center viewer
- CI/CD pipeline, auto-update infrastructure, v1.0.0 and v1.0.1 releases

## Architecture

```
┌─ TitleBar (36px, frameless) ─────────────────────────────────┐
├─ TabBar (32px) — always visible, "+" to add repos ──────────┤
├─ Toolbar (40px) — context-aware buttons ─────────────────────┤
├──────────────────────────────────────────────────────────────┤
│ Sidebar    │ Center Panel          │ Right Panel (340px)     │
│ (260px)    │                       │                         │
│ CSS flex   │ Commit Graph          │ Detail Panel (top)      │
│ div with   │ (full height)         │  - commit info          │
│ drag       │                       │  - changed files        │
│ handle     │ OR                    │                         │
│            │                       │ Staging Area (bottom)   │
│ Branches   │ Diff Viewer           │  - unstaged files       │
│ Files      │ (when file selected)  │  - staged files         │
│ Remotes    │                       │  - commit form          │
│ Tags       │ OR                    │                         │
│ Stashes    │                       │                         │
│ PRs / MRs  │ Working Tree Diff     │                         │
├──────────────────────────────────────────────────────────────┤
│ Terminal Panel (toggleable, xterm.js + node-pty)             │
├──────────────────────────────────────────────────────────────┤
│ StatusBar (24px) — branch, fetch status, ahead/behind        │
└──────────────────────────────────────────────────────────────┘
```

**Key patterns:**
- Sidebar and detail panel use plain CSS flex divs (not react-resizable-panels)
- Layout state persisted to localStorage via `useLayoutState()` hook
- Per-tab state (selected commit, sidebar collapsed) via `useRepoTabs()` hook
- Git command deduplication in main process via `DedupedExecutor`
- File watcher scopes to tracked directories only (via `git ls-files`)
- Network operations (fetch, push) bypass the command dedup

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
