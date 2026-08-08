/**
 * POST /api/admin/test-key
 * Developer Console: test an API key against a VeriFace endpoint.
 * Returns the raw HTTP response for debugging.
 *
 * Body: { method, path, body? }
 * Uses the tenant's first active API key to make the request.
 * Protected by platform session cookie.
 *
 * SECURITY FIX (B-03): Previously, this endpoint was vulnerable to SSRF:
 *   1. `baseUrl` was derived from `req.headers.get('host')` — client-controlled.
 *      An attacker could set `Host: attacker.com` to redirect the fetch.
 *   2. `path` was only validated with `startsWith('/api/')` — path traversal
 *      (`/api/../../internal`) could reach internal endpoints.
 *   3. Response headers were returned verbatim — leaking internal info.
 *
 * Now:
 *   1. `baseUrl` is hardcoded to `http://localhost:3000` (never trusts Host header)
 *   2. `path` is validated against an allowlist of known API routes
 *   3. The final URL is resolved and verified to point to localhost
 *   4. Response headers are filtered to a safe allowlist
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { logger } from '@/lib/logger'

const ALLOWED_METHODS = ['GET', 'POST']

// SECURITY FIX (B-03): Allowlist of API path prefixes that the test-key
// endpoint can proxy to. This prevents path traversal to internal endpoints.
const ALLOWED_PATH_PREFIXES = [
  '/api/session/init',
  '/api/session/verify',
  '/api/tenant',
  '/api/templates/',
  '/api/consent',
  '/api/attributes/',
  '/api/token/verify',
  '/api/token/revoke',
] as const

// SECURITY FIX (B-03): Hardcoded base URL — never trust the Host header.
// In production, this should be the internal service URL (e.g., http://localhost:3000
// or an internal Kubernetes service DNS name).
const INTERNAL_BASE_URL = process.env.INTERNAL_API_URL ?? 'http://localhost:3000'

// SECURITY FIX (B-03): Response headers that are safe to return to the admin.
// All other headers are stripped to prevent internal info leakage.
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type',
  'content-length',
  'cache-control',
  'etag',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-plan-tier',
  'api-version',
])

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  const { method, path, body: requestBody } = await req.json()

  // Validate method
  if (!method || !ALLOWED_METHODS.includes(method)) {
    return NextResponse.json({ success: false, error: 'Method must be GET or POST' }, { status: 400 })
  }

  // SECURITY FIX (B-03): Validate path against allowlist
  if (!path || typeof path !== 'string') {
    return NextResponse.json({ success: false, error: 'path required' }, { status: 400 })
  }

  // Reject path traversal attempts
  if (path.includes('..') || path.includes('\0') || path.includes('//')) {
    logger.warn({ tenantId, path, adminId: session.user.id }, 'test-key: path traversal attempt blocked')
    return NextResponse.json({ success: false, error: 'Invalid path' }, { status: 400 })
  }

  // Check against allowlist
  const isAllowed = ALLOWED_PATH_PREFIXES.some(prefix => path.startsWith(prefix))
  if (!isAllowed) {
    logger.warn({ tenantId, path, adminId: session.user.id }, 'test-key: path not in allowlist — blocked')
    return NextResponse.json({
      success: false,
      error: `Path must start with one of: ${ALLOWED_PATH_PREFIXES.join(', ')}`,
    }, { status: 400 })
  }

  // Get an active API key for the tenant
  const apiKey = await db.apiKey.findFirst({
    where: { tenantId, active: true },
    orderBy: { createdAt: 'desc' },
  })

  if (!apiKey) {
    return NextResponse.json({ success: false, error: 'No active API key found for this tenant' }, { status: 404 })
  }

  // SECURITY FIX (B-03): Use hardcoded INTERNAL_BASE_URL, not Host header.
  // Construct and normalize the URL, then verify it points to the expected host.
  const url = new URL(path, INTERNAL_BASE_URL)

  // Verify the resolved URL host matches the internal base URL host
  const expectedHost = new URL(INTERNAL_BASE_URL).host
  if (url.host !== expectedHost) {
    logger.warn(
      { tenantId, path, resolvedHost: url.host, expectedHost, adminId: session.user.id },
      'test-key: URL host mismatch — possible SSRF attempt blocked',
    )
    return NextResponse.json({ success: false, error: 'URL resolution error' }, { status: 400 })
  }

  try {
    // We can't use the plaintext (it's hashed) — use the session cookie instead
    // by making a server-to-server request with the X-Tenant-Id header
    const fetchOptions: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
      },
      // SECURITY FIX (B-03): Never follow redirects (SSRF via redirect)
      redirect: 'error',
    }

    if (method === 'POST' && requestBody) {
      fetchOptions.body = typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)
    }

    const start = Date.now()
    const response = await fetch(url.toString(), fetchOptions)
    const duration = Date.now() - start
    const responseText = await response.text()

    let responseData: any
    try { responseData = JSON.parse(responseText) } catch { responseData = responseText }

    // SECURITY FIX (B-03): Filter response headers — only return safe headers
    const safeHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      if (SAFE_RESPONSE_HEADERS.has(key.toLowerCase())) {
        safeHeaders[key] = value
      }
    })

    return NextResponse.json({
      success: true,
      result: {
        status: response.status,
        statusText: response.statusText,
        durationMs: duration,
        headers: safeHeaders,
        body: responseData,
      },
    })
  } catch (e) {
    logger.error({ error: e, path, method }, 'Test-key request failed')
    return NextResponse.json({
      success: false,
      error: e instanceof Error ? e.message : 'Request failed',
    }, { status: 500 })
  }
}
