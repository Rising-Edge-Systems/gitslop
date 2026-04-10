/**
 * Shared token encryption helpers used by both index.ts and gitlab-oauth.ts.
 *
 * Uses Electron's `safeStorage` when available; falls back to an unencrypted
 * `plain:` prefix so development still works on systems without a keyring.
 *
 * The format must match across all consumers — if you change it here, the
 * next app launch will fail to decrypt existing tokens stored under the old
 * format, and users will have to re-login.
 */

import { safeStorage } from 'electron'

export function encryptToken(token: string): string {
  if (!token) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return safeStorage.encryptString(token).toString('base64')
  }
  return `plain:${token}`
}

export function decryptToken(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('plain:')) {
    return stored.slice(6)
  }
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    }
  } catch {
    // Decryption failed — stored token is corrupt or keyring rotated.
  }
  return ''
}
