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
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs'
import { join, dirname } from 'path'
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

  // ─── getConflictContent classification ─────────────────────────────────────

  describe('getConflictContent conflict typing', () => {
    it('classifies a both-modified text conflict as "content" with a diff3 base', async () => {
      makeConflict()
      gitAllowFail('merge', 'feature')

      const c = await service.getConflictContent(repoDir, 'f.txt')
      expect(c.conflictType).toBe('content')
      // A diff3 render is produced regardless of the user's merge.conflictStyle,
      // so the UI always has base sections for colouring.
      expect(c.merged3).toBeTruthy()
      expect(c.merged3).toContain('|||||||')
      expect(c.merged3).toContain('base')
    })

    it('classifies ours-modified / theirs-deleted as "modify-delete"', async () => {
      commit('f.txt', 'base\n', 'base')
      git('checkout', '-b', 'feature')
      git('rm', 'f.txt')
      git('commit', '-m', 'delete on feature')
      git('checkout', 'main')
      commit('f.txt', 'main change\n', 'modify on main')
      gitAllowFail('merge', 'feature')

      const c = await service.getConflictContent(repoDir, 'f.txt')
      expect(c.conflictType).toBe('modify-delete')
      expect(c.merged3).toBeNull() // no textual merge to render
    })

    it('classifies ours-deleted / theirs-modified as "delete-modify"', async () => {
      commit('f.txt', 'base\n', 'base')
      git('checkout', '-b', 'feature')
      commit('f.txt', 'feature change\n', 'modify on feature')
      git('checkout', 'main')
      git('rm', 'f.txt')
      git('commit', '-m', 'delete on main')
      gitAllowFail('merge', 'feature')

      const c = await service.getConflictContent(repoDir, 'f.txt')
      expect(c.conflictType).toBe('delete-modify')
    })

    it('classifies a both-modified binary file as "binary"', async () => {
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 1, 2, 3, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'base bin')
      git('checkout', '-b', 'feature')
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 9, 9, 9, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'feature bin')
      git('checkout', 'main')
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 5, 5, 5, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'main bin')
      gitAllowFail('merge', 'feature')

      const c = await service.getConflictContent(repoDir, 'b.bin')
      expect(c.conflictType).toBe('binary')
    })
  })

  // ─── resolveConflictChoice (tree-level resolutions) ────────────────────────

  describe('resolveConflictChoice', () => {
    /** ours modifies f.txt, theirs deletes it. */
    const makeModifyDelete = (): void => {
      commit('f.txt', 'base\n', 'base')
      git('checkout', '-b', 'feature')
      git('rm', 'f.txt')
      git('commit', '-m', 'delete on feature')
      git('checkout', 'main')
      commit('f.txt', 'main change\n', 'modify on main')
      gitAllowFail('merge', 'feature')
    }

    it('keep stages the surviving file and clears the conflict', async () => {
      makeModifyDelete()
      await service.resolveConflictChoice(repoDir, 'f.txt', 'keep')

      expect(existsSync(join(repoDir, 'f.txt'))).toBe(true)
      expect(readFileSync(join(repoDir, 'f.txt'), 'utf-8')).toBe('main change\n')
      expect(await service.getConflictedFiles(repoDir)).not.toContain('f.txt')
    })

    it('delete removes the file and clears the conflict', async () => {
      makeModifyDelete()
      await service.resolveConflictChoice(repoDir, 'f.txt', 'delete')

      expect(existsSync(join(repoDir, 'f.txt'))).toBe(false)
      expect(await service.getConflictedFiles(repoDir)).toHaveLength(0)
    })

    it('ours / theirs take that whole side for a binary conflict', async () => {
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 1, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'base bin')
      git('checkout', '-b', 'feature')
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 9, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'feature bin')
      git('checkout', 'main')
      writeFileSync(join(repoDir, 'b.bin'), Buffer.from([0, 5, 0]))
      git('add', 'b.bin'); git('commit', '-m', 'main bin')
      gitAllowFail('merge', 'feature')

      await service.resolveConflictChoice(repoDir, 'b.bin', 'theirs')
      expect(await service.getConflictedFiles(repoDir)).toHaveLength(0)
      // theirs = the merged-in feature branch bytes.
      expect(Array.from(readFileSync(join(repoDir, 'b.bin')))).toEqual([0, 9, 0])
    })
  })

  // ─── Conflicts on gitignored paths (e.g. nbproject/) ───────────────────────

  describe('gitignored conflict paths', () => {
    const nb = 'proj.X/nbproject/config.xml'
    const writeNb = (content: string): void => {
      const abs = join(repoDir, nb)
      mkdirSync(dirname(abs), { recursive: true })
      writeFileSync(abs, content)
    }

    // A file tracked from the start, then one branch adds it to .gitignore while
    // both branches edit it → content conflict on an ignored, tracked path.
    const makeIgnoredConflict = (): void => {
      writeNb('base\n')
      git('add', '-A'); git('commit', '-m', 'base')
      git('checkout', '-b', 'feature')
      writeNb('feature\n'); git('commit', '-aqm', 'feature edit')
      git('checkout', 'main')
      writeFileSync(join(repoDir, '.gitignore'), 'nbproject/\n')
      writeNb('main\n'); git('add', '-A'); git('commit', '-m', 'ignore + edit')
      gitAllowFail('merge', 'feature')
    }

    it('resolveConflictFile stages a resolved ignored path (plain add would refuse)', async () => {
      makeIgnoredConflict()
      expect(await service.getConflictedFiles(repoDir)).toContain(nb)

      await service.resolveConflictFile(repoDir, nb, 'resolved\n')

      expect(await service.getConflictedFiles(repoDir)).toHaveLength(0)
      expect(git('show', `:${nb}`)).toBe('resolved\n') // staged content
    })

    it('resolveConflictChoice keep works on an ignored path', async () => {
      makeIgnoredConflict()
      await service.resolveConflictChoice(repoDir, nb, 'keep')
      expect(await service.getConflictedFiles(repoDir)).toHaveLength(0)
    })
  })
})
