/**
 * GET /api/verify-audit
 * Walk the entire audit chain for a tenant and verify integrity.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuditChain } from '@/lib/audit'
import { requireApiKey } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'audit:read')
  if (!authResult.ok) return authResult.response

  const tenantId = authResult.auth.tenantId!
  const result = await verifyAuditChain(tenantId)
  return NextResponse.json({ success: true, ...result })
}
