/**
 * POST /api/auth/resend-verification
 * Resends the email verification link to the authenticated user.
 *
 * Body: { email?: string } — if not provided, uses the session user's email.
 * If email is provided (no session), sends to that email (for pre-login resend).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/email'
import { secureRandomHex } from '@/lib/crypto-server'
import { getCookieFromRequest, verifySessionToken } from '@/lib/platform-auth'
import { logger } from '@/lib/logger'

const VERIFICATION_TOKEN_TTL_HOURS = 24

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    let email = body.email as string | undefined

    // If no email in body, try session
    if (!email) {
      const token = getCookieFromRequest(req)
      if (token) {
        const session = await verifySessionToken(token)
        if (session?.valid && session.userId) {
          const user = await db.platformUser.findUnique({ where: { id: session.userId } })
          if (user) email = user.email
        }
      }
    }

    if (!email) {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 })
    }

    const user = await db.platformUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!user) {
      // Don't reveal whether email exists
      return NextResponse.json({ success: true, message: 'If the email exists, a verification link has been sent.' })
    }

    if (user.emailVerified) {
      return NextResponse.json({ success: false, error: 'Email is already verified' }, { status: 400 })
    }

    // Invalidate any existing tokens
    await db.emailVerificationToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    // Create new token
    const token = secureRandomHex(32)
    const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_HOURS * 60 * 60 * 1000)

    await db.emailVerificationToken.create({
      data: { userId: user.id, token, expiresAt },
    })

    // Send email
    await sendVerificationEmail(user.email, token, user.name ?? undefined)

    logger.info({ userId: user.id }, 'Verification email resent')

    return NextResponse.json({
      success: true,
      message: 'Verification email sent. Check your inbox.',
    })
  } catch (e) {
    logger.error({ error: e }, 'Resend verification failed')
    return NextResponse.json({ success: false, error: 'Failed to send verification email' }, { status: 500 })
  }
}
