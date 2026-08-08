/**
 * GET /api/admin/fips
 * Returns FIPS 140-3 module status (self-tests, boundary, algorithms).
 *
 * POST /api/admin/fips
 * Re-run FIPS self-tests (admin only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import { getFipsStatus, runFipsSelfTests } from '@/lib/fips'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  return NextResponse.json({ success: true, fips: getFipsStatus() })
}

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
  }

  const results = await runFipsSelfTests()
  return NextResponse.json({ success: true, results })
}
