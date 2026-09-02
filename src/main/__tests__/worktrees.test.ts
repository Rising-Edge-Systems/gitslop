import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { GitService } from '../git-service'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, realpathSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

/** Case-insensitive on Windows, symlink-resolved comparison of two paths. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string): string => {
    let r = p
    try {
      r = realpathSync(p)
    } catch {
      // path may not exist anymore (removed worktree) — compare as-is
    }
    return process.platform === 'win32' ? r.toLowerCase() : r
  }
  return norm(a) === norm(b)
}

describe('GitService worktrees', () => {
  let service: GitService
  let repoDir: string
  let wtBase: string
  let defaultBranch: string

  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: repoDir }).toString()

  beforeAll(() => {
    service = new GitService()
  })

  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), 'gitslop-wt-repo-'))
    wtBase = mkdtempSync(join(tmpdir(), 'gitslop-wt-tree-'))
    execFileSync('git', ['init'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir })
    execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir })
    writeFileSync(join(repoDir, 'README.md'), '# Test')
    execFileSync('git', ['add', '.'], { cwd: repoDir })
    execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir })
    defaultBranch = git('branch', '--show-current').trim()
  })

  afterEach(() => {
    rmSync(wtBase, { recursive: true, force: true })
    rmSync(repoDir, { recursive: true, force: true })
  })

  describe('getWorktrees', () => {
    it('returns the main worktree for a plain repo', async () => {
      const worktrees = await service.getWorktrees(repoDir)
      expect(worktrees.length).toBe(1)
      expect(worktrees[0].isMain).toBe(true)
      expect(worktrees[0].branch).toBe(defaultBranch)
      expect(worktrees[0].locked).toBe(false)
      expect(samePath(worktrees[0].path, repoDir)).toBe(true)
      expect(worktrees[0].head).toMatch(/^[0-9a-f]{40}$/)
    })

    it('lists linked worktrees with their branches', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')
      git('worktree', 'add', wtPath, 'feature')

      const worktrees = await service.getWorktrees(repoDir)
      expect(worktrees.length).toBe(2)
      const linked = worktrees.find((w) => !w.isMain)!
      expect(linked.branch).toBe('feature')
      expect(samePath(linked.path, wtPath)).toBe(true)
    })

    it('reports a detached worktree with null branch', async () => {
      const wtPath = join(wtBase, 'detached')
      git('worktree', 'add', '--detach', wtPath)

      const worktrees = await service.getWorktrees(repoDir)
      const linked = worktrees.find((w) => !w.isMain)!
      expect(linked.branch).toBeNull()
    })

    it('reports lock state and reason', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')
      git('worktree', 'add', wtPath, 'feature')
      git('worktree', 'lock', '--reason', 'keep out', wtPath)

      const worktrees = await service.getWorktrees(repoDir)
      const linked = worktrees.find((w) => !w.isMain)!
      expect(linked.locked).toBe(true)
      expect(linked.lockReason).toBe('keep out')
    })

    it('returns empty array for a non-repo directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-wt-norepo-'))
      try {
        expect(await service.getWorktrees(dir)).toEqual([])
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('addWorktree', () => {
    it('creates a worktree for an existing branch', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')

      await service.addWorktree(repoDir, wtPath, { branch: 'feature' })

      expect(existsSync(join(wtPath, 'README.md'))).toBe(true)
      const worktrees = await service.getWorktrees(repoDir)
      expect(worktrees.length).toBe(2)
      expect(worktrees.find((w) => !w.isMain)!.branch).toBe('feature')
    })

    it('creates a worktree on a new branch from a base ref', async () => {
      const wtPath = join(wtBase, 'wip')

      await service.addWorktree(repoDir, wtPath, { newBranch: 'wip', baseRef: defaultBranch })

      const worktrees = await service.getWorktrees(repoDir)
      expect(worktrees.find((w) => !w.isMain)!.branch).toBe('wip')
      expect(git('branch', '--list', 'wip').trim()).not.toBe('')
    })

    it('rejects when the branch is already checked out elsewhere', async () => {
      const wtPath = join(wtBase, 'dup')
      await expect(
        service.addWorktree(repoDir, wtPath, { branch: defaultBranch })
      ).rejects.toThrow(/already checked out|already used by worktree/i)
    })
  })

  describe('removeWorktree', () => {
    it('removes a clean worktree', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')
      git('worktree', 'add', wtPath, 'feature')

      await service.removeWorktree(repoDir, wtPath)

      expect((await service.getWorktrees(repoDir)).length).toBe(1)
      expect(existsSync(wtPath)).toBe(false)
    })

    it('refuses a dirty worktree without force, removes it with force', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')
      git('worktree', 'add', wtPath, 'feature')
      writeFileSync(join(wtPath, 'dirty.txt'), 'uncommitted')

      await expect(service.removeWorktree(repoDir, wtPath)).rejects.toThrow(
        /contains modified or untracked|use --force/i
      )

      await service.removeWorktree(repoDir, wtPath, { force: true })
      expect((await service.getWorktrees(repoDir)).length).toBe(1)
    })
  })

  describe('lockWorktree / unlockWorktree', () => {
    it('locks with a reason and unlocks', async () => {
      git('branch', 'feature')
      const wtPath = join(wtBase, 'feature')
      git('worktree', 'add', wtPath, 'feature')

      await service.lockWorktree(repoDir, wtPath, 'agent session')
      let linked = (await service.getWorktrees(repoDir)).find((w) => !w.isMain)!
      expect(linked.locked).toBe(true)
      expect(linked.lockReason).toBe('agent session')

      await service.unlockWorktree(repoDir, wtPath)
      linked = (await service.getWorktrees(repoDir)).find((w) => !w.isMain)!
      expect(linked.locked).toBe(false)
      expect(linked.lockReason).toBe('')
    })
  })
})
