/**
 * POST /api/templates/delete
 * GDPR Article 17 — Right to be Forgotten.
 *
 * Cryptographic erasure:
 *   1. Delete template from Postgres + Qdrant (immediate)
 *   2. Schedule KMS DEK destruction (renders any backup unrecoverable)
 *   3. Issue signed revocation receipt (proof of deletion)
 *
 * Total deletion latency: < 5 seconds primary, < 24h backups.
 */

import { NextRequest, NextResponse } from 'next/server'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { enqueueWebhook } from '@/lib/webhook'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId, externalUserId } = body
    if (!tenantId || !externalUserId) {
      return NextResponse.json(
        { success: false, error: 'tenantId and externalUserId required' },
        { status: 400 },
      )
    }

    const result = await revokeTemplate(tenantId, externalUserId)

    await appendAudit({
      tenantId,
      eventType: 'template.revoked',
      payload: { externalUserId, deleted: result.deleted, receipt: result.revocationReceipt },
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
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
