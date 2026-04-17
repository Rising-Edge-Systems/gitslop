/**
 * Git credential helper — bridges stored OAuth/PAT tokens to git commands.
 *
 * When the app has a stored token for a remote's host (e.g. github.com),
 * we set GIT_ASKPASS to a small helper script and pass the token via an
 * environment variable.  Git calls the askpass script when it needs a
 * username or password, and the script echoes the appropriate value.
 *
 * This is the same approach used by VS Code, GitHub Desktop, and other
 * Electron-based git GUIs.
 */

import { app } from 'electron'
import { join } from 'path'
import { writeFileSync, chmodSync, existsSync } from 'fs'
import { decryptToken } from './token-crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

interface StoredAccount {
  username: string
  token: string          // encrypted
  instanceUrl?: string   // for self-hosted GitLab
}

type AccountReader = () => StoredAccount[]

// ─── Askpass helper script ──────────────────────────────────────────────────

const ASKPASS_SCRIPT_NAME = 'gitslop-askpass.sh'

/**
 * Returns the path to the askpass helper script, creating it if needed.
 * The script reads GITSLOP_USERNAME and GITSLOP_TOKEN from the environment
 * and echoes the appropriate one based on whether git is asking for a
 * username or password.
 */
function ensureAskpassScript(): string {
  const scriptPath = join(app.getPath('userData'), ASKPASS_SCRIPT_NAME)

  // The script is idempotent — overwrite on every launch to pick up fixes
  const script = `#!/bin/sh
# GitSlop askpass helper — called by git when GIT_ASKPASS is set.
# Reads credentials from environment variables set by the app.
case "$1" in
  *[Uu]sername*) echo "$GITSLOP_USERNAME" ;;
  *[Pp]assword*) echo "$GITSLOP_TOKEN" ;;
  *)             echo "$GITSLOP_TOKEN" ;;
esac
`
  writeFileSync(scriptPath, script, { mode: 0o755 })
  // Ensure executable even if writeFileSync didn't set mode (Windows)
  try { chmodSync(scriptPath, 0o755) } catch { /* ignore on Windows */ }
  return scriptPath
}

let askpassPath: string | null = null

function getAskpassPath(): string {
  if (!askpassPath) {
    askpassPath = ensureAskpassScript()
  }
  return askpassPath
}

// ─── Account resolution ─────────────────────────────────────────────────────

/** Extract the hostname from a git remote URL (https or SSH). */
function extractHost(remoteUrl: string): string | null {
  // HTTPS: https://github.com/user/repo.git
  try {
    const url = new URL(remoteUrl)
    return url.hostname.toLowerCase()
  } catch {
    // Not a valid URL — try SSH format
  }

  // SSH: git@github.com:user/repo.git
  const sshMatch = remoteUrl.match(/@([^:]+):/)
  if (sshMatch) return sshMatch[1].toLowerCase()

  return null
}

/** Check if a host matches a GitHub instance. */
function isGitHubHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.github.com')
}

/** Check if a host matches a GitLab instance (cloud or self-hosted). */
function isGitLabHost(host: string, instanceUrl?: string): boolean {
  if (host === 'gitlab.com' || host.endsWith('.gitlab.com')) return true
  if (instanceUrl) {
    try {
      const parsed = new URL(instanceUrl)
      return parsed.hostname.toLowerCase() === host
    } catch { /* ignore */ }
  }
  return false
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build environment variables that inject stored credentials into a git
 * command.  Returns null if no matching account is found (git will fall
 * back to its default credential helpers).
 *
 * @param remoteUrl  The push URL of the remote (from `git remote -v`)
 * @param githubAccounts  Reader for stored GitHub accounts
 * @param gitlabAccounts  Reader for stored GitLab accounts
 */
export function buildCredentialEnv(
  remoteUrl: string,
  githubAccounts: AccountReader,
  gitlabAccounts: AccountReader
): Record<string, string> | null {
  const host = extractHost(remoteUrl)
  if (!host) return null

  // SSH remotes don't use askpass — they use SSH keys
  if (remoteUrl.startsWith('git@') || remoteUrl.includes('ssh://')) return null

  let account: StoredAccount | undefined

  // Try GitHub accounts
  if (isGitHubHost(host)) {
    const accounts = githubAccounts()
    account = accounts[0] // Use first account (most recently added)
  }

  // Try GitLab accounts
  if (!account) {
    const accounts = gitlabAccounts()
    account = accounts.find(a => isGitLabHost(host, a.instanceUrl))
  }

  if (!account) return null

  const token = decryptToken(account.token)
  if (!token) return null

  return {
    GIT_ASKPASS: getAskpassPath(),
    GITSLOP_USERNAME: account.username || 'oauth2',
    GITSLOP_TOKEN: token,
    // Prevent git from prompting interactively (would hang the process)
    GIT_TERMINAL_PROMPT: '0'
  }
}
