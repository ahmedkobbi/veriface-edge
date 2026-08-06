/**
 * GET /api/verify-audit?tenantId=xxx
 * Walk the entire audit chain for a tenant and verify integrity.
 * Detects any tampering (modified entries, broken links).
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAuditChain } from '@/lib/audit'

export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const tenantId = url.searchParams.get('tenantId')
  if (!tenantId) {
    return NextResponse.json({ success: false, error: 'tenantId required' }, { status: 400 })
  }
  const result = await verifyAuditChain(tenantId)
  return NextResponse.json({ success: true, ...result })
}
