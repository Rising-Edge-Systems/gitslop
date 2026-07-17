/**
 * Integration tests for pull() auto-stash behaviour, driving the REAL GitService
 * against REAL temporary git repositories.
 *
 * Regression: a pull that auto-stashed with `--include-untracked` and then hit a
 * conflict on `stash pop` dumped the user into the merge conflict resolver with a
 * flood of phantom "conflicts" on files they never edited (observed: 381 conflicts
 * on a clean fast-forward pull). The fixes verified here:
 *   1. Only TRACKED changes are auto-stashed; untracked files are left in place.
 *   2. A conflicted pop is aborted (leaving the tree clean at the new HEAD) and the
 *      stash is kept intact, instead of leaving unmerged files that auto-open the
 *      resolver.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'
import { GitService } from '../git-service'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('pull auto-stash', () => {
  let service: GitService
  let originDir: string
  let cloneDir: string

  const gitIn = (dir: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd: dir }).toString()

  const configRepo = (dir: string): void => {
    gitIn(dir, 'config', 'user.email', 'test@test.com')
    gitIn(dir, 'config', 'user.name', 'Test User')
    gitIn(dir, 'config', 'core.autocrlf', 'false')
  }

  beforeAll(() => {
    service = new GitService()
  })

  beforeEach(() => {
    // Upstream repo with one commit on main.
    originDir = mkdtempSync(join(tmpdir(), 'gitslop-pull-origin-'))
    execFileSync('git', ['init'], { cwd: originDir })
    execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: originDir })
    configRepo(originDir)
    writeFileSync(join(originDir, 'shared.txt'), 'base\n')
    gitIn(originDir, 'add', '--', 'shared.txt')
    gitIn(originDir, 'commit', '-m', 'base')

    // Clone it (checks out origin/main). Force autocrlf=false at checkout time so
    // the working tree isn't left with phantom CRLF "modifications" on Windows.
    cloneDir = mkdtempSync(join(tmpdir(), 'gitslop-pull-clone-'))
    execFileSync('git', ['-c', 'core.autocrlf=false', 'clone', originDir, cloneDir])
    configRepo(cloneDir)
  })

  afterEach(() => {
    rmSync(originDir, { recursive: true, force: true })
    rmSync(cloneDir, { recursive: true, force: true })
  })

  const advanceUpstream = (content: string, message: string): void => {
    writeFileSync(join(originDir, 'shared.txt'), content)
    gitIn(originDir, 'add', '--', 'shared.txt')
    gitIn(originDir, 'commit', '-m', message)
  }

  const stashList = (): string[] =>
    gitIn(cloneDir, 'stash', 'list').trim().split('\n').filter((l) => l.length > 0)

  it('leaves untracked files alone and pulls cleanly without conflicts', async () => {
    // Untracked file in the clone (not committed, not ignored) — the kind of file
    // the old `--include-untracked` auto-stash swept up and then failed to reapply.
    writeFileSync(join(cloneDir, 'notes.txt'), 'my local scratch\n')
    advanceUpstream('upstream change\n', 'upstream edit')

    const result = await service.pull(cloneDir, { autoStash: true })

    // An untracked-only tree is not "dirty" for auto-stash purposes.
    expect(result.autoStashed).toBe(false)
    expect(result.stashPopConflict).toBe(false)
    // No phantom conflicts, and the untracked file is untouched.
    expect(await service.getConflictedFiles(cloneDir)).toEqual([])
    expect(existsSync(join(cloneDir, 'notes.txt'))).toBe(true)
    expect(stashList()).toEqual([])
  })

  it('aborts a conflicted pop and keeps the stash instead of leaving unmerged files', async () => {
    // A real tracked change locally...
    writeFileSync(join(cloneDir, 'shared.txt'), 'my local edit\n')
    // ...that collides with an incoming upstream change to the same lines.
    advanceUpstream('upstream edit\n', 'upstream edit')

    const result = await service.pull(cloneDir, { autoStash: true })

    expect(result.autoStashed).toBe(true)
    expect(result.stashPopConflict).toBe(true)
    // The key fix: no unmerged files remain, so the UI won't auto-open the resolver.
    expect(await service.getConflictedFiles(cloneDir)).toEqual([])
    // The user's work is preserved in the stash for a deliberate manual reapply.
    const stashes = stashList()
    expect(stashes.length).toBe(1)
    expect(stashes[0]).toContain('gitslop: auto-stash before pull')
    // Working tree is clean at the new upstream HEAD.
    expect(gitIn(cloneDir, 'status', '--porcelain').trim()).toBe('')
  })
})
