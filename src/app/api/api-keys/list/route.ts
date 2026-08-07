/**
 * GET /api/api-keys/list
 * List all API keys for the authenticated tenant (without revealing plaintext).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireApiKey, listApiKeys } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  try {
    const keys = await listApiKeys(authResult.auth.tenantId!)
    return NextResponse.json({ success: true, apiKeys: keys })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
