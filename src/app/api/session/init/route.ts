import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { initSession } from '@/lib/session'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { tenantId, flow, externalUserId } = body

    if (!tenantId || typeof tenantId !== 'string') {
      return NextResponse.json({ success: false, error: 'tenantId required' }, { status: 400 })
    }
    if (flow !== 'enroll' && flow !== 'authenticate') {
      return NextResponse.json({ success: false, error: 'flow must be enroll|authenticate' }, { status: 400 })
    }

    const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
    if (!tenant || !tenant.active) {
      return NextResponse.json({ success: false, error: 'Tenant not found or inactive' }, { status: 403 })
    }

    const clientIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const userAgent = req.headers.get('user-agent') ?? ''

    const session = await initSession({
      tenantId,
      flow,
      targetUserId: externalUserId,
      clientIp,
      userAgent,
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
