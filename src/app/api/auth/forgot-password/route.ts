/**
 * POST /api/auth/forgot-password
 * Initiates password reset by sending a reset link to the user's email.
 *
 * Body: { email: string }
 * Returns 200 always (don't reveal whether email exists).
 *
 * Token is single-use, expires after 1 hour.
 * Only one active token per user (previous ones are invalidated).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendPasswordResetEmail } from '@/lib/email'
import { secureRandomHex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

const RESET_TOKEN_TTL_MINUTES = 60

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email } = body

    if (!email || typeof email !== 'string') {
      return NextResponse.json({ success: false, error: 'Email required' }, { status: 400 })
    }

    const user = await db.platformUser.findUnique({
      where: { email: email.toLowerCase() },
    })

    // Always return success — don't reveal whether email exists
    if (!user) {
      logger.info({ email }, 'Password reset requested for non-existent email')
      return NextResponse.json({
        success: true,
        message: 'If the email exists, a reset link has been sent.',
      })
    }

    // Invalidate any existing reset tokens
    await db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    })

    // Create new token
    const token = secureRandomHex(32)
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000)

    await db.passwordResetToken.create({
      data: { userId: user.id, token, expiresAt },
    })

    // Send email
    await sendPasswordResetEmail(user.email, token, user.name ?? undefined)

    logger.info({ userId: user.id }, 'Password reset email sent')

    return NextResponse.json({
      success: true,
      message: 'If the email exists, a reset link has been sent.',
    })
  } catch (e) {
    logger.error({ error: e }, 'Forgot password failed')
    return NextResponse.json({ success: false, error: 'Failed to process request' }, { status: 500 })
  }
}
