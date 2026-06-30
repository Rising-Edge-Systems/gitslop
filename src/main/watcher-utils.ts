/**
 * Pure watcher utility functions — extracted for testability.
 * These manage suppression and debouncing of file watcher events.
 */

export interface WatcherState {
  suppressedUntil: number
  activeGitOperations: number
  debounceTimer: ReturnType<typeof setTimeout> | null
  changedPaths: Set<string>
  broadChange: boolean
}

export function createWatcherState(): WatcherState {
  return {
    suppressedUntil: 0,
    activeGitOperations: 0,
    debounceTimer: null,
    changedPaths: new Set<string>(),
    broadChange: false
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
const IGNORED_DIRS = [
  '.git', 'node_modules',
  // Python
  '.venv', 'venv', '__pycache__', '.tox', '.mypy_cache', '.pytest_cache',
  // Build outputs
  'dist', 'build', 'out', 'target',
  // IDE / tooling
  '.idea', '.vs', '.vscode',
  // Other ecosystems
  '.gradle', '.cargo', 'vendor', '.bundle',
]

const ignoredDirPattern = new RegExp(
  IGNORED_DIRS.map(d => `(?:^|[\\\\/])${d.replace('.', '\\.')}(?:[\\\\/]|$)`).join('|')
)

export function shouldIgnorePath(path: string): boolean {
  if (ignoredDirPattern.test(path)) return true
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

/**
 * Convert an absolute fs path to a repo-relative path with forward slashes.
 * Returns null for the repo root itself or any path outside the repo.
 */
export function toRepoRelativePath(absPath: string, repoPath: string | null): string | null {
  if (!repoPath) return null
  const norm = (s: string): string => s.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = norm(absPath)
  const r = norm(repoPath)
  if (a === r) return null
  if (!a.startsWith(r + '/')) return null
  return a.slice(r.length + 1)
}

/**
 * Record one changed path into the pending set. A missing path, or any path
 * that cannot be relativized into the repo, escalates the window to "broad
 * scope" so subscribers refetch everything.
 */
export function recordChangedPath(state: WatcherState, absPath: string | undefined, repoPath: string | null): void {
  if (!absPath) {
    state.broadChange = true
    return
  }
  const rel = toRepoRelativePath(absPath, repoPath)
  if (rel === null) {
    state.broadChange = true
    return
  }
  state.changedPaths.add(rel)
}

/**
 * Drain the accumulated changes for one IPC send. Returns null when the window
 * was broad-scope (unknown set), else the deduped list of repo-relative paths.
 * Resets state either way.
 */
export function drainChangedPaths(state: WatcherState): string[] | null {
  const result = state.broadChange ? null : [...state.changedPaths]
  state.changedPaths.clear()
  state.broadChange = false
  return result
}
