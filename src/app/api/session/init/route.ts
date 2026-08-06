import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { initSession } from '@/lib/session'
import { requireApiKey } from '@/lib/auth'

export async function POST(req: NextRequest) {
  // API key required for session init
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  try {
    const body = await req.json()
    const { flow, externalUserId } = body

    if (flow !== 'enroll' && flow !== 'authenticate') {
      return NextResponse.json({ success: false, error: 'flow must be enroll|authenticate' }, { status: 400 })
    }

    // Use the tenantId from the authenticated API key (NOT from request body)
    // This prevents tenant spoofing.
    const tenantId = authResult.auth.tenantId!

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant || !tenant.active) {
      return NextResponse.json({ success: false, error: 'Tenant not found or inactive' }, { status: 403 })
    }

    const session = await initSession({
      tenantId,
      flow,
      targetUserId: externalUserId,
      clientIp: authResult.ip,
      userAgent: req.headers.get('user-agent') ?? '',
    })

    return NextResponse.json({
      success: true,
      sessionId: session.sessionId,
      challenge: session.challenge,
      backendPubKey: session.backendPubKey,
      expiresAt: session.expiresAt.toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
