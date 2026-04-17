# GitSlop

A free, open-source, cross-platform GUI git client built with Electron + React + TypeScript. Visual branch graphs, inline diffs, built-in terminal, and full git operation support — no feature paywalls.

## Features

### Core Git
- Visual branch/commit graph with virtualized scrolling and lane compaction
- Double-click branch/tag labels to checkout with loading overlay
- Multi-commit diff comparison (select 2+ commits to see combined diff)
- Side-by-side and inline diff viewer with syntax highlighting
- Staging area with path and tree views, per-file insertion/deletion stats
- Staging/unstaging with hunk and line-level precision
- Merge, rebase (including interactive), cherry-pick, reset, and revert
- 3-way merge conflict resolution with per-hunk accept buttons and surrounding context
- Auto-stash on pull (opt-out) so a dirty working tree never blocks a pull
- Branch, remote, tag, and stash management
- Git blame view
- Commit history filtering (author, date, message, path)
- GPG commit signing support
- Submodule support

### GitHub & GitLab Integration
- OAuth login for GitHub and GitLab (including self-hosted instances)
- Multi-account support
- View, create, and browse pull requests / merge requests in-app
- Unified Issues sidebar section with auto-detection of GitHub/GitLab
- Auto-refresh OAuth tokens

### Editor & Terminal
- Built-in Monaco code editor
- Toggleable terminal (xterm.js + node-pty)
- File tree browser

### UX
- Multi-tab interface for multiple repos
- Dark and light themes
- Keyboard shortcuts for all actions
- Auto-fetch with incoming change notifications
- Configurable commit history depth
- Resizable, rearrangeable panels
- Cross-platform (Linux, macOS, Windows)

## Prerequisites

- [Node.js](https://nodejs.org/) >= 20
- [Git](https://git-scm.com/) >= 2.20
- npm (comes with Node.js)

## Development

```bash
# Install dependencies
npm install

# Start development server with hot reload
npm run dev

# Type-check the project
npm run typecheck

# Run tests
npm run test
```

## Building

```bash
# Build for all platforms
npm run dist

# Platform-specific builds
npm run dist:win     # Windows (.exe, .msi)
npm run dist:linux   # Linux (.deb, .AppImage)
npm run dist:mac     # macOS (.dmg)

# Package without installer (for testing)
npm run pack
```

Build output is placed in the `release/` directory.

## Project Structure

```
gitslop/
  .github/workflows/   # CI/CD pipeline
  docs/                 # Roadmap, status, architecture notes
  resources/            # App icons and branding
  src/
    main/               # Electron main process (git service, IPC, file watcher)
    preload/            # Preload scripts (IPC bridge)
    renderer/           # React UI (components, hooks, styles)
  out/                  # Compiled output (electron-vite)
  release/              # Packaged distributables (electron-builder)
```

## CI/CD

GitHub Actions workflow (`.github/workflows/build.yml`):
- **On push/PR to main**: Runs typecheck and tests, builds for all platforms
- **On version tags (`v*`)**: Creates a GitHub Release with platform artifacts

The app uses `electron-updater` to check for updates from GitHub Releases.

### Releasing

Use annotated tags to include release notes in the GitHub Release:

```bash
git tag -a v1.3.0 -m "## What's New

- Feature one
- Feature two

### Bug Fixes
- Fixed something"

git push origin v1.3.0
```

The CI/CD pipeline extracts the annotated tag message and uses it as the release body. Lightweight tags (without `-a`) fall back to auto-generated notes from commit history.

## License

MIT
