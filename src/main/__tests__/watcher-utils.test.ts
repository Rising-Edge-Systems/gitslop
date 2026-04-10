import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createWatcherState,
  suppressWatcher,
  gitOperationStarted,
  gitOperationFinished,
  isWatcherSuppressed,
  debouncedSend,
  shouldIgnorePath,
  type WatcherState
} from '../watcher-utils'

// ─── shouldIgnorePath ─────────────────────────────────────────────────────────

describe('shouldIgnorePath', () => {
  it('ignores .git directory contents (unix paths)', () => {
    expect(shouldIgnorePath('/repo/.git/refs/heads/main')).toBe(true)
    expect(shouldIgnorePath('/repo/.git/objects/ab/cd1234')).toBe(true)
    expect(shouldIgnorePath('/repo/.git/index')).toBe(true)
    expect(shouldIgnorePath('/repo/.git/HEAD')).toBe(true)
  })

  it('ignores .git directory contents (windows paths)', () => {
    expect(shouldIgnorePath('C:\\repo\\.git\\refs\\heads\\main')).toBe(true)
    expect(shouldIgnorePath('C:\\repo\\.git\\objects')).toBe(true)
  })

  it('ignores .git directory itself', () => {
    expect(shouldIgnorePath('/repo/.git')).toBe(true)
    expect(shouldIgnorePath('C:\\repo\\.git')).toBe(true)
  })

  it('ignores node_modules', () => {
    expect(shouldIgnorePath('/repo/node_modules/lodash/index.js')).toBe(true)
    expect(shouldIgnorePath('C:\\repo\\node_modules\\lodash')).toBe(true)
  })

  it('does not ignore regular working tree files', () => {
    expect(shouldIgnorePath('/repo/src/main.ts')).toBe(false)
    expect(shouldIgnorePath('/repo/README.md')).toBe(false)
    expect(shouldIgnorePath('/repo/package.json')).toBe(false)
  })

  it('does not ignore files that contain .git in the name but are not .git directory', () => {
    // A file named ".gitignore" in the working tree should NOT be ignored
    expect(shouldIgnorePath('/repo/.gitignore')).toBe(false)
    expect(shouldIgnorePath('/repo/.gitattributes')).toBe(false)
  })

  it('ignores .asar archives and their contents', () => {
    // Electron .asar archives appear as directories to fs but crash readdirp
    // when traversed — chokidar (via ReaddirpStream) throws "invalid package" errors.
    expect(shouldIgnorePath('/repo/dist/app.asar')).toBe(true)
    expect(shouldIgnorePath('/repo/dist/app.asar/package.json')).toBe(true)
    expect(shouldIgnorePath('/repo/out/app.asar.unpacked')).toBe(true)
    expect(shouldIgnorePath('/repo/out/app.asar.unpacked/native.node')).toBe(true)
    expect(shouldIgnorePath('C:\\repo\\dist\\app.asar\\pkg')).toBe(true)
  })
})

// ─── Suppression Logic ────────────────────────────────────────────────────────

describe('WatcherState suppression', () => {
  let state: WatcherState

  beforeEach(() => {
    state = createWatcherState()
  })

  it('starts unsuppressed', () => {
    expect(isWatcherSuppressed(state)).toBe(false)
  })

  it('is suppressed after suppressWatcher is called', () => {
    suppressWatcher(state, 5000)
    expect(isWatcherSuppressed(state)).toBe(true)
  })

  it('suppression expires after the duration', () => {
    // Suppress for 0ms (already expired)
    state.suppressedUntil = Date.now() - 1
    expect(isWatcherSuppressed(state)).toBe(false)
  })

  it('is suppressed during git operations', () => {
    gitOperationStarted(state)
    expect(isWatcherSuppressed(state)).toBe(true)
  })

  it('remains suppressed with multiple concurrent git operations', () => {
    gitOperationStarted(state)
    gitOperationStarted(state)
    gitOperationFinished(state)
    // Still one operation in progress
    expect(isWatcherSuppressed(state)).toBe(true)
  })

  it('adds suppression window after last git operation finishes', () => {
    gitOperationStarted(state)
    gitOperationFinished(state)
    // Should be suppressed for 1 second after the operation
    expect(isWatcherSuppressed(state)).toBe(true)
    expect(state.suppressedUntil).toBeGreaterThan(Date.now())
  })

  it('does not go below 0 active operations', () => {
    gitOperationFinished(state)
    gitOperationFinished(state)
    expect(state.activeGitOperations).toBe(0)
  })
})

// ─── Debounced Send ───────────────────────────────────────────────────────────

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('debouncedSend', () => {
  let state: WatcherState

  beforeEach(() => {
    state = createWatcherState()
  })

  afterEach(() => {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer)
      state.debounceTimer = null
    }
  })

  it('calls callback after debounce period', async () => {
    const callback = vi.fn()
    debouncedSend(state, callback, 50)

    expect(callback).not.toHaveBeenCalled()
    await delay(80)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('returns false and does not schedule when suppressed', () => {
    const callback = vi.fn()
    gitOperationStarted(state)

    const result = debouncedSend(state, callback, 50)
    expect(result).toBe(false)
    // No timer was set at all
    expect(state.debounceTimer).toBeNull()
  })

  it('coalesces rapid events into a single callback', async () => {
    const callback = vi.fn()

    // Fire rapid events with short debounce
    debouncedSend(state, callback, 100)
    await delay(30)
    debouncedSend(state, callback, 100)
    await delay(30)
    debouncedSend(state, callback, 100)

    // Not yet called (debounce not elapsed)
    expect(callback).not.toHaveBeenCalled()

    // Wait for debounce to fire from last event
    await delay(150)
    expect(callback).toHaveBeenCalledOnce()
  })

  it('does not call callback if suppression starts during debounce', async () => {
    const callback = vi.fn()
    debouncedSend(state, callback, 100)

    // Start a git operation during the debounce window
    await delay(30)
    gitOperationStarted(state)

    // Wait for debounce to fire — it should re-check suppression and skip
    await delay(120)
    expect(callback).not.toHaveBeenCalled()
  })
})
