/**
 * POST /api/auth/signup
 * Create a new platform user account + auto-provision a tenant + API key.
 *
 * Body: { email, password, name? }
 * Returns: { user, tenant, apiKey } + sets session cookie
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  createPlatformUserWithTenant,
  isValidEmail,
  isValidPassword,
  createSessionToken,
  buildCookieHeader,
  toPublicUser,
} from '@/lib/platform-auth'
import { safeErrorResponse } from '@/lib/config'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name } = body

    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      return NextResponse.json({ success: false, error: 'Valid email required' }, { status: 400 })
    }

    if (!password || typeof password !== 'string' || !isValidPassword(password)) {
      return NextResponse.json({
        success: false,
        error: 'Password must be at least 8 chars with 1 uppercase, 1 lowercase, 1 number',
      }, { status: 400 })
    }

    // Check if email already exists
    const existing = await db.platformUser.findUnique({ where: { email: email.toLowerCase() } })
    if (existing) {
      return NextResponse.json({ success: false, error: 'Email already registered' }, { status: 409 })
    }

    // Create user + tenant + API key
    const result = await createPlatformUserWithTenant({ email, password, name })

    // Issue session token
    const token = await createSessionToken(result.user.id, result.user.email, result.tenant.id)

    logger.info({ userId: result.user.id }, 'User signed up')

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(result.user),
      tenant: {
        id: result.tenant.id,
        name: result.tenant.name,
        signingPubKey: result.tenant.signingPubKey,
      },
      apiKey: result.apiKey,
    })
    response.headers.set('Set-Cookie', buildCookieHeader(token))
    return response
  } catch (e) {
    logger.error({ error: e }, 'Signup failed')
    return NextResponse.json(safeErrorResponse(e), { status: 500 })
  }
}
