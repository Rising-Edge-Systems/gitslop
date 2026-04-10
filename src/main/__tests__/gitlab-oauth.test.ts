import { describe, it, expect } from 'vitest'
import * as crypto from 'crypto'
import {
  generatePkcePair,
  generateState,
  startLoopbackServer,
  LOOPBACK_PORT
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
