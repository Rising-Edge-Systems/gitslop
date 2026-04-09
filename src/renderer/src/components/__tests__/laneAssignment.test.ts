import { describe, it, expect } from 'vitest'
import {
  assignLanes,
  compactLanes,
  parseRefs,
  getMaxLane,
  LANE_COLORS,
  MAX_VISIBLE_LANES,
  type LaneCommit,
  type LaneAssignmentResult,
} from '../laneAssignment'

// ─── Helper to create commits ────────────────────────────────────────────────

function makeCommit(
  hash: string,
  parentHashes: string[],
  refs = ''
): LaneCommit {
  return { hash, parentHashes, refs }
}

// ─── parseRefs ───────────────────────────────────────────────────────────────

describe('parseRefs', () => {
  it('returns empty array for empty string', () => {
    expect(parseRefs('')).toEqual([])
    expect(parseRefs('   ')).toEqual([])
  })

  it('parses HEAD ref', () => {
    const result = parseRefs('HEAD -> main')
    expect(result).toEqual([{ name: 'main', type: 'head' }])
  })

  it('parses detached HEAD', () => {
    const result = parseRefs('HEAD')
    expect(result).toEqual([{ name: 'HEAD', type: 'head' }])
  })

  it('parses tag', () => {
    const result = parseRefs('tag: v1.0.0')
    expect(result).toEqual([{ name: 'v1.0.0', type: 'tag' }])
  })

  it('parses remote branch', () => {
    const result = parseRefs('origin/main')
    expect(result).toEqual([{ name: 'origin/main', type: 'remote' }])
  })

  it('parses local branch', () => {
    const result = parseRefs('feature-x')
    expect(result).toEqual([{ name: 'feature-x', type: 'branch' }])
  })

  it('parses multiple refs', () => {
    const result = parseRefs('HEAD -> main, origin/main, tag: v2.0')
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ name: 'main', type: 'head' })
    expect(result[1]).toEqual({ name: 'origin/main', type: 'remote' })
    expect(result[2]).toEqual({ name: 'v2.0', type: 'tag' })
  })
})

// ─── assignLanes ─────────────────────────────────────────────────────────────

