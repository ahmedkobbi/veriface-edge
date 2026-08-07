/**
 * POST /api/tenant/webhook
 * Configure the webhook URL for the authenticated tenant.
 *
 * Body: { webhookUrl: string (null to disable), webhookSecret?: string (rotate) }
 *
 * The webhook URL receives signed event notifications (enroll.completed,
 * auth.success, auth.failure, template.revoked, etc.).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { secureRandomHex } from '@/lib/crypto-server'

const WEBHOOK_URL_REGEX = /^https:\/\/.+/i

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { webhookUrl, webhookSecret } = body
    const tenantId = authResult.auth.tenantId!

    if (webhookUrl !== null && (typeof webhookUrl !== 'string' || !WEBHOOK_URL_REGEX.test(webhookUrl))) {
      return NextResponse.json(
        { success: false, error: 'webhookUrl must be an HTTPS URL or null to disable' },
        { status: 400 },
      )
    }

    const updates: { webhookUrl?: string | null; webhookSecret?: string } = {}
    if (webhookUrl !== undefined) {
      updates.webhookUrl = webhookUrl
    }
    if (webhookSecret === 'rotate') {
      updates.webhookSecret = secureRandomHex(32)
    }

    await db.tenant.update({
      where: { id: tenantId },
      data: updates,
    })

    await appendAudit({
      tenantId,
      eventType: 'key.rotated',
      payload: {
        webhookUrlSet: webhookUrl !== undefined,
        webhookSecretRotated: webhookSecret === 'rotate',
      },
      apiKeyId: authResult.auth.apiKeyId,
    })

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })

    return NextResponse.json({
      success: true,
      webhookUrl: tenant?.webhookUrl ?? null,
      webhookSecret: webhookSecret === 'rotate' ? tenant?.webhookSecret : undefined,
      message: webhookSecret === 'rotate'
        ? 'New webhook secret returned ONCE. Update your receiver to verify signatures.'
        : undefined,
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
