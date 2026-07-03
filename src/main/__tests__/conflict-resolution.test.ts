/**
 * Integration tests for the conflict-resolution backend that powers the
 * ConflictResolver screen. These drive the REAL GitService against REAL
 * temporary git repositories, covering the paths the UI depends on:
 *   - mergeContinue() concludes a conflicted merge with the prepared MERGE_MSG
 *     (regression: the old code ran `git commit -m ""`, which git always aborts)
 *   - getConflictSides() reports which side is the user's own work, correctly
 *     inverted for rebase (regression: rebase mislabeled ours/theirs and
 *     "Accept ours" silently discarded the user's commit)
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { GitService } from '../git-service'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('conflict resolution backend', () => {
  let service: GitService
  let repoDir: string

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoDir }).toString()

  /** Run a git command that is expected to fail (e.g. a conflicting merge). */
  const gitAllowFail = (...args: string[]): void => {
    try {
      execFileSync('git', args, { cwd: repoDir })
    } catch {
      /* expected conflict exit */
    }
  }

  const write = (path: string, content: string): void =>
    writeFileSync(join(repoDir, path), content)

  const commit = (path: string, content: string, message: string): string => {
    write(path, content)
    git('add', '--', path)
    git('commit', '-m', message)
    return git('rev-parse', 'HEAD').trim()
  }

  beforeAll(() => {
    service = new GitService()
  })

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitslop-conflict-'))
    execFileSync('git', ['init'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir })
    execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: repoDir })
    // Deterministic default branch name regardless of the host git config.
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: repoDir })
  })

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true })
  })

  /** Build a two-branch content conflict; returns the feature branch name. */
  const makeConflict = (): void => {
    commit('f.txt', 'base\n', 'base')
    git('checkout', '-b', 'feature')
    commit('f.txt', 'feature change\n', 'feature edit')
    git('checkout', 'main')
    commit('f.txt', 'main change\n', 'main edit')
  }

  // ─── mergeContinue ─────────────────────────────────────────────────────────

  describe('mergeContinue', () => {
    it('concludes a conflicted merge with a real two-parent merge commit', async () => {
      makeConflict()
      gitAllowFail('merge', 'feature')
      expect(existsSync(join(repoDir, '.git', 'MERGE_HEAD'))).toBe(true)

      // Resolve + stage (what the UI does on "Mark as Resolved").
      write('f.txt', 'resolved\n')
      git('add', '--', 'f.txt')

      const result = await service.mergeContinue(repoDir)
      expect(result.success).toBe(true)

      // A merge commit has two parents.
      const parents = git('log', '-1', '--format=%P').trim().split(/\s+/)
      expect(parents).toHaveLength(2)
      // The prepared MERGE_MSG subject is preserved (not blank).
      expect(git('log', '-1', '--format=%s').trim()).toMatch(/Merge branch 'feature'/)
      // Merge state is cleared.
      expect(existsSync(join(repoDir, '.git', 'MERGE_HEAD'))).toBe(false)
    })

    it('does not leave conflict-comment lines in the commit body', async () => {
      makeConflict()
      gitAllowFail('merge', 'feature')
      write('f.txt', 'resolved\n')
      git('add', '--', 'f.txt')

      await service.mergeContinue(repoDir)
      const body = git('log', '-1', '--format=%B')
      expect(body).not.toMatch(/^#/m) // no "# Conflicts:" comment lines
    })
  })

  // ─── getConflictSides ──────────────────────────────────────────────────────

  describe('getConflictSides', () => {
    it('for a merge, ours = current branch and theirs = merged branch', async () => {
      makeConflict()
      gitAllowFail('merge', 'feature')

      const sides = await service.getConflictSides(repoDir)
      expect(sides.operation).toBe('merge')
      expect(sides.yours).toBe('ours')
      expect(sides.ours.ref).toBe('main')
      expect(sides.theirs.ref).toContain('feature')
    })

    it('for a rebase, the sides invert: the user\'s work is "theirs"', async () => {
      makeConflict()
      git('checkout', 'feature')
      gitAllowFail('rebase', 'main')
      // Sanity: git really did put main on the ours (stage 2) side.
      expect(git('show', ':2:f.txt').trim()).toBe('main change')
      expect(git('show', ':3:f.txt').trim()).toBe('feature change')

      const sides = await service.getConflictSides(repoDir)
      expect(sides.operation).toBe('rebase')
      // The user's own commit (feature) is on the "theirs" side during a rebase.
      expect(sides.yours).toBe('theirs')
      expect(sides.theirs.ref).toContain('feature')
      expect(sides.ours.ref).toContain('main')
    })

    it('returns generic-but-safe defaults when no operation is active', async () => {
      commit('f.txt', 'x\n', 'init')
      const sides = await service.getConflictSides(repoDir)
      expect(sides.operation).toBeNull()
      expect(sides.yours).toBe('ours')
    })
  })
})
