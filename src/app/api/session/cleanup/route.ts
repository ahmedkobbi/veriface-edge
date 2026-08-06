/**
 * POST /api/session/cleanup
 * Cron job endpoint: expire stale pending sessions and clean up expired
 * revocation entries. Should be called every minute.
 *
 * No authentication required — protected by IP allowlist in production
 * (or restricted to internal cron only).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/audit'

export async function POST(_req: NextRequest) {
  const now = new Date()
  let expiredSessions = 0
  let cleanedRevocations = 0

  try {
    // Expire pending sessions past their expiry
    const result = await db.session.updateMany({
      where: {
        state: 'pending',
        expiresAt: { lt: now },
      },
      data: { state: 'expired' },
    })
    expiredSessions = result.count

    // Clean up expired revocation entries (token has naturally expired,
    // revocation record no longer needed)
    const revokedCleanup = await db.revokedToken.deleteMany({
      where: { expiresAt: { lt: now } },
    })
    cleanedRevocations = revokedCleanup.count

    if (expiredSessions > 0) {
      // Log aggregate cleanup (don't create per-session audit entries — too noisy)
      await db.auditLog.create({
        data: {
          tenantId: 'system',
          eventType: 'session.cleanup',
          payload: JSON.stringify({ expiredSessions, cleanedRevocations, ts: now.toISOString() }),
          prevHash: 'system',
          thisHash: 'system-cleanup-' + now.getTime(),
          chainIndex: 0,
        },
      }).catch(() => {})  // Don't fail if system tenant doesn't exist
    }

    return NextResponse.json({
      success: true,
      expiredSessions,
      cleanedRevocations,
      timestamp: now.toISOString(),
    })
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