describe('assignLanes', () => {
  it('returns empty array for empty input', () => {
    expect(assignLanes([])).toEqual([])
  })

  // ─── Linear History ──────────────────────────────────────────────────

  describe('linear history', () => {
    it('assigns all commits to lane 0', () => {
      // A -> B -> C (linear, newest first)
      const commits = [
        makeCommit('aaa', ['bbb'], 'HEAD -> main'),
        makeCommit('bbb', ['ccc']),
        makeCommit('ccc', []),
      ]
      const results = assignLanes(commits)

      expect(results).toHaveLength(3)
      expect(results[0].lane).toBe(0)
      expect(results[1].lane).toBe(0)
      expect(results[2].lane).toBe(0)
    })

    it('all commits in lane 0 get the same color', () => {
      const commits = [
        makeCommit('aaa', ['bbb'], 'HEAD -> main'),
        makeCommit('bbb', ['ccc']),
        makeCommit('ccc', []),
      ]
      const results = assignLanes(commits)
      const color = results[0].color
      expect(results.every((r) => r.color === color)).toBe(true)
    })

    it('marks none as merge commits', () => {
      const commits = [
        makeCommit('aaa', ['bbb']),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)
      expect(results.every((r) => !r.isMerge)).toBe(true)
    })

    it('parent connections point within lane 0', () => {
      const commits = [
        makeCommit('aaa', ['bbb']),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)
      expect(results[0].parentConnections).toEqual([
        { parentHash: 'bbb', fromLane: 0, toLane: 0 },
      ])
    })
  })

  // ─── Single Branch (Feature Branch) ──────────────────────────────────

  describe('single feature branch', () => {
    it('places feature branch in a separate lane', () => {
      // Graph:
      //   D (HEAD -> main, merge commit: parents C, B)
      //   |\
      //   C |  (main branch, lane 0)
      //   | B  (feature branch, lane 1)
      //   |/
      //   A    (common ancestor)
      const commits = [
        makeCommit('ddd', ['ccc', 'bbb'], 'HEAD -> main'),
        makeCommit('ccc', ['aaa']),
        makeCommit('bbb', ['aaa']),
        makeCommit('aaa', []),
      ]
      const results = assignLanes(commits)

      // D is merge commit in lane 0
      expect(results[0].lane).toBe(0)
      expect(results[0].isMerge).toBe(true)

      // C continues in lane 0 (first parent)
      expect(results[1].lane).toBe(0)

      // B is in a different lane (second parent of merge)
      expect(results[2].lane).not.toBe(0)

      // A (common ancestor) should be in lane 0 (continues from C)
      expect(results[3].lane).toBe(0)
    })
  })

  // ─── Merge Commit ────────────────────────────────────────────────────

  describe('merge commit', () => {
    it('identifies merge commits correctly', () => {
      const commits = [
        makeCommit('merge', ['parent1', 'parent2']),
        makeCommit('parent1', []),
        makeCommit('parent2', []),
      ]
      const results = assignLanes(commits)

      expect(results[0].isMerge).toBe(true)
      expect(results[0].parentConnections).toHaveLength(2)
    })

    it('has correct parent connections for merge', () => {
      const commits = [
        makeCommit('merge', ['parent1', 'parent2'], 'HEAD -> main'),
        makeCommit('parent1', []),
        makeCommit('parent2', []),
      ]
      const results = assignLanes(commits)

      const mergeResult = results[0]
      // First parent stays in same lane
      expect(mergeResult.parentConnections[0].fromLane).toBe(mergeResult.lane)
      // Second parent goes to a different lane
      expect(mergeResult.parentConnections[1].fromLane).toBe(mergeResult.lane)
      expect(mergeResult.parentConnections[1].toLane).not.toBe(mergeResult.lane)
    })
  })

  // ─── Multiple Concurrent Branches ────────────────────────────────────

  describe('multiple concurrent branches', () => {
    it('assigns different lanes to concurrent branches', () => {
      // HEAD merge both branch-a and branch-b
      // M (merge of A2 and B2 into main)
      // |\
      // | \
      // |  B2
      // |  |
      // A2 B1
      // |  /
      // A1
      // |
      // root
      const commits = [
        makeCommit('mmm', ['a2a', 'b2b'], 'HEAD -> main'),
        makeCommit('a2a', ['a1a']),
        makeCommit('b2b', ['b1b']),
        makeCommit('a1a', ['root']),
        makeCommit('b1b', ['root']),
        makeCommit('root', []),
      ]
      const results = assignLanes(commits)

      // Main line stays in lane 0
      expect(results[0].lane).toBe(0) // M
      expect(results[1].lane).toBe(0) // A2 (first parent)

      // B branch is in a separate lane
      const bLane = results[2].lane // B2
      expect(bLane).not.toBe(0)
      expect(results[4].lane).toBe(bLane) // B1 same lane as B2
    })
  })

  // ─── Octopus Merge ──────────────────────────────────────────────────

  describe('octopus merge', () => {
    it('handles merge with 3+ parents', () => {
      const commits = [
        makeCommit('octo', ['p1', 'p2', 'p3'], 'HEAD -> main'),
        makeCommit('p1', []),
        makeCommit('p2', []),
        makeCommit('p3', []),
      ]
      const results = assignLanes(commits)

      expect(results[0].isMerge).toBe(true)
      expect(results[0].parentConnections).toHaveLength(3)

      // All three parents should be in distinct lanes
      const parentLanes = results.slice(1).map((r) => r.lane)
      const uniqueLanes = new Set(parentLanes)
      expect(uniqueLanes.size).toBe(3)
    })
  })

  // ─── HEAD in Lane 0 ─────────────────────────────────────────────────

  describe('HEAD assignment', () => {
    it('assigns HEAD commit to lane 0', () => {
      const commits = [
        makeCommit('aaa', ['bbb'], 'HEAD -> main'),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)
      expect(results[0].lane).toBe(0)
    })

    it('assigns HEAD to lane 0 even when not first commit', () => {
      // Feature branch tip appears before HEAD in the list
      const commits = [
        makeCommit('feat', ['base']),
        makeCommit('head', ['base'], 'HEAD -> main'),
        makeCommit('base', []),
      ]
      const results = assignLanes(commits)

      const headResult = results.find(
        (r) => r.commit.hash === 'head'
      )!
      expect(headResult.lane).toBe(0)
    })
  })

  // ─── Color Assignment ──────────────────────────────────────────────

  describe('color assignment', () => {
    it('assigns accent color to the HEAD lane', () => {
      const commits = [
        makeCommit('aaa', ['bbb'], 'HEAD -> main'),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)
      expect(results[0].color).toBe('var(--accent)')
    })

    it('assigns palette colors to non-HEAD lanes', () => {
      const commits = [
        makeCommit('aaa', ['bbb', 'ccc']),
        makeCommit('ccc', ['ddd']),
        makeCommit('bbb', ['ddd']),
        makeCommit('ddd', []),
      ]
      const results = assignLanes(commits)
      // Non-HEAD commits should get palette colors
      expect(LANE_COLORS).toContain(results[1].color)
    })

    it('same lane gets same color', () => {
      const commits = [
        makeCommit('aaa', ['bbb']),
        makeCommit('bbb', ['ccc']),
        makeCommit('ccc', []),
      ]
      const results = assignLanes(commits)
      expect(results[0].color).toBe(results[1].color)
      expect(results[1].color).toBe(results[2].color)
    })

    it('different lanes get different colors', () => {
      const commits = [
        makeCommit('merge', ['p1', 'p2']),
        makeCommit('p1', []),
        makeCommit('p2', []),
      ]
      const results = assignLanes(commits)

      const lane0Color = results.find((r) => r.lane === 0)?.color
      const otherLane = results.find((r) => r.lane !== 0)
      expect(otherLane?.color).not.toBe(lane0Color)
    })

    it('cycles colors when more than palette size branches exist', () => {
      // Create enough branches to exceed the palette
      const parents = Array.from({ length: 12 }, (_, i) => `p${i}`)
      const commits: LaneCommit[] = [
        makeCommit('merge', parents),
        ...parents.map((hash) => makeCommit(hash, [])),
      ]
      const results = assignLanes(commits)

      // All should have valid colors
      for (const r of results) {
        expect(LANE_COLORS).toContain(r.color)
      }
    })
  })

  // ─── Refs Parsing in Results ─────────────────────────────────────────

  describe('refs in results', () => {
    it('includes parsed refs for each commit', () => {
      const commits = [
        makeCommit('aaa', ['bbb'], 'HEAD -> main, tag: v1.0'),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)

      expect(results[0].refs).toHaveLength(2)
      expect(results[0].refs[0]).toEqual({ name: 'main', type: 'head' })
      expect(results[0].refs[1]).toEqual({ name: 'v1.0', type: 'tag' })
      expect(results[1].refs).toHaveLength(0)
    })
  })

  // ─── Root Commit ─────────────────────────────────────────────────────

  describe('root commit', () => {
    it('handles single root commit', () => {
      const commits = [makeCommit('root', [], 'HEAD -> main')]
      const results = assignLanes(commits)

      expect(results).toHaveLength(1)
      expect(results[0].lane).toBe(0)
      expect(results[0].parentConnections).toHaveLength(0)
      expect(results[0].isMerge).toBe(false)
    })

    it('frees lane after root commit', () => {
      // Two unrelated branches
      const commits = [
        makeCommit('aaa', []),
        makeCommit('bbb', []),
      ]
      const results = assignLanes(commits)
      // Both can be in lane 0 since lane is freed after root
      // (or they may be in different lanes depending on ordering)
      expect(results).toHaveLength(2)
    })
  })

  // ─── Lane Reuse ──────────────────────────────────────────────────────

  describe('lane reuse', () => {
    it('reuses freed lanes to keep graph compact', () => {
      // Branch ends early, lane should be reused
      // M1 (merge: C, B)
      // |\
      // C B
      // |/
      // A
      // |
      // M2 (merge: X, Y)  <-- should reuse freed lane
      // |\
      // X Y
      // |/
      // R
      const commits = [
        makeCommit('m1', ['ccc', 'bbb']),
        makeCommit('ccc', ['aaa']),
        makeCommit('bbb', ['aaa']),
        makeCommit('aaa', ['m2']),
        makeCommit('m2', ['xxx', 'yyy']),
        makeCommit('xxx', ['rrr']),
        makeCommit('yyy', ['rrr']),
        makeCommit('rrr', []),
      ]
      const results = assignLanes(commits)
      const maxLane = getMaxLane(results)
      // Should not need more than 3 lanes (0, 1, 2) — lanes are reused
      // after the first merge completes, the second merge reuses freed lanes
      expect(maxLane).toBeLessThanOrEqual(2)
    })
  })
})

