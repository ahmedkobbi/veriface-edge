/**
 * VeriFace Edge — Platform Session Authentication
 *
 * Middleware for admin API routes. Verifies the session cookie
 * and attaches the authenticated platform user + tenant to the request.
 *
 * Usage:
 *   const session = await requirePlatformSession(req)
 *   if (!session.ok) return session.response
 *   const { user, tenantId } = session
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCookieFromRequest, verifySessionToken } from '@/lib/platform-auth'
import { verifyCsrfToken } from '@/lib/csrf'
import { logger } from '@/lib/logger'

export interface PlatformSession {
  ok: true
  user: {
    id: string
    email: string
    name: string | null
    role: string
    tenantId: string | null
  }
  tenantId: string
}

export interface PlatformSessionError {
  ok: false
  response: NextResponse
}

// SECURITY FIX (I-3): CSRF protection for cookie-authenticated state-changing requests.
// GET/HEAD/OPTIONS are safe methods (no state change) — no CSRF token required.
// POST/PUT/PATCH/DELETE require a valid X-CSRF-Token header matching the CSRF cookie.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function requirePlatformSession(
  req: NextRequest,
): Promise<PlatformSession | PlatformSessionError> {
  // SECURITY FIX (I-3): Enforce CSRF token on state-changing methods.
  // This is defense-in-depth on top of SameSite=Strict (L-1 fix).
  if (!SAFE_METHODS.has(req.method.toUpperCase())) {
    const csrfError = verifyCsrfToken(req)
    if (csrfError) {
      return { ok: false, response: csrfError }
    }
  }

  const token = getCookieFromRequest(req)
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Not authenticated', code: 'NO_SESSION' },
        { status: 401 },
      ),
    }
  }

  const session = await verifySessionToken(token)
  if (!session || !session.valid || !session.userId) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Session expired', code: 'SESSION_EXPIRED' },
        { status: 401 },
      ),
    }
  }

  const user = await db.platformUser.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
    },
  })

  if (!user || !user.tenantId) {
    logger.warn({ userId: session.userId }, 'Platform session user not found or no tenant')
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'User not found or no tenant', code: 'NO_TENANT' },
        { status: 403 },
      ),
    }
  }

  return {
    ok: true,
    user: user as any,
    tenantId: user.tenantId,
  }
}
