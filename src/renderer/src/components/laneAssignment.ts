// ─── SVG Commit Graph — Lane Assignment Algorithm ────────────────────────────
//
// Pure function that assigns each commit to a branch lane (column) and computes
// parent connections for rendering. Used by both SVG and Canvas renderers.
//
// Conventions:
//   - HEAD / current branch always occupies lane 0 (leftmost)
//   - Each branch gets a consistent color from a curated palette, cycling for extras
//   - Output: LaneAssignmentResult[] — one entry per commit, in input order

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal commit data needed for lane assignment */
export interface LaneCommit {
  hash: string
  parentHashes: string[]
  refs: string // raw refs string, e.g. "HEAD -> main, origin/main, tag: v1.0"
}

/** A parsed ref attached to a commit */
export interface ParsedRef {
  name: string
  type: 'head' | 'branch' | 'remote' | 'tag'
}

/** Connection line from a commit to one of its parents */
export interface ParentConnection {
  parentHash: string
  fromLane: number // lane of the child commit
  toLane: number   // lane of the parent commit
}

/** Result of lane assignment for a single commit */
export interface LaneAssignmentResult {
  commit: LaneCommit
  lane: number
  color: string
  parentConnections: ParentConnection[]
  isMerge: boolean
  refs: ParsedRef[]
}

// ─── Color Palette ───────────────────────────────────────────────────────────

export const LANE_COLORS = [
  '#89b4fa', // blue
  '#a6e3a1', // green
  '#f9e2af', // yellow
  '#fab387', // peach
  '#cba6f7', // mauve
  '#f38ba8', // red
  '#94e2d5', // teal
  '#f5c2e7', // pink
  '#74c7ec', // sapphire
  '#eba0ac', // maroon
]

// ─── Ref Parsing ─────────────────────────────────────────────────────────────

export function parseRefs(refString: string): ParsedRef[] {
  if (!refString || !refString.trim()) return []

  return refString
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((ref) => {
      if (ref.startsWith('HEAD -> ')) {
        return { name: ref.replace('HEAD -> ', ''), type: 'head' as const }
      }
      if (ref === 'HEAD') {
        return { name: 'HEAD', type: 'head' as const }
      }
      if (ref.startsWith('tag: ')) {
        return { name: ref.replace('tag: ', ''), type: 'tag' as const }
      }
      if (ref.includes('/')) {
        return { name: ref, type: 'remote' as const }
      }
      return { name: ref, type: 'branch' as const }
    })
}

// ─── Lane Assignment Algorithm ───────────────────────────────────────────────

/**
 * Assigns each commit to a visual lane (column) and computes parent connections.
 *
 * Algorithm overview:
 * 1. Find the HEAD commit and ensure it starts in lane 0
 * 2. Walk commits in topological order (newest first, as provided by git log)
 * 3. Each commit occupies the lane reserved by its child, or gets a new lane
 * 4. First parent continues in the same lane (same branch)
 * 5. Additional parents (merge sources) get their own lanes
 * 6. Freed lanes are reused to keep the graph compact
 * 7. Each lane gets a consistent color from the palette
 *
 * @param commits - Commits in reverse chronological order (newest first)
 * @returns Array of lane assignments, one per commit, in the same order
 */