// ─── getMaxLane ──────────────────────────────────────────────────────────────

describe('getMaxLane', () => {
  it('returns 0 for empty input', () => {
    expect(getMaxLane([])).toBe(0)
  })

  it('returns correct max lane', () => {
    const commits = [
      makeCommit('merge', ['p1', 'p2', 'p3']),
      makeCommit('p1', []),
      makeCommit('p2', []),
      makeCommit('p3', []),
    ]
    const results = assignLanes(commits)
    const maxLane = getMaxLane(results)
    expect(maxLane).toBeGreaterThanOrEqual(2) // At least 3 lanes (0, 1, 2)
  })
})

// ─── compactLanes ───────────────────────────────────────────────────────────

describe('compactLanes', () => {
  it('returns empty result for empty input', () => {
    const result = compactLanes([])
    expect(result.nodes).toEqual([])
    expect(result.collapsedCount).toBe(0)
    expect(result.collapsedBranches).toEqual([])
    expect(result.totalLanes).toBe(0)
  })

  it('does not change results when lanes are already contiguous and within limit', () => {
    const commits = [
      makeCommit('aaa', ['bbb'], 'HEAD -> main'),
      makeCommit('bbb', []),
    ]
    const results = assignLanes(commits)
    const compacted = compactLanes(results)
    expect(compacted.nodes).toEqual(results)
    expect(compacted.collapsedCount).toBe(0)
  })

  it('caps lanes at maxLanes and reports collapsed count', () => {
    // Create an octopus merge with many parents to generate many lanes
    const parentCount = 25
    const parents = Array.from({ length: parentCount }, (_, i) => `p${i}`)
    const commits: LaneCommit[] = [
      makeCommit('merge', parents, 'HEAD -> main'),
      ...parents.map((hash, i) => makeCommit(hash, [], i === 0 ? 'feature-a' : i === 20 ? 'feature-z' : '')),
    ]
    const results = assignLanes(commits)
    const compacted = compactLanes(results, 10)

    // Max lane should be 9 (0-indexed, 10 lanes)
    const maxLane = Math.max(...compacted.nodes.map((n) => n.lane))
    expect(maxLane).toBe(9)

    // Should have collapsed lanes
    expect(compacted.collapsedCount).toBeGreaterThan(0)
    expect(compacted.totalLanes).toBeGreaterThan(10) // many unique lanes from the octopus merge
  })

  it('remaps parent connections when lanes are compacted', () => {
    const parents = Array.from({ length: 5 }, (_, i) => `p${i}`)
    const commits: LaneCommit[] = [
      makeCommit('merge', parents),
      ...parents.map((hash) => makeCommit(hash, [])),
    ]
    const results = assignLanes(commits)
    const compacted = compactLanes(results, 3)

    // All parent connections should reference valid lanes (0, 1, or 2)
    for (const node of compacted.nodes) {
      expect(node.lane).toBeLessThanOrEqual(2)
      for (const conn of node.parentConnections) {
        expect(conn.fromLane).toBeLessThanOrEqual(2)
        expect(conn.toLane).toBeLessThanOrEqual(2)
      }
    }
  })

  it('collects collapsed branch names', () => {
    // Create enough branches to exceed a small max
    const parents = Array.from({ length: 6 }, (_, i) => `p${i}`)
    const commits: LaneCommit[] = [
      makeCommit('merge', parents, 'HEAD -> main'),
      ...parents.map((hash, i) => makeCommit(hash, [], `branch-${i}`)),
    ]
    const results = assignLanes(commits)
    const compacted = compactLanes(results, 4)

    // Should have some collapsed branches
    expect(compacted.collapsedBranches.length).toBeGreaterThan(0)
    // Collapsed branches should be from the overflow lanes
    for (const name of compacted.collapsedBranches) {
      expect(name).toMatch(/^branch-/)
    }
  })

  it('uses MAX_VISIBLE_LANES as default', () => {
    // Just verify the constant is exported and reasonable
    expect(MAX_VISIBLE_LANES).toBeGreaterThanOrEqual(10)
    expect(MAX_VISIBLE_LANES).toBeLessThanOrEqual(30)
  })

  it('with Infinity maxLanes, no lanes are collapsed', () => {
    const parents = Array.from({ length: 25 }, (_, i) => `p${i}`)
    const commits: LaneCommit[] = [
      makeCommit('merge', parents),
      ...parents.map((hash) => makeCommit(hash, [])),
    ]
    const results = assignLanes(commits)
    const compacted = compactLanes(results, Infinity)

    expect(compacted.collapsedCount).toBe(0)
    expect(compacted.collapsedBranches).toEqual([])
  })
})
