/**
 * POST /api/attributes/revoke
 * Revoke an attribute credential (admin only).
 *
 * Body: { credentialId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { revokeCredential } from '@/lib/attribute-proofs'
import { z } from 'zod'

const RevokeSchema = z.object({
  credentialId: z.string().min(1),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const validation = RevokeSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const revoked = await revokeCredential(session.tenantId, validation.data.credentialId)

  return NextResponse.json({ success: true, revoked })
}