export function assignLanes(commits: LaneCommit[]): LaneAssignmentResult[] {
  if (commits.length === 0) return []

  const results: LaneAssignmentResult[] = []
  // activeLanes[i] = hash of the commit expected next in lane i, or null if free
  const activeLanes: (string | null)[] = []
  // Track which lane index a "branch" (identified by the first commit hash seen) maps to
  // so we can assign consistent colors per lane
  const laneColorMap = new Map<number, string>()
  let nextColorIndex = 0

  function getColorForLane(lane: number): string {
    if (!laneColorMap.has(lane)) {
      if (lane === 0 && headCommitIndex >= 0) {
        // HEAD lane always uses CSS accent color for theme consistency
        laneColorMap.set(lane, 'var(--accent)')
        // Still advance color index so other lanes don't get the first palette color
        // (which is visually similar to --accent)
        nextColorIndex++
      } else {
        laneColorMap.set(lane, LANE_COLORS[nextColorIndex % LANE_COLORS.length])
        nextColorIndex++
      }
    }
    return laneColorMap.get(lane)!
  }

  // Pre-scan: find the HEAD commit index to ensure it gets lane 0
  let headCommitIndex = -1
  for (let i = 0; i < commits.length; i++) {
    const refs = parseRefs(commits[i].refs)
    if (refs.some((r) => r.type === 'head')) {
      headCommitIndex = i
      break
    }
  }

  // If HEAD is the first commit (most common case), lane 0 is naturally assigned.
  // If HEAD is not first, we pre-reserve lane 0 for HEAD's hash so it lands there.
  if (headCommitIndex > 0) {
    activeLanes.push(commits[headCommitIndex].hash)
  }

  for (let i = 0; i < commits.length; i++) {
    const commit = commits[i]
    const refs = parseRefs(commit.refs)

    // Find the lane for this commit (should already be reserved by a child)
    let lane = activeLanes.indexOf(commit.hash)
    if (lane === -1) {
      // New branch head — find first empty lane
      lane = activeLanes.indexOf(null)
      if (lane === -1) {
        lane = activeLanes.length
        activeLanes.push(commit.hash)
      } else {
        activeLanes[lane] = commit.hash
      }
    }

    const parentConnections: ParentConnection[] = []
    const isMerge = commit.parentHashes.length > 1

    if (commit.parentHashes.length === 0) {
      // Root commit — free this lane
      activeLanes[lane] = null
    } else {
      // First parent continues in the same lane (linear history)
      const firstParent = commit.parentHashes[0]
      activeLanes[lane] = firstParent

      parentConnections.push({
        parentHash: firstParent,
        fromLane: lane,
        toLane: lane,
      })

      // Additional parents (merge sources) — assign to existing or new lanes
      for (let p = 1; p < commit.parentHashes.length; p++) {
        const parentHash = commit.parentHashes[p]
        let parentLane = activeLanes.indexOf(parentHash)

        if (parentLane === -1) {
          // Parent not yet in any lane — assign to first free lane or create new
          parentLane = activeLanes.indexOf(null)
          if (parentLane === -1) {
            parentLane = activeLanes.length
            activeLanes.push(parentHash)
          } else {
            activeLanes[parentLane] = parentHash
          }
        }

        parentConnections.push({
          parentHash,
          fromLane: lane,
          toLane: parentLane,
        })
      }
    }

    // Trim trailing null lanes to keep graph compact
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }

    // Update parent connection toLane for first parent (it stays in same lane)
    // Already correct since first parent inherits the commit's lane

    const color = getColorForLane(lane)

    results.push({
      commit,
      lane,
      color,
      parentConnections,
      isMerge,
      refs,
    })
  }

  // Second pass: resolve toLane for parent connections where the parent commit
  // appears later in the list. The first pass sets toLane based on activeLanes
  // state at assignment time, which is correct for the graph rendering.
  // However, for merge connections we need to update toLane to reflect where
  // the parent actually ends up.
  const commitLaneMap = new Map<string, number>()
  for (const result of results) {
    commitLaneMap.set(result.commit.hash, result.lane)
  }
  for (const result of results) {
    for (const conn of result.parentConnections) {
      const actualParentLane = commitLaneMap.get(conn.parentHash)
      if (actualParentLane !== undefined) {
        conn.toLane = actualParentLane
      }
    }
  }

  return results
}

/**
 * Get the maximum lane index used across all results.
 * Useful for calculating graph width.
 */
export function getMaxLane(results: LaneAssignmentResult[]): number {
  if (results.length === 0) return 0
  return Math.max(...results.map((r) => r.lane))
}
