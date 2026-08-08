/**
 * POST /api/attributes/issue
 * Issue an attribute credential (admin only).
 *
 * Body: {
 *   externalUserId: string,
 *   attributeType: 'age' | 'employment' | 'rate_limit' | 'custom',
 *   value: string | number,  // birth_year, employee_id, auth_count, etc.
 *   expiresAt?: string (ISO date),
 * }
 *
 * Returns: { credentialId, commitment, salt, issuedAt, expiresAt }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { issueCredential, type AttributeType } from '@/lib/attribute-proofs'
import { z } from 'zod'

const IssueSchema = z.object({
  externalUserId: z.string().min(1),
  attributeType: z.enum(['age', 'employment', 'rate_limit', 'custom']),
  value: z.union([z.string(), z.number()]),
  expiresAt: z.string().datetime().optional(),
})

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
  }

  const body = await req.json()
  const validation = IssueSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  try {
    const result = await issueCredential({
      tenantId: session.tenantId,
      externalUserId: validation.data.externalUserId,
      attributeType: validation.data.attributeType as AttributeType,
      value: validation.data.value,
      issuedBy: session.user.id,
      expiresAt: validation.data.expiresAt ? new Date(validation.data.expiresAt) : null,
    })

    return NextResponse.json({ success: true, credential: result })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
