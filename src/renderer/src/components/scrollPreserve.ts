/** Clamp a previously-saved scrollTop into the valid range of the new content. */
export function clampRestoreScrollTop(saved: number, maxScrollTop: number): number {
  const ceiling = Math.max(0, maxScrollTop)
  return Math.max(0, Math.min(saved, ceiling))
}
