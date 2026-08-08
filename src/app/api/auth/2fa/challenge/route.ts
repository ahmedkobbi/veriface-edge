/**
 * POST /api/auth/2fa/challenge
 * Completes login for users with 2FA enabled.
 *
 * Flow:
 *   1. User submits email + password → /api/auth/login
 *   2. If 2FA enabled, login returns { requiresTwoFactor: true, pendingToken: ... }
 *   3. User submits TOTP code → POST /api/auth/2fa/challenge { pendingToken, code }
 *   4. Server verifies TOTP → issues full session cookie
 *
 * Body: { pendingToken: string, code: string }
 *   - code can be 6-digit TOTP OR backup code (XXXX-XXXX)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyTOTP, verifyBackupCode, consumeBackupCode, verifyTwoFactorPendingToken } from '@/lib/totp'
import { createSessionToken, buildCookieHeader, toPublicUser } from '@/lib/platform-auth'
import { appendAudit } from '@/lib/audit'
import { decryptField } from '@/lib/field-encryption'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const ChallengeSchema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(1),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validation = ChallengeSchema.safeParse(body)
    if (!validation.success) {
      return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
    }

    const { pendingToken, code } = validation.data

    // Verify the pending token
    const pending = await verifyTwoFactorPendingToken(pendingToken)
    if (!pending) {
      return NextResponse.json({ success: false, error: 'Invalid or expired challenge token' }, { status: 401 })
    }

    // Get user
    const user = await db.platformUser.findUnique({ where: { id: pending.userId } })
    if (!user || !user.twoFactorEnabled) {
      return NextResponse.json({ success: false, error: '2FA not enabled for this user' }, { status: 400 })
    }

    // Try TOTP code first (6 digits)
    const isNumeric6 = /^\d{6}$/.test(code)
    let verified = false
    let backupUsed = false

    if (isNumeric6 && user.twoFactorSecret) {
      // SECURITY FIX (M-5): Decrypt the TOTP secret before verification.
      const totpSecret = decryptField(user.twoFactorSecret)
      if (totpSecret) {
        verified = verifyTOTP(code, totpSecret, user.id)
      }
    }

    // If TOTP didn't work, try backup code
    if (!verified && user.twoFactorBackupCodes) {
      const hashedCodes: string[] = JSON.parse(user.twoFactorBackupCodes)
      const index = verifyBackupCode(code, hashedCodes)
      if (index >= 0) {
        const remaining = consumeBackupCode(hashedCodes, index)
        await db.platformUser.update({
          where: { id: user.id },
          data: { twoFactorBackupCodes: JSON.stringify(remaining) },
        })
        verified = true
        backupUsed = true

        // Warn if running low on backup codes
        if (remaining.length <= 3) {
          logger.warn({ userId: user.id, remaining: remaining.length }, 'Backup codes running low')
        }
      }
    }

    if (!verified) {
      await appendAudit({
        tenantId: user.tenantId ?? '',
        eventType: 'auth.failure',
        payload: { reason: '2FA_CODE_INVALID', userId: user.id, email: user.email },
      })
      return NextResponse.json({ success: false, error: 'Invalid verification code' }, { status: 401 })
    }

    // Update lastLoginAt
    await db.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    })

    // Issue full session token
    const sessionToken = await createSessionToken(user.id, user.email, user.tenantId)

    await appendAudit({
      tenantId: user.tenantId ?? '',
      eventType: 'auth.success',
      payload: { userId: user.id, method: backupUsed ? 'backup_code' : 'totp' },
    })

    logger.info({ userId: user.id, method: backupUsed ? 'backup_code' : 'totp' }, '2FA login successful')

    const response = NextResponse.json({
      success: true,
      user: toPublicUser(user),
      backupUsed,
      remainingBackupCodes: backupUsed
        ? JSON.parse(user.twoFactorBackupCodes ?? '[]').length - 1
        : undefined,
    })
    response.headers.set('Set-Cookie', buildCookieHeader(sessionToken))
    return response
  } catch (e) {
    logger.error({ error: e }, '2FA challenge failed')
    return NextResponse.json({ success: false, error: 'Challenge failed' }, { status: 500 })
  }
}
