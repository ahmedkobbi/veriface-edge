/**
 * POST /api/auth/2fa/disable
 * Disables 2FA — requires either a valid TOTP code or a backup code.
 * Clears the stored secret + backup codes.
 *
 * Body: { code: string } — 6-digit TOTP code OR backup code (XXXX-XXXX)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { verifyTOTP, verifyBackupCode, consumeBackupCode } from '@/lib/totp'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const Disable2FASchema = z.object({
  code: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = Disable2FASchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { code } = validation.data

  const user = await db.platformUser.findUnique({ where: { id: session.user.id } })
  if (!user?.twoFactorEnabled) {
    return NextResponse.json({ success: false, error: '2FA is not enabled' }, { status: 400 })
  }

  // Try TOTP code first (6 digits)
  const isNumeric6 = /^\d{6}$/.test(code)
  let verified = false

  if (isNumeric6 && user.twoFactorSecret) {
    verified = verifyTOTP(code, user.twoFactorSecret)
  }

  // If TOTP didn't work, try backup code
  if (!verified && user.twoFactorBackupCodes) {
    const hashedCodes: string[] = JSON.parse(user.twoFactorBackupCodes)
    const index = verifyBackupCode(code, hashedCodes)
    if (index >= 0) {
      // Consume the backup code
      const remaining = consumeBackupCode(hashedCodes, index)
      verified = true

      // If this was the last backup code, warn the user
      if (remaining.length === 0) {
        // Still disable — but log a warning
        logger.warn({ userId: session.user.id }, '2FA disabled using last backup code')
      }
    }
  }

  if (!verified) {
    return NextResponse.json({ success: false, error: 'Invalid verification code' }, { status: 401 })
  }

  // Disable 2FA + clear secrets
  await db.platformUser.update({
    where: { id: session.user.id },
    data: {
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
    },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: '2fa_disabled', userId: session.user.id },
  })

  logger.info({ userId: session.user.id }, '2FA disabled')

  return NextResponse.json({
    success: true,
    message: '2FA has been disabled. Your account is now protected by password only.',
  })
}
