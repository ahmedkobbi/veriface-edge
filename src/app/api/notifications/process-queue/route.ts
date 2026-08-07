/**
 * POST /api/notifications/process-queue
 * Cron endpoint — processes pending email queue entries (retries + new sends).
 *
 * Auth: Requires CRON_SECRET header (fail-closed in production).
 * Called every 5 minutes by external scheduler (Vercel Cron, GitHub Actions, k8s cron).
 *
 * Body: none
 * Returns: { processed, sent, failed, retried }
 */

import { NextRequest, NextResponse } from 'next/server'
import { processPendingQueue } from '@/lib/email-notifications'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  // Cron auth: shared secret header
  const cronSecret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('CRON_SECRET not configured — refusing to run cron endpoint in production')
      return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
    }
    // Dev: allow without secret
  } else if (cronSecret !== expected) {
    logger.warn({ hasSecret: !!cronSecret }, 'Cron endpoint called with invalid secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processPendingQueue(50)
    logger.info(result, 'Email queue processed')
    return NextResponse.json({ success: true, ...result })
  } catch (e) {
    logger.error({ error: e }, 'Email queue processing failed')
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 })
  }
}

/**
 * GET /api/notifications/process-queue
 * Health check — returns queue depth without processing.
 */
export async function GET() {
  const { db } = await import('@/lib/db')
  const now = new Date()
  const pending = await db.emailLog.count({
    where: { state: 'pending', nextRetryAt: { lte: now } },
  })
  const failed = await db.emailLog.count({ where: { state: 'failed' } })
  const sent24h = await db.emailLog.count({
    where: {
      state: 'sent',
      sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  })

  return NextResponse.json({
    success: true,
    queueDepth: pending,
    failed,
    sent24h,
  })
}
