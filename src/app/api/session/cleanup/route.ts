import { constantTimeEqual } from '@/lib/crypto-server'
/**
 * POST /api/session/cleanup
 * Cron job endpoint: expire stale pending sessions and clean up expired
 * revocation entries. Should be called every minute.
 *
 * SECURITY: Requires CRON_SECRET header. Fail-closed — refuses if secret
 * is not configured or doesn't match.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  // Fail-closed authentication
  const cronSecret = req.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    logger.error('CRON_SECRET not set — refusing to run session cleanup')
    return NextResponse.json(
      { success: false, error: 'Cron secret not configured' },
      { status: 503 },
    )
  }

  if (!constantTimeEqual(cronSecret ?? '', expectedSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let expiredSessions = 0
  let cleanedRevocations = 0

  try {
    const result = await db.session.updateMany({
      where: {
        state: 'pending',
        expiresAt: { lt: now },
      },
      data: { state: 'expired' },
    })
    expiredSessions = result.count

    const revokedCleanup = await db.revokedToken.deleteMany({
      where: { expiresAt: { lt: now } },
    })
    cleanedRevocations = revokedCleanup.count

    logger.info({ expiredSessions, cleanedRevocations }, 'Session cleanup completed')

    return NextResponse.json({
      success: true,
      expiredSessions,
      cleanedRevocations,
      timestamp: now.toISOString(),
    })
  } catch (e) {
    logger.error({ error: e }, 'Session cleanup failed')
    return NextResponse.json(
      { success: false, error: 'Cleanup failed' },
      { status: 500 },
    )
  }
}
