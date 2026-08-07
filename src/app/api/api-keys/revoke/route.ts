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
    const revoked = await revokeApiKey(authResult.auth.tenantId!, apiKeyId)
    if (!revoked) {
      return NextResponse.json({ success: false, error: 'API key not found or already revoked' }, { status: 404 })
    }

    logger.info({ tenantId: authResult.auth.tenantId, apiKeyId }, 'API key revoked')
    return NextResponse.json({ success: true, revoked: true })
  } catch (e) {
    logger.error({ error: e, apiKeyId }, 'API key revocation failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
