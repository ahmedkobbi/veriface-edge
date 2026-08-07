/**
 * POST /api/auth/2fa/setup
 * Initiates 2FA setup — generates a TOTP secret + QR code.
 *
 * Requires authenticated session. Returns:
 *   - secret (base32, for manual entry)
 *   - qrCodeUrl (data URL PNG for scanning)
 *   - otpauthUrl (for custom QR rendering)
 *
 * Does NOT enable 2FA yet — user must verify a code first (see /2fa/enable).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { generateTOTPSecret, generateOTPAuthURL, generateQRCodeDataUrl } from '@/lib/totp'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Check if 2FA is already enabled
  if (session.user.role !== 'admin' && session.user.role !== 'user') {
    return NextResponse.json({ success: false, error: 'Invalid user role' }, { status: 403 })
  }

  // Generate TOTP secret
  const secret = generateTOTPSecret()
  const otpauthUrl = generateOTPAuthURL(session.user.email, secret)
  const qrCodeUrl = await generateQRCodeDataUrl(otpauthUrl)

  logger.info({ userId: session.user.id }, '2FA setup initiated')

  return NextResponse.json({
    success: true,
    secret,
    qrCodeUrl,
    otpauthUrl,
    message: 'Scan the QR code with your authenticator app, then enter the 6-digit code to enable 2FA.',
  })
}
