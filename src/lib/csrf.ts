/**
 * VeriFace Edge — CSRF Protection (Double-Submit Cookie)
 *
 * SECURITY FIX (I-3): Cookie-authenticated endpoints (those using
 * requirePlatformSession) are vulnerable to CSRF if SameSite=Strict is
 * bypassed (e.g., older browsers, or if a future change weakens the cookie).
 *
 * The double-submit cookie pattern adds defense-in-depth:
 *   1. On login, the server sets a CSRF token cookie (non-HttpOnly, so JS can read it)
 *   2. The frontend reads the cookie and includes it as an X-CSRF-Token header
 *   3. The server compares the cookie value to the header value
 *   4. An attacker can't read the cookie (same-origin policy) so can't forge the header
 *
 * This is complementary to SameSite=Strict — if one fails, the other still protects.
 *
 * Token format: 32 bytes of crypto-random, base64url-encoded (43 chars)
 */

import { NextRequest, NextResponse } from 'next/server'
import { secureRandomHex, sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

const CSRF_COOKIE_NAME = 'veriface_csrf'
const CSRF_HEADER_NAME = 'x-csrf-token'

// In production, use __Host- prefix (requires Secure + Path=/ + no Domain)
function getCsrfCookieName(): string {
  return process.env.NODE_ENV === 'production' ? `__Host-${CSRF_COOKIE_NAME}` : CSRF_COOKIE_NAME
}

/**
 * Generate a new CSRF token (32 bytes of crypto-random, hex-encoded).
 */
export function generateCsrfToken(): string {
  return secureRandomHex(32) // 64 hex chars
}

/**
 * Build the Set-Cookie header for the CSRF token.
 * The cookie is:
 *   - Non-HttpOnly (frontend JS must read it)
 *   - SameSite=Strict (same as session cookie)
 *   - Secure in production
 *   - Path=/ (so it's sent on all requests)
 */
export function buildCsrfCookieHeader(token: string): string {
  const parts = [
    `${getCsrfCookieName()}=${token}`,
    'Path=/',
    `Max-Age=${7 * 24 * 60 * 60}`, // 7 days (matches session)
    'SameSite=Strict',
    // NOT HttpOnly — frontend JS must read this to set the X-CSRF-Token header
  ]
  if (process.env.NODE_ENV === 'production') {
    parts.push('Secure')
  }
  return parts.join('; ')
}

/**
 * Build the Set-Cookie header to clear the CSRF token (on logout).
 */
export function buildClearCsrfCookieHeader(): string {
  return `${getCsrfCookieName()}=; Path=/; Max-Age=0; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

/**
 * Get the CSRF token from the request cookie.
 */
function getCsrfCookie(req: NextRequest): string | null {
  const cookieHeader = req.headers.get('cookie') ?? ''
  const cookies = cookieHeader.split(';').map((c) => c.trim())
  const cookieName = getCsrfCookieName()
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=')
    if (name === cookieName) {
      return valueParts.join('=')
    }
  }
  return null
}

/**
 * Get the CSRF token from the request header (set by frontend JS).
 */
function getCsrfHeader(req: NextRequest): string | null {
  return req.headers.get(CSRF_HEADER_NAME)
}

/**
 * Verify the CSRF token for a cookie-authenticated request.
 *
 * Double-submit pattern: the cookie value must match the header value.
 * Both must be present and equal.
 *
 * Additionally, we hash-compare (constant-time) to prevent timing attacks.
 *
 * Usage in a route handler:
 *   const csrfCheck = verifyCsrfToken(req)
 *   if (csrfCheck) return csrfCheck
 *
 * Returns a NextResponse (403) if the CSRF check fails, or null if it passes.
 */
export function verifyCsrfToken(req: NextRequest): NextResponse | null {
  const cookieToken = getCsrfCookie(req)
  const headerToken = getCsrfHeader(req)

  // Both must be present
  if (!cookieToken || !headerToken) {
    logger.warn(
      { hasCookie: !!cookieToken, hasHeader: !!headerToken },
      'CSRF verification failed — missing token',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'CSRF token missing. Ensure the X-CSRF-Token header is set.',
        code: 'CSRF_TOKEN_MISSING',
      },
      { status: 403 },
    )
  }

  // Both must be the same length (constant-time comparison prerequisite)
  if (cookieToken.length !== headerToken.length) {
    logger.warn(
      { cookieLen: cookieToken.length, headerLen: headerToken.length },
      'CSRF verification failed — token length mismatch',
    )
    return NextResponse.json(
      { success: false, error: 'CSRF token mismatch', code: 'CSRF_TOKEN_MISMATCH' },
      { status: 403 },
    )
  }

  // Constant-time comparison (prevent timing attacks)
  const cookieHash = sha256Hex(cookieToken)
  const headerHash = sha256Hex(headerToken)
  let diff = 0
  for (let i = 0; i < cookieHash.length; i++) {
    diff |= cookieHash.charCodeAt(i) ^ headerHash.charCodeAt(i)
  }
  if (diff !== 0) {
    logger.warn('CSRF verification failed — token mismatch (constant-time compare)')
    return NextResponse.json(
      { success: false, error: 'CSRF token mismatch', code: 'CSRF_TOKEN_MISMATCH' },
      { status: 403 },
    )
  }

  return null // CSRF check passed
}

/**
 * Get the CSRF token endpoint for the frontend to fetch.
 * GET /api/auth/csrf-token — returns the current CSRF token (or generates a new one).
 *
 * The frontend stores this and includes it as X-CSRF-Token on all state-changing requests.
 */
export { CSRF_HEADER_NAME, CSRF_COOKIE_NAME }
