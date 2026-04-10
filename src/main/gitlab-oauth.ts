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
import * as https from 'https'
import { shell } from 'electron'

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

// ─── End-to-end OAuth flow ────────────────────────────────────────────────

/** Scopes we request from GitLab. `api` covers MR/project operations,
 *  `read_user` gives us /api/v4/user. */
const OAUTH_SCOPES = 'api read_user'

export interface GitLabOAuthUser {
  id: number
  username: string
  name: string
  email?: string
  avatar_url?: string
  web_url?: string
}

export interface OAuthFlowResult {
  user: GitLabOAuthUser
  accessToken: string
  refreshToken: string
  /** Absolute expiry in ms since epoch (Date.now() + expires_in*1000). */
  expiresAt: number
  /** The instance URL used — echoed back for convenience. */
  instanceUrl: string
}

export interface StartOAuthFlowOptions {
  instanceUrl: string
  clientId: string
}

/**
 * POST a JSON body to the given absolute URL and resolve with the parsed
 * JSON response. Used for the /oauth/token endpoint which is outside the
 * /api/v4 path so the existing gitlabApiRequest helper does not apply.
 */
function postJson(
  absoluteUrl: string,
  body: Record<string, string>
): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL(absoluteUrl)
    } catch (err) {
      reject(err)
      return
    }
    const isHttps = url.protocol === 'https:'
    const mod: typeof https | typeof http = isHttps ? https : http
    const payload = JSON.stringify(body)
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'User-Agent': 'GitSlop'
        }
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => {
          chunks += c
        })
        res.on('end', () => {
          let parsed: unknown = null
          try {
            parsed = chunks ? JSON.parse(chunks) : null
          } catch {
            parsed = { raw: chunks }
          }
          resolve({ statusCode: res.statusCode || 0, data: parsed })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => {
      req.destroy()
      reject(new Error('OAuth token request timed out'))
    })
    req.write(payload)
    req.end()
  })
}

/**
 * GET /api/v4/user using a Bearer access token and resolve with the parsed
 * user JSON. We use Bearer (not PRIVATE-TOKEN) because OAuth access tokens
 * are used via the Authorization header.
 */
function fetchOAuthUser(
  instanceUrl: string,
  accessToken: string
): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    let url: URL
    try {
      url = new URL('/api/v4/user', instanceUrl)
    } catch (err) {
      reject(err)
      return
    }
    const isHttps = url.protocol === 'https:'
    const mod: typeof https | typeof http = isHttps ? https : http
    const req = mod.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
          'User-Agent': 'GitSlop'
        }
      },
      (res) => {
        let chunks = ''
        res.on('data', (c) => {
          chunks += c
        })
        res.on('end', () => {
          let parsed: unknown = null
          try {
            parsed = chunks ? JSON.parse(chunks) : null
          } catch {
            parsed = { raw: chunks }
          }
          resolve({ statusCode: res.statusCode || 0, data: parsed })
        })
      }
    )
    req.on('error', reject)
    req.setTimeout(15_000, () => {
      req.destroy()
      reject(new Error('GitLab user request timed out'))
    })
    req.end()
  })
}

function normalizeInstanceUrl(raw: string): string {
  const trimmed = (raw || '').trim().replace(/\/+$/, '')
  if (!trimmed) return 'https://gitlab.com'
  if (!/^https?:\/\//.test(trimmed)) return `https://${trimmed}`
  return trimmed
}

/**
 * Run the full GitLab OAuth PKCE flow: open the authorize URL in the
 * default browser, capture the callback on the loopback server, exchange
 * the code for tokens, and fetch the user profile.
 *
 * Throws on any failure (state mismatch, token exchange error, etc.) —
 * callers should wrap in try/catch and surface the error to the UI.
 */
export async function startOAuthFlow(
  opts: StartOAuthFlowOptions
): Promise<OAuthFlowResult> {
  const instanceUrl = normalizeInstanceUrl(opts.instanceUrl)
  const clientId = (opts.clientId || '').trim()
  if (!clientId) {
    throw new Error('Missing OAuth Application ID (clientId)')
  }

  const { verifier, challenge } = generatePkcePair()
  const state = generateState()

  const authorizeUrl = new URL('/oauth/authorize', instanceUrl)
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', LOOPBACK_REDIRECT_URI)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('state', state)
  authorizeUrl.searchParams.set('scope', OAUTH_SCOPES)
  authorizeUrl.searchParams.set('code_challenge', challenge)
  authorizeUrl.searchParams.set('code_challenge_method', 'S256')

  // Start the loopback server BEFORE opening the browser so we never lose
  // a fast redirect. The callback promise is what we await.
  const callbackPromise = startLoopbackServer(LOOPBACK_PORT)

  try {
    await shell.openExternal(authorizeUrl.toString())
  } catch (err) {
    // If we can't open the browser, nothing will ever hit the loopback
    // server — fail fast rather than wait out the 120s timeout.
    throw new Error(
      `Failed to open browser for GitLab login: ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  const { code, state: returnedState } = await callbackPromise

  if (returnedState !== state) {
    throw new Error('OAuth state mismatch — possible CSRF, aborting login')
  }

  const tokenUrl = new URL('/oauth/token', instanceUrl).toString()
  const tokenRes = await postJson(tokenUrl, {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: LOOPBACK_REDIRECT_URI,
    code_verifier: verifier
  })

  if (tokenRes.statusCode < 200 || tokenRes.statusCode >= 300) {
    const body = tokenRes.data as { error?: string; error_description?: string } | null
    const msg =
      (body && (body.error_description || body.error)) ||
      `Token exchange failed with HTTP ${tokenRes.statusCode}`
    throw new Error(msg)
  }

  const tokenBody = tokenRes.data as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    token_type?: string
  } | null

  if (!tokenBody || !tokenBody.access_token) {
    throw new Error('Token exchange returned no access_token')
  }

  const accessToken = tokenBody.access_token
  const refreshToken = tokenBody.refresh_token || ''
  const expiresIn =
    typeof tokenBody.expires_in === 'number' && tokenBody.expires_in > 0
      ? tokenBody.expires_in
      : 7200 // GitLab default
  const expiresAt = Date.now() + expiresIn * 1000

  const userRes = await fetchOAuthUser(instanceUrl, accessToken)
  if (userRes.statusCode !== 200 || !userRes.data) {
    throw new Error(
      `Failed to fetch user profile (HTTP ${userRes.statusCode})`
    )
  }
  const user = userRes.data as GitLabOAuthUser

  return {
    user,
    accessToken,
    refreshToken,
    expiresAt,
    instanceUrl
  }
}
