/**
 * GET /api/auth/verify-email?token=xxx
 * Verifies a user's email address using a single-use token.
 *
 * The token is looked up in EmailVerificationToken table, verified
 * for expiry + not-already-used, then marks the user as emailVerified=true.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const token = url.searchParams.get('token')

  if (!token) {
    return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 })
  }

  const verificationToken = await db.emailVerificationToken.findUnique({
    where: { token },
    include: { user: true },
  })

  if (!verificationToken) {
    return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 400 })
  }

  // Check expiry
  if (verificationToken.expiresAt < new Date()) {
    return NextResponse.json({ success: false, error: 'Token expired. Request a new verification email.' }, { status: 400 })
  }

  // Check already used
  if (verificationToken.usedAt) {
    return NextResponse.json({ success: false, error: 'Token already used' }, { status: 400 })
  }

  // Mark token as used + verify user email
  await db.$transaction([
    db.emailVerificationToken.update({
      where: { id: verificationToken.id },
      data: { usedAt: new Date() },
    }),
    db.platformUser.update({
      where: { id: verificationToken.userId },
      data: { emailVerified: true },
    }),
  ])

  logger.info({ userId: verificationToken.userId, email: verificationToken.user.email }, 'Email verified')

  return NextResponse.json({
    success: true,
    message: 'Email verified successfully. You can now access all features.',
  })
}
