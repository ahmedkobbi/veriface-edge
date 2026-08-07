/**
 * GET /api/templates/export
 * GDPR Article 20 — Right to Data Portability.
 *
 * Returns all data VeriFace holds about a user in a machine-readable
 * format (JSON). Includes:
 *   - User record (external ID, revocation token)
 *   - Biometric template metadata (commitment, variant, model version)
 *   - Consent history
 *   - Audit log entries (filtered to this user)
 *   - WebAuthn credentials (public keys only — never private)
 *
 * Does NOT include:
 *   - Raw embeddings (encrypted, never exported in plaintext)
 *   - Raw images / video (never stored)
 *   - Other users' data
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { appendAudit } from '@/lib/audit'
import { safeErrorResponse } from '@/lib/config'

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'audit:read')
  if (!authResult.ok) return authResult.response

  const url = new URL(req.url)
  const externalUserId = url.searchParams.get('externalUserId')

  if (!externalUserId) {
    return NextResponse.json(
      { success: false, error: 'externalUserId parameter required' },
      { status: 400 },
    )
  }

  const tenantId = authResult.auth.tenantId!

  try {
    const user = await db.user.findFirst({
      where: { tenantId, externalUserId },
      include: {
        templates: true,
        webauthnCreds: true,
      },
    })

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 },
      )
    }

    // Fetch consent history
    const consentHistory = await db.consentRecord.findMany({
      where: { tenantId, userId: user.id },
      orderBy: { createdAt: 'desc' },
    })

    // Fetch audit log entries related to this user
    const auditEntries = await db.auditLog.findMany({
      where: {
        tenantId,
        // Search for entries that mention this user in the payload
        payload: { contains: externalUserId },
      },
      orderBy: { chainIndex: 'desc' },
      take: 100,
    })

    // Build the portable data package
    const portableData = {
      exportedAt: new Date().toISOString(),
      tenantId,
      user: {
        externalUserId: user.externalUserId,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        // revocationToken is intentionally NOT exported — it's a secret
      },
      biometricTemplates: user.templates.map((t) => ({
        id: t.id,
        commitment: t.commitment,
        variant: t.variant,
        modelVersion: t.modelVersion,
        norm: t.norm,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        // encryptedVector, iv, authTag intentionally NOT exported
        // — they're encrypted and useless without the KMS DEK
      })),
      webauthnCredentials: user.webauthnCreds.map((c) => ({
        id: c.id,
        credentialId: c.credentialId,
        aaguid: c.aaguid,
        deviceType: c.deviceType,
        backedUp: c.backedUp,
        transports: JSON.parse(c.transports),
        counter: c.counter,
        createdAt: c.createdAt,
        lastUsedAt: c.lastUsedAt,
        // publicKey NOT exported — it's a credential secret
      })),
      consentHistory: consentHistory.map((c) => ({
        id: c.id,
        purpose: c.purpose,
        granted: c.granted,
        ip: c.ip,
        flowVersion: c.flowVersion,
        createdAt: c.createdAt,
      })),
      auditHistory: auditEntries.map((e) => ({
        eventType: e.eventType,
        payload: JSON.parse(e.payload),
        chainIndex: e.chainIndex,
        createdAt: e.createdAt,
      })),
      dataRights: {
        rightToAccess: 'GDPR Art. 15 — fulfilled by this endpoint',
        rightToRectification: 'GDPR Art. 16 — contact your tenant admin',
        rightToErasure: 'GDPR Art. 17 — POST /api/templates/delete',
        rightToPortability: 'GDPR Art. 20 — fulfilled by this endpoint',
        rightToObject: 'GDPR Art. 21 — POST /api/consent with granted=false',
      },
    }

    await appendAudit({
      tenantId,
      eventType: 'data.exported',
      payload: { userId: user.id, externalUserId },
      apiKeyId: authResult.auth.apiKeyId,
    })

    logger.info({ tenantId, userId: user.id }, 'Data export completed (GDPR Art. 20)')

    return NextResponse.json({
      success: true,
      data: portableData,
    })
  } catch (e) {
    logger.error({ error: e, tenantId, externalUserId }, 'Data export failed')
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
