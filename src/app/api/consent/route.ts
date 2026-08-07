/**
 * POST /api/consent
 * Record user consent for biometric processing (GDPR Art. 7).
 *
 * Body: {
 *   externalUserId: string,
 *   purpose: 'authentication' | 'enrollment' | 'age_verification',
 *   granted: boolean,
 *   flowVersion?: string,
 * }
 *
 * Every enrollment MUST be preceded by a consent record.
 * Withdrawing consent (granted: false) triggers template deletion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { validateInput } from '@/lib/validation'
import { z } from 'zod'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

const ConsentSchema = z.object({
  externalUserId: z.string().min(1).max(256).regex(/^[a-zA-Z0-9_\-\.@:]+$/),
  purpose: z.enum(['authentication', 'enrollment', 'age_verification']),
  granted: z.boolean(),
  flowVersion: z.string().max(64).optional(),
})

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const validation = validateInput(ConsentSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { externalUserId, purpose, granted, flowVersion } = validation.data

  const tenantId = authResult.auth.tenantId!

  // Find or create user
  let user = await db.user.findFirst({ where: { tenantId, externalUserId } })
  if (!user) {
    const { secureRandomHex } = await import('@/lib/crypto-server')
    user = await db.user.create({
      data: {
        tenantId,
        externalUserId,
        revocationToken: secureRandomHex(32),
      },
    })
  }

  // Record consent
  const consent = await db.consentRecord.create({
    data: {
      userId: user.id,
      tenantId,
      purpose,
      granted,
      ip: authResult.ip,
      userAgent: (req.headers.get('user-agent') ?? '').slice(0, 256),
      flowVersion,
    },
  })

  await appendAudit({
    tenantId,
    eventType: 'consent.recorded',
    payload: { userId: user.id, purpose, granted, consentId: consent.id },
    apiKeyId: authResult.auth.apiKeyId,
  })

  logger.info({ tenantId, userId: user.id, purpose, granted }, 'Consent recorded')

  // If consent is withdrawn, trigger template deletion (GDPR Art. 17)
  if (!granted) {
    const revokeResult = await revokeTemplate(tenantId, externalUserId)
    if (revokeResult.deleted) {
      await appendAudit({
        tenantId,
        eventType: 'template.revoked',
        payload: {
          externalUserId,
          reason: 'consent_withdrawn',
          receipt: revokeResult.revocationReceipt,
        },
        apiKeyId: authResult.auth.apiKeyId,
      })
      logger.info({ tenantId, externalUserId }, 'Template deleted due to consent withdrawal')
    }
  }

  return NextResponse.json({
    success: true,
    consentId: consent.id,
    granted,
    purpose,
    recordedAt: consent.createdAt,
    templateDeleted: !granted,
  })
}
