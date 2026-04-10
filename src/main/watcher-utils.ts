/**
 * Pure watcher utility functions — extracted for testability.
 * These manage suppression and debouncing of file watcher events.
 */

export interface WatcherState {
  suppressedUntil: number
  activeGitOperations: number
  debounceTimer: ReturnType<typeof setTimeout> | null
}

export function createWatcherState(): WatcherState {
  return {
    suppressedUntil: 0,
    activeGitOperations: 0,
    debounceTimer: null
  }
}

/**
 * Suppress watcher events for a duration (ms) after git operations complete.
 * While suppressed, file change events are silently dropped.
 */
export function suppressWatcher(state: WatcherState, durationMs = 1000): void {
  state.suppressedUntil = Date.now() + durationMs
}

/**
 * Track start of a git operation. While any operation is in progress,
 * watcher events are suppressed.
 */
export function gitOperationStarted(state: WatcherState): void {
  state.activeGitOperations++
}

/**
 * Track end of a git operation. After the last operation completes,
 * events remain suppressed for 1 additional second.
 */
export function gitOperationFinished(state: WatcherState): void {
  state.activeGitOperations = Math.max(0, state.activeGitOperations - 1)
  if (state.activeGitOperations === 0) {
    suppressWatcher(state, 1000)
  }
}

/**
 * Check whether the watcher is currently suppressed (git operation in progress
 * or within the post-operation suppression window).
 */
export function isWatcherSuppressed(state: WatcherState): boolean {
  return state.activeGitOperations > 0 || Date.now() < state.suppressedUntil
}

/**
 * Debounced send: calls the callback after debounceMs unless suppressed or
 * another event arrives. Returns true if the event was scheduled, false if suppressed.
 */
export function debouncedSend(
  state: WatcherState,
  callback: () => void,
  debounceMs = 500
): boolean {
  if (isWatcherSuppressed(state)) {
    return false
  }

  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
  }
  state.debounceTimer = setTimeout(() => {
    if (!isWatcherSuppressed(state)) {
      callback()
    }
  }, debounceMs)
  return true
}

/**
 * Check if a file path should be ignored by the watcher.
 * Ignores .git/ directory contents and node_modules/.
 */
export function shouldIgnorePath(path: string): boolean {
  if (path.includes('/.git/') || path.includes('\\.git\\')) {
    return true
  }
  if (path.endsWith('/.git') || path.endsWith('\\.git')) {
    return true
  }
  if (path.includes('/node_modules/') || path.includes('\\node_modules\\')) {
    return true
  }
  // Electron .asar archives appear as directories to fs but crash readdirp
  // when traversed. Ignore them and their unpacked siblings entirely.
  if (
    path.endsWith('.asar') ||
    path.endsWith('.asar.unpacked') ||
    path.includes('.asar/') ||
    path.includes('.asar\\') ||
    path.includes('.asar.unpacked/') ||
    path.includes('.asar.unpacked\\')
  ) {
    return true
  }
  return false
}
