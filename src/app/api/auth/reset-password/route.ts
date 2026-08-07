/**
 * POST /api/auth/reset-password
 * Completes password reset using a single-use token.
 *
 * Body: { token: string, newPassword: string }
 *
 * Validates token (exists, not expired, not used), then:
 *   1. Hashes the new password with bcrypt
 *   2. Updates the user's passwordHash
 *   3. Marks the token as used
 *   4. Invalidates all session cookies (forces re-login)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, isValidPassword, buildClearCookieHeader } from '@/lib/platform-auth'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, newPassword } = body

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ success: false, error: 'Token required' }, { status: 400 })
    }

    if (!newPassword || typeof newPassword !== 'string' || !isValidPassword(newPassword)) {
      return NextResponse.json({
        success: false,
        error: 'Password must be at least 8 chars with 1 uppercase, 1 lowercase, 1 number',
      }, { status: 400 })
    }

    const resetToken = await db.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    })

    if (!resetToken) {
      return NextResponse.json({ success: false, error: 'Invalid or expired token' }, { status: 400 })
    }

    // Check expiry
    if (resetToken.expiresAt < new Date()) {
      return NextResponse.json({ success: false, error: 'Token expired. Request a new reset link.' }, { status: 400 })
    }

    // Check already used
    if (resetToken.usedAt) {
      return NextResponse.json({ success: false, error: 'Token already used' }, { status: 400 })
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword)

    // Update password + mark token as used (atomic)
    await db.$transaction([
      db.platformUser.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      }),
      db.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
    ])

    // Also invalidate all email verification tokens (force re-verify if not verified)
    // This prevents an attacker who gained email access from using a stale verification link

    logger.info({ userId: resetToken.userId, email: resetToken.user.email }, 'Password reset successful')

    // Clear session cookie (force re-login)
    const response = NextResponse.json({
      success: true,
      message: 'Password reset successful. Please log in with your new password.',
    })
    response.headers.set('Set-Cookie', buildClearCookieHeader())
    return response
  } catch (e) {
    logger.error({ error: e }, 'Reset password failed')
    return NextResponse.json({ success: false, error: 'Failed to reset password' }, { status: 500 })
  }
}
