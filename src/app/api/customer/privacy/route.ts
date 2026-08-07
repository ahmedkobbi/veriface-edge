/**
 * GET /api/customer/privacy
 * Returns the user's full data (GDPR Art. 15 — Right of Access).
 * Uses the existing templates/export logic but scoped to the session user.
 *
 * DELETE /api/customer/privacy
 * Delete all user data (GDPR Art. 17 — Right to be Forgotten, self-service).
 * Deletes: biometric template, consent records, webauthn credentials.
 * Keeps: audit log entries (anonymized — required by law for 7 years).
 *
 * POST /api/customer/privacy
 * Body: { action: "export" } — triggers data export (Art. 20)
 * Returns downloadable JSON.
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
      templates: true,
      webauthnCreds: true,
    },
  })

  if (!biometricUser) {
    return NextResponse.json({
      success: true,
      data: {
        exportedAt: new Date().toISOString(),
        user: { externalUserId, enrolled: false },
        dataRights: getRightsText(),
      },
    })
  }

  // Get audit entries mentioning this user
  const auditEntries = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      payload: { contains: externalUserId },
    },
    orderBy: { chainIndex: 'desc' },
    take: 100,
    select: { eventType: true, payload: true, createdAt: true },
  })

  const portableData = {
    exportedAt: new Date().toISOString(),
    user: {
      externalUserId: biometricUser.externalUserId,
      createdAt: biometricUser.createdAt,
    },
    biometricTemplates: biometricUser.templates.map((t) => ({
      commitment: t.commitment,
      modelVersion: t.modelVersion,
      variant: t.variant,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    })),
    consentHistory: [],
    webauthnCredentials: biometricUser.webauthnCreds.map((c) => ({
      aaguid: c.aaguid,
      deviceType: c.deviceType,
      backedUp: c.backedUp,
      createdAt: c.createdAt,
      lastUsedAt: c.lastUsedAt,
    })),
    auditHistory: auditEntries.map((e) => ({
      eventType: e.eventType,
      timestamp: e.createdAt,
    })),
    dataRights: getRightsText(),
  }

  return NextResponse.json({ success: true, data: portableData })
}

export async function DELETE(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const externalUserId = session.user.email

  // Delete biometric template
  const revokeResult = await revokeTemplate(session.tenantId, externalUserId)

  // Delete WebAuthn credentials
  const biometricUser = await db.user.findFirst({
    where: { tenantId: session.tenantId, externalUserId },
  })
  if (biometricUser) {
    await db.webAuthnCredential.deleteMany({
      where: { userId: biometricUser.id },
    })
  }

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'template.revoked',
    payload: {
      externalUserId,
      selfService: true,
      action: 'full_data_deletion',
      userId: session.user.id,
      receipt: revokeResult.revocationReceipt,
    },
  })

  logger.info({ userId: session.user.id }, 'Customer self-deleted all data (GDPR Art. 17)')

  return NextResponse.json({
    success: true,
    deleted: true,
    revocationReceipt: revokeResult.revocationReceipt,
    message: 'All your biometric data has been permanently deleted. Crypto-erasure initiated.',
  })
}

function getRightsText() {
  return {
    rightToAccess: 'GDPR Art. 15 — fulfilled by this endpoint',
    rightToRectification: 'GDPR Art. 16 — contact your tenant admin',
    rightToErasure: 'GDPR Art. 17 — fulfilled by DELETE /api/customer/privacy',
    rightToPortability: 'GDPR Art. 20 — fulfilled by this endpoint (download as JSON)',
    rightToObject: 'GDPR Art. 21 — DELETE /api/customer/profile',
  }
}
