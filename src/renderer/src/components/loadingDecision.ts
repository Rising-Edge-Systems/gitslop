export interface LoadingDecisionInput {
  identityChanged: boolean
  hasCurrentContent: boolean
}

/**
 * Show the loading spinner only on a genuine (first) load or when the open
 * target changed. On a pure background refresh (same identity, content already
 * present) return false so the loader can fetch silently and swap in place.
 */
export function shouldShowLoadingSpinner({ identityChanged, hasCurrentContent }: LoadingDecisionInput): boolean {
  return identityChanged || !hasCurrentContent
}
