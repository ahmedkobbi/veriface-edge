/**
 * POST /api/auth/login
 * Authenticate a platform user with email + password.
 *
 * Body: { email, password }
 * Returns: { user } + sets session cookie
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPassword,
  createSessionToken,
  buildCookieHeader,
  toPublicUser,
} from '@/lib/platform-auth'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json({ success: false, error: 'Email and password required' }, { status: 400 })
    }

    const user = await db.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    })

    if (!user) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return NextResponse.json({ success: false, error: 'Invalid credentials' }, { status: 401 })
    }

    // Update lastLoginAt
    await db.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Issue session token
    const token = await createSessionToken(user.id, user.email, user.tenantId)

    logger.info({ userId: user.id, email: user.email }, 'User logged in')

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
    })
    response.headers.set('Set-Cookie', buildCookieHeader(token))
    return response
  } catch (e) {
    logger.error({ error: e }, 'Login failed')
    return NextResponse.json(safeErrorResponse(e), { status: 500 })
  }
}
