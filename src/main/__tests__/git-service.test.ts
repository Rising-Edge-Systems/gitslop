import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { GitService, GitErrorCode } from '../git-service'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('GitService', () => {
  let service: GitService

  beforeAll(() => {
    service = new GitService()
  })

  // ─── Version Detection ─────────────────────────────────────────────────

  describe('getVersion', () => {
    it('should detect git version', async () => {
      const version = await service.getVersion()
      expect(version.major).toBeGreaterThanOrEqual(2)
      expect(version.raw).toContain('git version')
      expect(typeof version.supported).toBe('boolean')
    })

    it('should cache the version', async () => {
      const v1 = await service.getVersion()
      const v2 = await service.getVersion()
      expect(v1).toBe(v2) // Same reference = cached
    })
  })

  // ─── Repository Operations ─────────────────────────────────────────────

  describe('isRepo', () => {
    it('should return true for a git repo', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      try {
        execFileSync('git', ['init'], { cwd: dir })
        expect(await service.isRepo(dir)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('should return false for a non-repo directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      try {
        expect(await service.isRepo(dir)).toBe(false)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe('init', () => {
    it('should initialize a new repo', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      try {
        await service.init(dir)
        expect(await service.isRepo(dir)).toBe(true)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  // ─── Structured Data Operations ────────────────────────────────────────

  describe('with a test repo', () => {
    let repoDir: string

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      execFileSync('git', ['init'], { cwd: repoDir })
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir })
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repoDir })

      // Create initial commit
      writeFileSync(join(repoDir, 'README.md'), '# Test')
      execFileSync('git', ['add', '.'], { cwd: repoDir })
      execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir })
    })

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true })
    })

    describe('log', () => {
      it('should return structured commit data', async () => {
        const commits = await service.log(repoDir)
        expect(commits.length).toBe(1)
        expect(commits[0].subject).toBe('Initial commit')
        expect(commits[0].authorName).toBe('Test User')
        expect(commits[0].authorEmail).toBe('test@test.com')
        expect(commits[0].hash).toHaveLength(40)
        expect(commits[0].shortHash.length).toBeGreaterThanOrEqual(7)
      })

      it('should handle multiple commits', async () => {
        writeFileSync(join(repoDir, 'file2.txt'), 'content')
        execFileSync('git', ['add', '.'], { cwd: repoDir })
        execFileSync('git', ['commit', '-m', 'Second commit'], { cwd: repoDir })

        const commits = await service.log(repoDir)
        expect(commits.length).toBe(2)
        expect(commits[0].subject).toBe('Second commit')
        expect(commits[1].subject).toBe('Initial commit')
      })

      it('should respect maxCount option', async () => {
        writeFileSync(join(repoDir, 'file2.txt'), 'content')
        execFileSync('git', ['add', '.'], { cwd: repoDir })
        execFileSync('git', ['commit', '-m', 'Second commit'], { cwd: repoDir })

        const commits = await service.log(repoDir, { maxCount: 1 })
        expect(commits.length).toBe(1)
        expect(commits[0].subject).toBe('Second commit')
      })

      it('should return empty array for empty repo', async () => {
        const emptyDir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
        try {
          execFileSync('git', ['init'], { cwd: emptyDir })
          const commits = await service.log(emptyDir)
          expect(commits).toEqual([])
        } finally {
          rmSync(emptyDir, { recursive: true, force: true })
        }
      })
    })

    describe('getBranches', () => {
      it('should return branch data', async () => {
        const branches = await service.getBranches(repoDir)
        expect(branches.length).toBeGreaterThanOrEqual(1)
        const current = branches.find((b) => b.current)
        expect(current).toBeDefined()
        expect(current!.name).toBeTruthy()
      })

      it('should list multiple branches', async () => {
        execFileSync('git', ['branch', 'feature-branch'], { cwd: repoDir })
        const branches = await service.getBranches(repoDir)
        expect(branches.length).toBe(2)
        const names = branches.map((b) => b.name)
        expect(names).toContain('feature-branch')
      })
    })

    describe('getRemotes', () => {
      it('should return empty for a repo with no remotes', async () => {
        const remotes = await service.getRemotes(repoDir)
        expect(remotes).toEqual([])
      })

      it('should return remote data', async () => {
        execFileSync('git', ['remote', 'add', 'origin', 'https://example.com/repo.git'], {
          cwd: repoDir
        })
        const remotes = await service.getRemotes(repoDir)
        expect(remotes.length).toBe(1)
        expect(remotes[0].name).toBe('origin')
        expect(remotes[0].fetchUrl).toBe('https://example.com/repo.git')
      })
    })

    describe('getTags', () => {
      it('should return empty when no tags', async () => {
        const tags = await service.getTags(repoDir)
        expect(tags).toEqual([])
      })

      it('should return tag data', async () => {
        execFileSync('git', ['tag', 'v1.0.0'], { cwd: repoDir })
        const tags = await service.getTags(repoDir)
        expect(tags.length).toBe(1)
        expect(tags[0].name).toBe('v1.0.0')
      })
    })

    describe('getStashes', () => {
      it('should return empty when no stashes', async () => {
        const stashes = await service.getStashes(repoDir)
        expect(stashes).toEqual([])
      })

      it('should return stash data', async () => {
        writeFileSync(join(repoDir, 'stash-test.txt'), 'stash content')
        execFileSync('git', ['add', '.'], { cwd: repoDir })
        execFileSync('git', ['stash', 'push', '-m', 'test stash'], { cwd: repoDir })

        const stashes = await service.getStashes(repoDir)
        expect(stashes.length).toBe(1)
        expect(stashes[0].message).toContain('test stash')
        expect(stashes[0].index).toBe(0)
      })
    })

    describe('getStatus', () => {
      it('should report clean working directory', async () => {
        const status = await service.getStatus(repoDir)
        expect(status.staged).toEqual([])
        expect(status.unstaged).toEqual([])
        expect(status.untracked).toEqual([])
      })

      it('should report untracked files', async () => {
        writeFileSync(join(repoDir, 'new-file.txt'), 'content')
        const status = await service.getStatus(repoDir)
        expect(status.untracked.length).toBe(1)
        expect(status.untracked[0].path).toBe('new-file.txt')
        expect(status.untracked[0].status).toBe('untracked')
      })

      it('should report staged files', async () => {
        writeFileSync(join(repoDir, 'staged.txt'), 'content')
        execFileSync('git', ['add', 'staged.txt'], { cwd: repoDir })
        const status = await service.getStatus(repoDir)
        expect(status.staged.length).toBe(1)
        expect(status.staged[0].path).toBe('staged.txt')
        expect(status.staged[0].staged).toBe(true)
      })

      it('should report modified files', async () => {
        writeFileSync(join(repoDir, 'README.md'), '# Updated')
        const status = await service.getStatus(repoDir)
        expect(status.unstaged.length).toBe(1)
        expect(status.unstaged[0].path).toBe('README.md')
        expect(status.unstaged[0].status).toBe('modified')
      })

      it('should report branch info', async () => {
        const status = await service.getStatus(repoDir)
        expect(status.branch).toBeTruthy()
      })
    })

    describe('diff', () => {
      it('should return empty diff for clean repo', async () => {
        const diff = await service.diff(repoDir)
        expect(diff).toBe('')
      })

      it('should return diff for modified file', async () => {
        writeFileSync(join(repoDir, 'README.md'), '# Updated content')
        const diff = await service.diff(repoDir, 'README.md')
        expect(diff).toContain('Updated content')
        expect(diff).toContain('diff --git')
      })
    })
  })

  // ─── Error Handling ────────────────────────────────────────────────────

  describe('error handling', () => {
    it('should throw for non-repo directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      try {
        await expect(service.getStatus(dir)).rejects.toMatchObject({
          code: GitErrorCode.NotARepository
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  // ─── Cancellation ─────────────────────────────────────────────────────

  describe('cancellation', () => {
    it('should reject immediately when signal is already aborted', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      execFileSync('git', ['init'], { cwd: dir })

      const controller = new AbortController()
      controller.abort()

      try {
        await expect(
          service.exec(['status'], dir, { signal: controller.signal })
        ).rejects.toMatchObject({
          code: GitErrorCode.Cancelled
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  // ─── Command Queue ────────────────────────────────────────────────────

  describe('command queue', () => {
    it('should execute commands sequentially for the same repo', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'gitslop-test-'))
      execFileSync('git', ['init'], { cwd: dir })
      execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir })
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir })
      writeFileSync(join(dir, 'test.txt'), 'content')
      execFileSync('git', ['add', '.'], { cwd: dir })
      execFileSync('git', ['commit', '-m', 'init'], { cwd: dir })

      try {
        // Fire multiple concurrent requests — they should all succeed via queuing
        const results = await Promise.all([
          service.exec(['status'], dir),
          service.exec(['log', '--oneline'], dir),
          service.exec(['branch'], dir)
        ])

        expect(results).toHaveLength(3)
        results.forEach((r) => {
          expect(r.stdout).toBeDefined()
        })
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
