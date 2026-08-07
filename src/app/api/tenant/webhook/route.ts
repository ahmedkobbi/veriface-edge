/**
 * POST /api/tenant/webhook
 * Configure the webhook URL. SSRF-validated before storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { appendAudit } from '@/lib/audit'
import { secureRandomHex } from '@/lib/crypto-server'
import { validateWebhookUrl } from '@/lib/ssrf'
import { validateInput, TenantWebhookSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const validation = validateInput(TenantWebhookSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { webhookUrl, webhookSecret } = validation.data
  const tenantId = authResult.auth.tenantId!

  // SSRF validation on webhook URL
  if (webhookUrl !== null) {
    const ssrfCheck = await validateWebhookUrl(webhookUrl)
    if (!ssrfCheck.allowed) {
      logger.warn(
        { tenantId, url: webhookUrl, reason: ssrfCheck.reason },
        'Webhook URL rejected by SSRF protection',
      )
      return NextResponse.json(
        {
          success: false,
          error: `Webhook URL rejected: ${ssrfCheck.reason}`,
          code: 'SSRF_BLOCKED',
        },
        { status: 400 },
      )
    }
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
    eventType: webhookSecret === 'rotate' ? 'webhook.secret_rotated' : 'webhook.url_updated',
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
}
