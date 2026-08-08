/**
 * GET /api/attributes/list
 * List all active attribute credentials for a user.
 *
 * Query: ?externalUserId=user_123
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { listCredentials } from '@/lib/attribute-proofs'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const url = new URL(req.url)
  const externalUserId = url.searchParams.get('externalUserId')

  if (!externalUserId) {
    return NextResponse.json(
      { success: false, error: 'externalUserId required' },
      { status: 400 },
    )
  }

  const credentials = await listCredentials(session.tenantId, externalUserId)

  return NextResponse.json({ success: true, credentials })
}
