/**
 * GET /api/auth/me
 * Returns the currently authenticated platform user (from session cookie).
 *
 * Returns: { user } or 401 if not authenticated.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCookieFromRequest, verifySessionToken, toPublicUser } from '@/lib/platform-auth'

export async function GET(req: NextRequest) {
  const token = getCookieFromRequest(req)
  if (!token) {
    return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
  }

  const session = await verifySessionToken(token)
  if (!session || !session.valid) {
    return NextResponse.json({ success: false, error: 'Session expired' }, { status: 401 })
  }

  const user = await db.platformUser.findUnique({
    where: { id: session.userId! },
  })

  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 401 })
  }

  return NextResponse.json({
    success: true,
    user: toPublicUser(user),
  })
}
