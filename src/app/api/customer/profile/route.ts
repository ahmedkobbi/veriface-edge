/**
 * GET /api/customer/profile
 * Returns the user's biometric profile status (enrolled? model version, consent records).
 *
 * DELETE /api/customer/profile
 * Delete the user's biometric template (self-service GDPR Art. 17).
 * Also revokes all consent and audit-logs the deletion.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const externalUserId = session.user.email
  const biometricUser = await db.user.findFirst({
    where: { tenantId: session.tenantId, externalUserId },
    include: {
      templates: { select: { id: true, createdAt: true, lastUsedAt: true, modelVersion: true, variant: true } },
      webauthnCreds: { select: { id: true, aaguid: true, deviceType: true, createdAt: true, lastUsedAt: true } },
    },
  })

  if (!biometricUser) {
    return NextResponse.json({
      success: true,
      enrolled: false,
      profile: null,
      consentHistory: [],
      webauthnCredentials: [],
    })
  }

  return NextResponse.json({
    success: true,
    enrolled: biometricUser.templates.length > 0,
    profile: {
      userId: biometricUser.id,
      externalUserId: biometricUser.externalUserId,
      enrolledAt: biometricUser.templates[0]?.createdAt ?? null,
      lastUsedAt: biometricUser.templates[0]?.lastUsedAt ?? null,
      modelVersion: biometricUser.templates[0]?.modelVersion ?? null,
      variant: biometricUser.templates[0]?.variant ?? null,
      accountCreatedAt: biometricUser.createdAt,
    },
    consentHistory: [],
    webauthnCredentials: biometricUser.webauthnCreds.map((c) => ({
      id: c.id,
      deviceType: c.deviceType,
      aaguid: c.aaguid,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    })),
  })
}

export async function DELETE(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const externalUserId = session.user.email

  const result = await revokeTemplate(session.tenantId, externalUserId)

  if (!result.deleted) {
    return NextResponse.json({
      success: false,
      error: 'No biometric template found to delete',
    }, { status: 404 })
  }

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'template.revoked',
    payload: {
      externalUserId,
      selfService: true,
      userId: session.user.id,
      receipt: result.revocationReceipt,
    },
  })

  logger.info({ userId: session.user.id, externalUserId }, 'Customer self-deleted biometric template')

  return NextResponse.json({
    success: true,
    deleted: true,
    revocationReceipt: result.revocationReceipt,
    message: 'Your biometric template has been permanently deleted. Crypto-erasure initiated.',
  })
}
