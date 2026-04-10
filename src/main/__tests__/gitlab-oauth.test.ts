import { describe, it, expect } from 'vitest'
import * as crypto from 'crypto'
import {
  generatePkcePair,
  generateState,
  startLoopbackServer,
  LOOPBACK_PORT,
  ensureFreshGitLabToken,
  refreshGitLabToken,
  configureGitLabAccountStore,
  type StoredGitLabAccount
} from '../gitlab-oauth'

// ─── PKCE ─────────────────────────────────────────────────────────────────────

describe('generatePkcePair', () => {
  it('produces distinct verifier/challenge pairs across calls', () => {
    const a = generatePkcePair()
    const b = generatePkcePair()
    expect(a.verifier).not.toEqual(b.verifier)
    expect(a.challenge).not.toEqual(b.challenge)
  })

  it('verifier and challenge are different values within one pair', () => {
    const { verifier, challenge } = generatePkcePair()
    expect(verifier).not.toEqual(challenge)
  })

  it('challenge equals base64url(sha256(verifier))', () => {
    const { verifier, challenge } = generatePkcePair()
    const expected = crypto
      .createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(challenge).toEqual(expected)
  })

  it('verifier and challenge are URL-safe (no +, /, or =)', () => {
    for (let i = 0; i < 25; i++) {
      const { verifier, challenge } = generatePkcePair()
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('verifier length is 43 chars (32 random bytes, base64url, no padding)', () => {
    const { verifier } = generatePkcePair()
    expect(verifier.length).toBe(43)
  })
})

describe('generateState', () => {
  it('produces distinct URL-safe values', () => {
    const a = generateState()
    const b = generateState()
    expect(a).not.toEqual(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

// ─── Loopback server ──────────────────────────────────────────────────────────

describe('LOOPBACK_PORT constant', () => {
  it('is the documented fixed port 47823', () => {
    // If you ever need to change this, you MUST also update the
    // instructions shown in the Settings UI — existing registered
    // OAuth apps would break.
    expect(LOOPBACK_PORT).toBe(47823)
  })
})

describe('startLoopbackServer', () => {
  // Use a non-standard test port to avoid collisions with a real login.
  const TEST_PORT = 47824

  it('resolves with { code, state } when /callback is hit with code', async () => {
    const serverPromise = startLoopbackServer(TEST_PORT)
    // Give the server a moment to bind.
    await new Promise((r) => setTimeout(r, 50))
    const resp = await fetch(
      `http://127.0.0.1:${TEST_PORT}/callback?code=abc123&state=xyz`
    )
    expect(resp.ok).toBe(true)
    const body = await resp.text()
    expect(body).toContain('GitSlop login successful')
    const result = await serverPromise
    expect(result).toEqual({ code: 'abc123', state: 'xyz' })
  }, 10_000)

  it('rejects with EADDRINUSE error when port is already in use', async () => {
    const busyPort = 47825
    const first = startLoopbackServer(busyPort)
    await new Promise((r) => setTimeout(r, 50))
    await expect(startLoopbackServer(busyPort)).rejects.toThrow(
      /already in use/
    )
    // Clean up the first server by triggering a callback.
    await fetch(`http://127.0.0.1:${busyPort}/callback?code=x&state=y`)
    await first
  }, 10_000)

  it('rejects when GitLab returns an error query parameter', async () => {
    const errPort = 47826
    const serverPromise = startLoopbackServer(errPort)
    await new Promise((r) => setTimeout(r, 50))
    const resp = await fetch(
      `http://127.0.0.1:${errPort}/callback?error=access_denied&error_description=User%20denied`
    )
    expect(resp.status).toBe(400)
    await expect(serverPromise).rejects.toThrow(/User denied|access_denied/)
  }, 10_000)
})

// ─── Refresh / ensureFreshGitLabToken ─────────────────────────────────────

// These tests deliberately use the `plain:` token prefix so decryptToken
// can short-circuit without touching Electron's safeStorage (which is not
// available in the vitest runtime).

describe('ensureFreshGitLabToken', () => {
  it('returns the decrypted PAT for legacy PAT accounts unchanged', async () => {
    const pat: StoredGitLabAccount = {
      id: 'gl-1',
      label: 'test',
      username: 'alice',
      token: 'plain:pat-token-abc'
      // authType/expiresAt absent → legacy PAT
    }
    const tok = await ensureFreshGitLabToken(pat)
    expect(tok).toBe('pat-token-abc')
  })

  it('returns the decrypted access token when an OAuth token is still fresh', async () => {
    const account: StoredGitLabAccount = {
      id: 'gl-2',
      label: 'oauth',
      username: 'bob',
      token: 'plain:access-token-xyz',
      authType: 'oauth',
      refreshToken: 'plain:refresh-abc',
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 min in the future
      clientId: 'client-1'
    }
    const tok = await ensureFreshGitLabToken(account)
    expect(tok).toBe('access-token-xyz')
  })

  it('returns null when refresh fails for an OAuth account with no refresh token', async () => {
    // Near-expiry OAuth account missing a refreshToken — refreshGitLabToken
    // returns null and ensureFreshGitLabToken surfaces that as null.
    const account: StoredGitLabAccount = {
      id: 'gl-3',
      label: 'broken',
      username: 'eve',
      token: 'plain:old-access',
      authType: 'oauth',
      expiresAt: Date.now() - 1000,
      clientId: 'client-1'
      // no refreshToken
    }
    const tok = await ensureFreshGitLabToken(account)
    expect(tok).toBeNull()
  })
})

describe('refreshGitLabToken', () => {
  it('returns null for non-OAuth accounts', async () => {
    const pat: StoredGitLabAccount = {
      id: 'gl-4',
      label: 'pat',
      username: 'x',
      token: 'plain:pat'
    }
    expect(await refreshGitLabToken(pat)).toBeNull()
  })

  it('returns null when clientId is missing', async () => {
    const oauth: StoredGitLabAccount = {
      id: 'gl-5',
      label: 'oauth',
      username: 'x',
      token: 'plain:a',
      authType: 'oauth',
      refreshToken: 'plain:r',
      expiresAt: Date.now() - 1
    }
    expect(await refreshGitLabToken(oauth)).toBeNull()
  })
})

describe('configureGitLabAccountStore', () => {
  it('is a registration function that accepts read/write callbacks', () => {
    // Smoke test: registering a dummy accessor should not throw.
    const fake: StoredGitLabAccount[] = []
    expect(() =>
      configureGitLabAccountStore({
        read: () => fake,
        write: (a) => {
          fake.splice(0, fake.length, ...a)
        }
      })
    ).not.toThrow()
  })
})
