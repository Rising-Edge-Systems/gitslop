/**
 * Integration tests for the file-level undo / apply engine that backs the
 * commit-detail right-click actions. These drive the REAL GitService against
 * REAL temporary git repositories and inspect the resulting working-tree state
 * (the same state the status panel renders), covering the edge paths:
 *   - undo "reverse" of a modify / an added file / a conflicting change
 *   - undo "reset" of a modify / an added file / a root-commit file
 *   - hasLocalChanges + stashPaths (the conflict-dialog primitives)
 *   - multi-path apply (folder apply)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { GitService } from '../git-service'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('undo / apply engine', () => {
  let service: GitService
  let repoDir: string

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoDir }).toString()

  /** Write a file, commit it, and return the new commit's full hash. */
  const commit = (path: string, content: string, message: string): string => {
    writeFileSync(join(repoDir, path), content)
    git('add', '--', path)
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD').trim()
  }

  /** Porcelain status for a single path, e.g. " M", "??", "D " or "" (clean). */
  const status = (path: string): string =>
    execFileSync('git', ['status', '--porcelain', '--', path], { cwd: repoDir })
      .toString()
      .slice(0, 2)

  const read = (path: string): string => readFileSync(join(repoDir, path), 'utf8')
  const exists = (path: string): boolean => existsSync(join(repoDir, path))

  beforeAll(() => {
    service = new GitService()
  })

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitslop-undo-'))
    execFileSync('git', ['init'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir })
    // Keep line endings stable so reverse patches apply by context on Windows.
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoDir })
  })

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  // ─── hasLocalChanges (conflict-dialog trigger) ───────────────────────────

  describe('hasLocalChanges', () => {
    it('is false for a clean tracked file, true once edited', async () => {
      commit('a.txt', 'one\n', 'add a')
      expect(await service.hasLocalChanges(repoDir, ['a.txt'])).toBe(false)
      writeFileSync(join(repoDir, 'a.txt'), 'one\nlocal edit\n')
      expect(await service.hasLocalChanges(repoDir, ['a.txt'])).toBe(true)
    })

    it('is true for an untracked path', async () => {
      commit('a.txt', 'one\n', 'add a')
      writeFileSync(join(repoDir, 'b.txt'), 'untracked\n')
      expect(await service.hasLocalChanges(repoDir, ['b.txt'])).toBe(true)
    })
  })

  // ─── stashPaths (conflict-dialog "Stash" branch) ─────────────────────────

  describe('stashPaths', () => {
    it('stashes only the named path, leaving other edits in place', async () => {
      commit('a.txt', 'A\n', 'add a')
      commit('b.txt', 'B\n', 'add b')
      writeFileSync(join(repoDir, 'a.txt'), 'A edited\n')
      writeFileSync(join(repoDir, 'b.txt'), 'B edited\n')

      await service.stashPaths(repoDir, ['a.txt'], 'stash a only')

      expect(read('a.txt')).toBe('A\n') // a.txt's edit was stashed away
      expect(read('b.txt')).toBe('B edited\n') // b.txt untouched
      expect(git('stash', 'list')).toContain('stash a only')
    })
  })

  // ─── undo: reverse mode ──────────────────────────────────────────────────

  describe('undoFileFromCommit — reverse', () => {
    it('reverses a modification, leaving an UNSTAGED change', async () => {
      commit('f.txt', 'a\nb\nc\n', 'add f')
      const c2 = commit('f.txt', 'a\nB2\nc\n', 'change middle line')

      const res = await service.undoFileFromCommit(repoDir, c2, 'f.txt', 'reverse')

      expect(res.success).toBe(true)
      expect(res.conflicted).toBeFalsy()
      expect(read('f.txt')).toBe('a\nb\nc\n') // middle line restored
      expect(status('f.txt')).toBe(' M') // unstaged modification, not staged
    })

    it('removes a file that the commit ADDED', async () => {
      commit('keep.txt', 'keep\n', 'initial')
      const c2 = commit('added.txt', 'should not be here\n', 'add file by mistake')

      const res = await service.undoFileFromCommit(repoDir, c2, 'added.txt', 'reverse')

      expect(res.success).toBe(true)
      expect(res.deleted).toBe(true)
      expect(exists('added.txt')).toBe(false)
      expect(status('added.txt')).toBe(' D') // unstaged deletion
    })

    it('reports a conflict when a later commit touched the same lines', async () => {
      commit('f.txt', 'a\nb\nc\n', 'add f')
      const c2 = commit('f.txt', 'a\nB2\nc\n', 'commit 2 edits middle')
      commit('f.txt', 'a\nB3\nc\n', 'commit 3 edits middle again')

      const res = await service.undoFileFromCommit(repoDir, c2, 'f.txt', 'reverse')

      expect(res.success).toBe(true)
      expect(res.conflicted).toBe(true)
      expect(read('f.txt')).toContain('<<<<<<<') // conflict markers in working tree
    })
  })

  // ─── undo: reset mode ────────────────────────────────────────────────────

  describe('undoFileFromCommit — reset', () => {
    it('resets the file to its version before the commit (unstaged)', async () => {
      commit('f.txt', 'a\nb\nc\n', 'add f')
      const c2 = commit('f.txt', 'a\nB2\nc\n', 'commit 2')
      commit('f.txt', 'a\nB2\nc\nd\n', 'commit 3 appends a line')

      const res = await service.undoFileFromCommit(repoDir, c2, 'f.txt', 'reset')

      expect(res.success).toBe(true)
      // Reset goes to the PARENT of c2 — i.e. the original, discarding c2 and c3.
      expect(read('f.txt')).toBe('a\nb\nc\n')
      expect(status('f.txt')).toBe(' M')
    })

    it('removes a file that did not exist before the commit', async () => {
      commit('keep.txt', 'keep\n', 'initial')
      const c2 = commit('added.txt', 'new\n', 'add file')

      const res = await service.undoFileFromCommit(repoDir, c2, 'added.txt', 'reset')

      expect(res.success).toBe(true)
      expect(res.deleted).toBe(true)
      expect(exists('added.txt')).toBe(false)
    })

    it('removes a root-commit file (no parent) for both modes', async () => {
      const root = commit('only.txt', 'root\n', 'root commit')

      const resReset = await service.undoFileFromCommit(repoDir, root, 'only.txt', 'reset')
      expect(resReset.success).toBe(true)
      expect(resReset.deleted).toBe(true)
      expect(exists('only.txt')).toBe(false)

      // Restore and try reverse on the root commit too.
      git('checkout', '--', 'only.txt')
      const resReverse = await service.undoFileFromCommit(repoDir, root, 'only.txt', 'reverse')
      expect(resReverse.success).toBe(true)
      expect(resReverse.deleted).toBe(true)
      expect(exists('only.txt')).toBe(false)
    })
  })

  // ─── multi-path apply (folder apply) ─────────────────────────────────────

  describe('applyCommitToWorkingTree — multiple paths', () => {
    it('restores every named path from the commit into the working tree', async () => {
      // Both files exist at v1 in c1, then both move to v2 in a later commit.
      execFileSync('git', ['init'], { cwd: repoDir }) // no-op safety on existing repo
      writeFileSync(join(repoDir, 'README.md'), '#\n')
      git('add', '.')
      git('commit', '-m', 'base')
      writeFileSync(join(repoDir, 'x.txt'), 'x v1\n')
      writeFileSync(join(repoDir, 'y.txt'), 'y v1\n')
      git('add', '.')
      git('commit', '-m', 'add x and y v1')
      const c1 = git('rev-parse', 'HEAD').trim()
      writeFileSync(join(repoDir, 'x.txt'), 'x v2\n')
      writeFileSync(join(repoDir, 'y.txt'), 'y v2\n')
      git('add', '.')
      git('commit', '-m', 'change x and y to v2')

      const res = await service.applyCommitToWorkingTree(repoDir, c1, ['x.txt', 'y.txt'])

      expect(res.success).toBe(true)
      expect(read('x.txt')).toBe('x v1\n')
      expect(read('y.txt')).toBe('y v1\n')
      expect(status('x.txt')).toBe(' M') // unstaged
    })
  })
})
