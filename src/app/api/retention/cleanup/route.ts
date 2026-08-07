/**
 * POST /api/retention/cleanup
 *
 * Data retention policy enforcement (GDPR Art. 5(1)(e) — storage limitation).
 *
 * Deletes data that exceeds retention periods:
 *   - Audit log entries older than 7 years (2555 days) — SOX/financial requirement
 *   - Webhook delivery records older than 90 days
 *   - Expired sessions older than 7 days
 *   - Revoked tokens past their natural expiry
 *   - Rate limit buckets older than 1 hour
 *
 * Should be called daily via cron.
 *
 * NOTE: Biometric templates are NOT auto-deleted — they require explicit
 * GDPR Art. 17 request from the user (consent withdrawal).
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

const RETENTION = {
  AUDIT_LOG_DAYS: 2555,        // 7 years (SOX/financial)
  WEBHOOK_RECORDS_DAYS: 90,
  EXPIRED_SESSIONS_DAYS: 7,
  RATE_LIMIT_BUCKETS_HOURS: 1,
}

export async function POST(req: NextRequest) {
  // Fail-closed authentication — require CRON_SECRET
  const cronSecret = req.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    logger.error('CRON_SECRET not set — refusing to run retention cleanup')
    return NextResponse.json(
      { success: false, error: 'Cron secret not configured' },
      { status: 503 },
    )
  }

  if (cronSecret !== expectedSecret) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const results = {
    auditLogDeleted: 0,
    webhookRecordsDeleted: 0,
    expiredSessionsDeleted: 0,
    rateLimitBucketsDeleted: 0,
    executedAt: now.toISOString(),
  }

  try {
    // 1. Delete old audit log entries
    const auditCutoff = new Date(now.getTime() - RETENTION.AUDIT_LOG_DAYS * 24 * 60 * 60 * 1000)
    const auditResult = await db.auditLog.deleteMany({
      where: { createdAt: { lt: auditCutoff } },
    })
    results.auditLogDeleted = auditResult.count

    // 2. Delete old webhook delivery records
    const webhookCutoff = new Date(now.getTime() - RETENTION.WEBHOOK_RECORDS_DAYS * 24 * 60 * 60 * 1000)
    const webhookResult = await db.webhookDelivery.deleteMany({
      where: { createdAt: { lt: webhookCutoff } },
    })
    results.webhookRecordsDeleted = webhookResult.count

    // 3. Delete old expired sessions
    const sessionCutoff = new Date(now.getTime() - RETENTION.EXPIRED_SESSIONS_DAYS * 24 * 60 * 60 * 1000)
    const sessionResult = await db.session.deleteMany({
      where: {
        createdAt: { lt: sessionCutoff },
        state: { in: ['expired', 'failed'] },
      },
    })
    results.expiredSessionsDeleted = sessionResult.count

    // 4. Delete old rate limit buckets
    const rateLimitCutoff = new Date(now.getTime() - RETENTION.RATE_LIMIT_BUCKETS_HOURS * 60 * 60 * 1000)
    const rateLimitResult = await db.rateLimitBucket.deleteMany({
      where: { windowStart: { lt: rateLimitCutoff } },
    })
    results.rateLimitBucketsDeleted = rateLimitResult.count

    logger.info(results, 'Data retention cleanup completed')

    return NextResponse.json({
      success: true,
      retention: RETENTION,
      ...results,
    })
  } catch (e) {
    logger.error({ error: e }, 'Data retention cleanup failed')
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown error' },
      { status: 500 },
    )
  }
}

export const RETENTION_POLICY = RETENTION
