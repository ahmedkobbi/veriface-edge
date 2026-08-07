/**
 * POST /api/templates/delete
 * GDPR Article 17 — Right to be Forgotten.
 *
 * Requires 'tenant:admin' scope (sensitive operation).
 */

import { NextRequest, NextResponse } from 'next/server'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { enqueueWebhook } from '@/lib/webhook'
import { requireApiKey } from '@/lib/auth'
import { safeErrorResponse } from '@/lib/config'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { externalUserId } = body
    const tenantId = authResult.auth.tenantId!
    if (!externalUserId) {
      return NextResponse.json(
        { success: false, error: 'externalUserId required' },
        { status: 400 },
      )
    }

    const result = await revokeTemplate(tenantId, externalUserId)

    await appendAudit({
      tenantId,
      eventType: 'template.revoked',
      payload: { externalUserId, deleted: result.deleted, receipt: result.revocationReceipt },
      apiKeyId: authResult.auth.apiKeyId,
    })

    await enqueueWebhook(tenantId, 'template.revoked', {
      externalUserId,
      deleted: result.deleted,
      receipt: result.revocationReceipt,
    })

    return NextResponse.json({
      success: true,
      deleted: result.deleted,
      revocationReceipt: result.revocationReceipt,
      backupErasureEta: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
