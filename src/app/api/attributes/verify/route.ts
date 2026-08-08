/**
 * POST /api/attributes/verify
 * Verify an attribute ZK proof.
 *
 * Body: {
 *   credentialId: string,
 *   proof: PLONK proof object,
 *   publicSignals: string[],
 * }
 *
 * Returns: { valid: boolean, attributeType: string, error?: string }
 *
 * The verifier learns ONLY whether the attribute holds — NOT the actual value.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { verifyAttributeProof } from '@/lib/attribute-proofs'
import { z } from 'zod'

const VerifySchema = z.object({
  credentialId: z.string().min(1),
  proof: z.any(),
  publicSignals: z.array(z.string()),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const body = await req.json()
  const validation = VerifySchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const result = await verifyAttributeProof(session.tenantId, {
    credentialId: validation.data.credentialId,
    proof: validation.data.proof,
    publicSignals: validation.data.publicSignals,
  })

  return NextResponse.json({ success: true, ...result })
}
