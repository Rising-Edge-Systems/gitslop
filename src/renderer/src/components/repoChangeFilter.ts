/**
 * Decide whether the file open in the center view should refetch given the
 * paths reported by repo:changed.
 *   null/undefined → unknown scope (forced/global, e.g. our own git op or a
 *                    HEAD/ref change) → refetch (legacy behavior).
 *   empty array    → a path-less watcher event (addDir/unlinkDir) → refetch.
 *   otherwise      → refetch iff the open path is in the changed set.
 * Index-only staged edits by external tools arrive as forced (null) events, so
 * staged views are still kept fresh; `staged` is accepted for call-site clarity.
 */
export function isOpenFileAffected(
  openPath: string,
  staged: boolean,
  changedPaths: string[] | null | undefined
): boolean {
  if (changedPaths == null) return true
  if (changedPaths.length === 0) return true
  void staged
  return changedPaths.includes(openPath)
}
