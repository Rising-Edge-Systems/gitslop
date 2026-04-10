/**
 * GitLab OAuth 2.0 helpers for browser-based PKCE login.
 *
 * GitSlop is a public desktop client — no client secret. We use the
 * Authorization Code flow with PKCE (RFC 7636), and capture the
 * redirect via a short-lived loopback HTTP server.
 *
 * LOOPBACK_PORT is fixed at 47823 because the redirect URI must be
 * pre-registered in the user's GitLab OAuth application. Changing
 * this constant would break every existing registered app, so do not
 * change it casually — if you ever need to change it, you must also
 * update the instructions shown to users in the Settings UI.
 */

import * as crypto from 'crypto'
import * as http from 'http'

/** Fixed redirect port — must match the user-registered redirect URI on GitLab. */
export const LOOPBACK_PORT = 47823
export const LOOPBACK_REDIRECT_URI = `http://localhost:${LOOPBACK_PORT}/callback`

export interface PkcePair {
  verifier: string
  challenge: string
}

/**
 * Encode a Buffer as base64url (RFC 4648 §5) with no padding.
 * Node 16+ supports 'base64url' encoding natively, but we normalize
 * here to guarantee URL-safe output.
 */
function toBase64Url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * Generate a PKCE verifier/challenge pair.
 *
 * - verifier: 32 random bytes, base64url-encoded (no padding) → 43 chars.
 * - challenge: base64url(SHA-256(verifier)).
 */
export function generatePkcePair(): PkcePair {
  const verifier = toBase64Url(crypto.randomBytes(32))
  const challenge = toBase64Url(
    crypto.createHash('sha256').update(verifier).digest()
  )
  return { verifier, challenge }
}

/** Generate a random opaque state token for CSRF protection. */
export function generateState(): string {
  return toBase64Url(crypto.randomBytes(16))
}

export interface LoopbackCallbackResult {
  code: string
  state: string
}

const CALLBACK_TIMEOUT_MS = 120_000

const SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>GitSlop Login</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;padding:2rem}h1{color:#a6e3a1;margin-bottom:0.5rem}</style></head><body><div><h1>&#10003; GitSlop login successful</h1><p>You can close this tab and return to GitSlop.</p></div></body></html>`

const errorHtml = (msg: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>GitSlop Login Error</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#1e1e2e;color:#cdd6f4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}div{text-align:center;padding:2rem}h1{color:#f38ba8;margin-bottom:0.5rem}code{background:#313244;padding:0.25rem 0.5rem;border-radius:4px}</style></head><body><div><h1>&#10007; GitSlop login failed</h1><p><code>${msg.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] || c)}</code></p><p>You can close this tab.</p></div></body></html>`

/**
 * Start a one-shot loopback HTTP server that captures the OAuth
 * redirect on /callback and resolves with { code, state }.
 *
 * The server:
 *   - listens on 127.0.0.1:<port>
 *   - rejects immediately if the port is already in use
 *   - responds with a friendly HTML page
 *   - closes itself after 500ms so the browser gets a clean response
 *   - rejects after 120s if no callback arrives
 *   - rejects if GitLab redirects back with ?error=...
 */
export function startLoopbackServer(
  port: number = LOOPBACK_PORT
): Promise<LoopbackCallbackResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    let timeoutHandle: NodeJS.Timeout | null = null

    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.writeHead(400).end()
        return
      }
      const url = new URL(req.url, `http://localhost:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
        return
      }

      const error = url.searchParams.get('error')
      const errorDescription =
        url.searchParams.get('error_description') || error || ''
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state') || ''

      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(errorHtml(errorDescription))
        finish(() =>
          reject(new Error(errorDescription || 'OAuth authorization failed'))
        )
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(errorHtml('Missing authorization code'))
        finish(() => reject(new Error('Missing authorization code in callback')))
        return
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(SUCCESS_HTML)
      finish(() => resolve({ code, state }))
    })

    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      // Give the browser 500ms to receive the HTML before tearing down.
      setTimeout(() => {
        try {
          server.close()
        } catch {
          /* ignore */
        }
        action()
      }, 500)
    }

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      if (err.code === 'EADDRINUSE') {
        reject(
          new Error(
            `Port ${port} is already in use — close the app using it and try again`
          )
        )
      } else {
        reject(err)
      }
    })

    timeoutHandle = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        server.close()
      } catch {
        /* ignore */
      }
      reject(new Error('OAuth login timed out after 120 seconds'))
    }, CALLBACK_TIMEOUT_MS)

    server.listen(port, '127.0.0.1')
  })
}
