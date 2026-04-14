# GitSlop Project Status — April 14, 2026

## Current State

**Branch:** `main`
**Version:** 1.2.2
**App status:** Builds, launches, and runs on Windows/Linux/macOS. Typecheck passes, 127 tests pass.

## Recent Work (v1.2.x — April 2026)

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
