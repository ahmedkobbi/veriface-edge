/**
 * POST /api/auth/2fa/webauthn/begin
 * Start WebAuthn 2FA authentication (generate challenge).
 *
 * Called after login returns { requiresTwoFactor: true, twoFactorMethods: { webauthn: true } }
 * The client uses the returned options to call navigator.credentials.get().
 *
 * Body: { pendingToken: string }
 * Returns: { options: WebAuthnAuthenticationOptions }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { beginPlatformUserWebAuthnAuth } from '@/lib/webauthn'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const BeginSchema = z.object({
  pendingToken: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const body = await req.json()
  const validation = BeginSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const { pendingToken } = validation.data

  // Parse the JWT to extract user ID
  const parts = pendingToken.split('.')
  if (parts.length !== 3) {
    return NextResponse.json(
      { success: false, error: 'Invalid token format' },
      { status: 401 },
    )
  }

  const payloadB64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
  const payloadBin = atob(payloadB64)
  const payloadBytes = new Uint8Array(payloadBin.length)
  for (let i = 0; i < payloadBin.length; i++) payloadBytes[i] = payloadBin.charCodeAt(i)
  const claims = JSON.parse(new TextDecoder().decode(payloadBytes))

  if (claims.type !== 'two_factor_pending') {
    return NextResponse.json(
      { success: false, error: 'Not a 2FA pending token' },
      { status: 401 },
    )
  }

  const now = Math.floor(Date.now() / 1000)
  if (claims.exp && claims.exp < now) {
    return NextResponse.json(
      { success: false, error: 'Pending token expired' },
      { status: 401 },
    )
  }

  const userId = claims.sub

  // Check user exists
  const user = await db.platformUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true },
  })

  if (!user) {
    return NextResponse.json(
      { success: false, error: 'User not found' },
      { status: 404 },
    )
  }

  // Generate WebAuthn authentication options
  const result = await beginPlatformUserWebAuthnAuth(userId)

  if (result.error || !result.options) {
    return NextResponse.json(
      { success: false, error: result.error ?? 'Failed to generate options' },
      { status: 400 },
    )
  }

  logger.info({ userId, email: user.email }, 'WebAuthn 2FA challenge generated')

  return NextResponse.json({
    success: true,
    options: result.options,
  })
}
