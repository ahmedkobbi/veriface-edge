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

export async function requirePlatformSession(
  req: NextRequest,
): Promise<PlatformSession | PlatformSessionError> {
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
