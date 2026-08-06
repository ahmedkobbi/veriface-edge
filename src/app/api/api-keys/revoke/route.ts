/**
 * POST /api/api-keys/revoke
 * Revoke an API key.
 *
 * Body: { apiKeyId: string }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey, revokeApiKey } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { apiKeyId } = body
    if (!apiKeyId) {
      return NextResponse.json({ success: false, error: 'apiKeyId required' }, { status: 400 })
    }

    const revoked = await revokeApiKey(authResult.auth.tenantId!, apiKeyId)
    if (!revoked) {
      return NextResponse.json({ success: false, error: 'API key not found or already revoked' }, { status: 404 })
    }

    return NextResponse.json({ success: true, revoked: true })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
