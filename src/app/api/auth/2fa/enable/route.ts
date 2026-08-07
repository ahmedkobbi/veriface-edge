/**
 * POST /api/auth/2fa/enable
 * Completes 2FA setup — verifies the TOTP code, stores the secret,
 * generates backup codes, and marks 2FA as enabled.
 *
 * Body: { secret: string, code: string }
 * Returns: { backupCodes: string[] } (shown ONCE — user must save them)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { verifyTOTP, generateBackupCodes } from '@/lib/totp'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const Enable2FASchema = z.object({
  secret: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = Enable2FASchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { secret, code } = validation.data

  // Verify the TOTP code against the secret
  if (!verifyTOTP(code, secret)) {
    return NextResponse.json({ success: false, error: 'Invalid verification code. Make sure your device time is correct.' }, { status: 400 })
  }

  // Check if 2FA is already enabled
  const user = await db.platformUser.findUnique({ where: { id: session.user.id } })
  if (user?.twoFactorEnabled) {
    return NextResponse.json({ success: false, error: '2FA is already enabled' }, { status: 400 })
  }

  // Generate backup codes
  const { plaintext: backupCodes, hashed: hashedBackupCodes } = generateBackupCodes()

  // Store secret + backup codes + enable 2FA
  await db.platformUser.update({
    where: { id: session.user.id },
    data: {
      twoFactorSecret: secret,
      twoFactorEnabled: true,
      twoFactorBackupCodes: JSON.stringify(hashedBackupCodes),
    },
  })

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: '2fa_enabled', userId: session.user.id },
  })

  logger.info({ userId: session.user.id }, '2FA enabled')

  return NextResponse.json({
    success: true,
    message: '2FA enabled successfully. Save your backup codes — they can be used if you lose your authenticator device.',
    backupCodes,
  })
}
