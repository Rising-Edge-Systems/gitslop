# PRD: In-App Updates

## Introduction

Add user-facing update notifications and a one-click update flow to GitSlop. The `electron-updater` dependency and GitHub Releases publish pipeline already exist, but users currently have no way to know when updates are available or install them from within the app. This feature adds a status bar indicator, an update dialog with release notes and download progress, and a settings toggle — matching the update experience in VS Code, GitKraken, and other modern Electron apps.

## Goals

- Notify users when a new version is available without interrupting their workflow
- Allow one-click download and install from within the app
- Show release notes so users know what changed
- Make auto-check configurable (on/off) in settings
- Non-blocking — update checks and downloads happen in the background

## User Stories

### US-AU-001: Main process update event handling
**Description:** As a developer, I need the main process to check for updates via electron-updater and expose update state to the renderer via IPC, so that UI components can display update information.

**Acceptance Criteria:**
- [ ] Main process uses `autoUpdater` from `electron-updater` to check for updates
- [ ] `autoUpdater.autoDownload` is set to `false` (user must opt in to download)
- [ ] `autoUpdater.autoInstallOnAppQuit` is set to `true`
- [ ] IPC handler `updates:checkForUpdates` triggers a manual check and returns `{ available: boolean, version?: string, releaseNotes?: string }`
- [ ] IPC handler `updates:downloadUpdate` starts the download and returns immediately
- [ ] IPC handler `updates:installUpdate` calls `autoUpdater.quitAndInstall()`
- [ ] Main process forwards `autoUpdater` events to the renderer via `webContents.send`: `update:available` (with version + releaseNotes), `update:download-progress` (with percent, bytesPerSecond, transferred, total), `update:downloaded` (ready to install), `update:error` (with error message)
- [ ] Auto-check runs 10 seconds after app launch (non-blocking), only if the setting is enabled
- [ ] Reads the `autoCheckUpdates` setting from electron-store (default `true`)
- [ ] Typecheck passes, existing tests pass

### US-AU-002: Preload and renderer type definitions
**Description:** As a developer, I need IPC bridge functions and event listeners in the preload script so the renderer can interact with the update system.

**Acceptance Criteria:**
- [ ] Preload exposes `window.electronAPI.updates.checkForUpdates()` returning a Promise
- [ ] Preload exposes `window.electronAPI.updates.downloadUpdate()` returning a Promise
- [ ] Preload exposes `window.electronAPI.updates.installUpdate()` returning a Promise
- [ ] Preload exposes `window.electronAPI.updates.onUpdateAvailable(callback)` returning a cleanup function
- [ ] Preload exposes `window.electronAPI.updates.onDownloadProgress(callback)` returning a cleanup function
- [ ] Preload exposes `window.electronAPI.updates.onUpdateDownloaded(callback)` returning a cleanup function
- [ ] Preload exposes `window.electronAPI.updates.onUpdateError(callback)` returning a cleanup function
- [ ] Type definitions added to `useLayoutState.ts` window.electronAPI block
- [ ] Typecheck passes

### US-AU-003: Status bar update indicator
**Description:** As a user, I want to see a subtle indicator in the status bar when an update is available, so that I know there's a new version without being interrupted.

**Acceptance Criteria:**
- [ ] StatusBar component listens for `update:available` events
- [ ] When an update is available, a clickable badge appears in the status bar showing the new version (e.g. "v1.2.0 available") with an upload/download icon
- [ ] The badge is styled subtly (not alarming) — uses accent color, small font, fits the status bar aesthetic
- [ ] Clicking the badge dispatches a custom event `updates:show-dialog` that AppLayout listens to
- [ ] The badge disappears after the update is downloaded and installed (or dismissed)
- [ ] If no update is available, nothing shows (no "up to date" message in the status bar)
- [ ] Typecheck passes

### US-AU-004: Update dialog
**Description:** As a user, I want to see what changed in the new version and download it with one click, so that I can decide whether to update now.

**Acceptance Criteria:**
- [ ] AppLayout renders an UpdateDialog component when `updates:show-dialog` event fires
- [ ] The dialog shows: current version (from package.json or `app.getVersion()`), new version number, release notes rendered as markdown (use a simple pre-formatted block or basic HTML rendering), "Download & Install" button, and "Remind Me Later" button
- [ ] Clicking "Download & Install" calls `updates.downloadUpdate()`, shows a progress bar with percentage and download speed, and changes the button to "Restart to Update" when download completes
- [ ] Clicking "Restart to Update" calls `updates.installUpdate()` which quits and installs
- [ ] Clicking "Remind Me Later" closes the dialog (the status bar badge remains)
- [ ] If a download error occurs, show the error message inline with a "Retry" button
- [ ] The dialog has a close button (X) in the corner that behaves like "Remind Me Later"
- [ ] The dialog is a modal overlay (similar to existing dialogs in the app)
- [ ] Typecheck passes

### US-AU-005: Settings toggle for auto-check
**Description:** As a user, I want to enable or disable automatic update checks in Settings, so that I have control over when the app contacts the update server.

**Acceptance Criteria:**
- [ ] Add `autoCheckUpdates: boolean` to the app settings (default `true`) in `useSettings.ts`
- [ ] Add a "Check for updates automatically" toggle in the Settings panel under a "General" section (or at the top of the existing settings)
- [ ] Add a "Check Now" button next to the toggle that manually triggers an update check and shows a brief "Checking..." / "Up to date" / "Update available" result inline
- [ ] The setting is persisted to localStorage (via existing useSettings) AND communicated to the main process via IPC so it respects the setting on next launch
- [ ] Store the setting in electron-store as well so the main process can read it on startup without waiting for the renderer
- [ ] Typecheck passes

## Functional Requirements

- FR-1: Auto-check for updates 10 seconds after app launch when `autoCheckUpdates` is enabled
- FR-2: Display a status bar badge when an update is available, showing the version number
- FR-3: Show an update dialog with release notes, download progress, and install button
- FR-4: Download updates in the background without blocking the UI
- FR-5: Offer "Restart to Update" after download completes
- FR-6: Allow users to dismiss ("Remind Me Later") — badge stays, dialog closes
- FR-7: Add settings toggle for auto-check with a manual "Check Now" button
- FR-8: `autoUpdater.autoDownload = false` — never download without user consent

## Non-Goals

- No update channel selection (stable vs. beta)
- No delta/differential updates (electron-updater handles this automatically if available)
- No silent background install (always requires user-initiated restart)
- No changelog history (only shows notes for the latest available version)
- No rollback functionality

## Technical Considerations

- `electron-updater`'s `autoUpdater` emits events: `checking-for-update`, `update-available`, `update-not-available`, `download-progress`, `update-downloaded`, `error`
- Release notes come from the GitHub Release body — `autoUpdater` provides them in the `update-available` event as `releaseNotes` (string or array)
- `autoUpdater.checkForUpdates()` returns a Promise with update info
- In dev mode (`!app.isPackaged`), skip update checks to avoid errors — electron-updater only works with packaged apps
- The `autoCheckUpdates` setting needs to be in BOTH localStorage (renderer reads) and electron-store (main process reads on startup before renderer loads)
- Current app version is available via `app.getVersion()` in main process or from package.json in renderer

## Success Metrics

- Users see update availability within 15 seconds of app launch
- Update from notification to installed in under 3 clicks
- No app freezes or blocking during update check/download
- Setting persists correctly across app restarts

## Open Questions

- None — standard Electron auto-update pattern, well-documented by electron-updater
