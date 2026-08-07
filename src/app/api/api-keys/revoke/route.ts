/**
 * POST /api/api-keys/revoke
 * Revoke an API key.
 *
 * Body: { apiKeyId: string (cuid) }
 * Validates input via Zod schema (rejects SQL injection, malformed IDs).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey, revokeApiKey } from '@/lib/auth'
import { validateInput, ApiKeyRevokeSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { safeErrorResponse } from '@/lib/config'
import { enqueueEmail, getTenantAdminRecipient } from '@/lib/email-notifications'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const validation = validateInput(ApiKeyRevokeSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { apiKeyId } = validation.data

  try {
    // Fetch the API key label BEFORE revoking (so we can include it in the email)
    const apiKeyRecord = await db.apiKey.findUnique({
      where: { id: apiKeyId },
      select: { label: true, tenantId: true },
    })

    const revoked = await revokeApiKey(authResult.auth.tenantId!, apiKeyId)
    if (!revoked) {
      return NextResponse.json({ success: false, error: 'API key not found or already revoked' }, { status: 404 })
    }

    logger.info({ tenantId: authResult.auth.tenantId, apiKeyId }, 'API key revoked')

    // Fire API-key-revoked email to tenant admin (best-effort, non-blocking)
    if (apiKeyRecord) {
      void (async () => {
        try {
          const admin = await getTenantAdminRecipient(authResult.auth.tenantId!)
          if (admin) {
            await enqueueEmail({
              tenantId: authResult.auth.tenantId!,
              to: admin.email,
              userId: admin.userId,
              template: 'security.api_key_revoked',
              vars: {
                name: admin.name ?? undefined,
                label: apiKeyRecord.label,
                timestamp: new Date().toISOString(),
                ip: authResult.ip,
              },
            })
          }
        } catch (e) {
          logger.warn({ error: e }, 'Failed to enqueue API-key-revoked email')
        }
      })()
    }

    return NextResponse.json({ success: true, revoked: true })
  } catch (e) {
    logger.error({ error: e, apiKeyId }, 'API key revocation failed')
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
