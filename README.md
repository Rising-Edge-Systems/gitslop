# GitSlop

A free, open-source, cross-platform GUI git client built with Electron + React + TypeScript. Rivals GitKraken with visual branch graphs, inline diffs, built-in editor, toggleable CLI, and full git operation support.

## Features

- Visual branch/commit graph with virtualised scrolling
- Side-by-side and inline diff viewer with syntax highlighting
- Built-in Monaco code editor
- Toggleable terminal (xterm.js)
- Branch, remote, tag, and stash management
- Staging/unstaging with hunk and line-level precision
- Merge, rebase, cherry-pick, reset, and revert
- 3-way merge conflict resolution tool
- Git blame view
- Global search (commits, files, branches)
- Commit history filtering
- File tree browser
- Dark and light themes
- Keyboard shortcuts for all actions
- GPG commit signing support
- Submodule support
- Auto-fetch and file watching
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

### Build for all platforms

```bash
npm run dist
```

### Build for specific platform

```bash
# Linux (.deb, .AppImage)
npm run dist:linux

# macOS (.dmg)
npm run dist:mac

# Windows (.exe installer, .msi)
npm run dist:win
```

### Package without installer (for testing)

```bash
npm run pack
```

Build output is placed in the `release/` directory.

## Icon Generation

The app icon source is `resources/icon.svg`. To generate platform-specific icons:

```bash
npm run generate-icons
```

This requires one of: `rsvg-convert`, `inkscape`, or ImageMagick `convert`. On CI, electron-builder handles icon conversion automatically.

## CI/CD

The project includes a GitHub Actions workflow (`.github/workflows/build.yml`) that:

1. **On every push/PR to main**: Runs typecheck and tests
2. **On every push/PR to main**: Builds distributables for Linux, macOS, and Windows
3. **On version tags (`v*`)**: Creates a GitHub Release with all platform artifacts

### Creating a Release

```bash
# Tag a new version
git tag v1.0.0
git push origin v1.0.0
```

The CI pipeline will automatically build and publish artifacts to a GitHub Release.

### Auto-Updates

The app uses `electron-updater` to check for updates from GitHub Releases. When a new release is published, users are notified and can install the update automatically.

## Code Signing

Code signing is configured as a placeholder in the electron-builder config:

- **macOS**: Set the `CSC_LINK` and `CSC_KEY_PASSWORD` environment variables (or secrets in CI) with your Apple Developer certificate.
- **Windows**: Set `CSC_LINK` and `CSC_KEY_PASSWORD` with your code signing certificate.
- **Linux**: Code signing is not typically required for Linux distributions.

See the [electron-builder code signing docs](https://www.electron.build/code-signing) for full details.

## Project Structure

```
gitslop/
  .github/workflows/   # CI/CD pipeline
  build/                # Build resources (entitlements, etc.)
  resources/            # App icons and branding
  scripts/              # Utility scripts
  src/
    main/               # Electron main process
    preload/            # Preload scripts (IPC bridge)
    renderer/           # React UI (components, hooks, styles)
  out/                  # Compiled output (electron-vite)
  release/              # Packaged distributables (electron-builder)
```

## License

MIT
