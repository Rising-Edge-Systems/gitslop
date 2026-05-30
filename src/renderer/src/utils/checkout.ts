/**
 * Shared branch-checkout helpers.
 *
 * git refuses to switch branches when the switch would overwrite uncommitted
 * work. Every checkout entry point (branch list, remote list, double-click on a
 * graph ref) wants the same recovery: detect that specific failure, auto-stash,
 * retry, and tell the user what happened. Keeping that flow in one place stops
 * the call sites from drifting apart — historically the graph double-click
 * silently did nothing because it lacked the auto-stash the sidebar already had.
 */

export type NotifyFn = (
  type: 'success' | 'error' | 'warning' | 'info',
  message: string,
  details?: string
) => void

/** Minimal shape of the `{ success, error }` results the git IPC layer returns. */
interface CheckoutResult {
  success: boolean
  error?: string
}

export interface CheckoutOutcome {
  /** Whether the branch was ultimately checked out. */
  success: boolean
  /** Whether changes were auto-stashed along the way. */
  stashed: boolean
  error?: string
}

/**
 * Does this git error mean the checkout was blocked by uncommitted changes
 * (and would therefore succeed after an auto-stash)?
 */
export function needsStashForCheckout(errorText: string | undefined): boolean {
  if (!errorText) return false
  return (
    /would be overwritten by checkout/i.test(errorText) ||
    /untracked working tree files would be overwritten/i.test(errorText) ||
    /please commit your changes or stash them/i.test(errorText)
  )
}

/**
 * Run a checkout, auto-stashing and retrying once if it was blocked by
 * working-tree changes, and emit a notification describing the outcome.
 *
 * `doCheckout` performs the actual checkout (local branch, remote-tracking
 * branch, or any composite of the two) and is invoked again after stashing.
 * `label` names the target for the user-facing messages.
 */
export async function checkoutWithAutostash(
  repoPath: string,
  label: string,
  doCheckout: () => Promise<CheckoutResult>,
  notify?: NotifyFn
): Promise<CheckoutOutcome> {
  let result = await doCheckout()
  let stashed = false

  // Auto-stash and retry if the checkout was blocked by uncommitted changes.
  if (!result.success && needsStashForCheckout(result.error)) {
    const includeUntracked = /untracked/i.test(result.error || '')
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19)
    const stashRes = await window.electronAPI.git.stashSave(repoPath, {
      message: `Auto-stash before checkout to ${label} (${ts})`,
      includeUntracked
    })
    if (!stashRes.success) {
      notify?.('error', 'Failed to stash changes', stashRes.error)
      return { success: false, stashed: false, error: stashRes.error }
    }
    stashed = true
    result = await doCheckout()
  }

  if (!result.success) {
    notify?.('error', `Failed to checkout ${label}`, result.error)
    return { success: false, stashed, error: result.error }
  }

  notify?.(
    'success',
    stashed ? `Stashed changes and checked out ${label}` : `Checked out ${label}`
  )
  return { success: true, stashed }
}
