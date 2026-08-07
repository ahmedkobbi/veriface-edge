import { constantTimeEqual } from '@/lib/crypto-server'
/**
 * POST /api/webhook/process
 * Process pending webhook deliveries.
 *
 * SECURITY: Requires CRON_SECRET header. Fail-closed.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processWebhookQueue } from '@/lib/webhook'
import { logger } from '@/lib/logger'

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret) {
    logger.error('CRON_SECRET not set — refusing to process webhooks')
    return NextResponse.json(
      { success: false, error: 'Cron secret not configured' },
      { status: 503 },
    )
  }

  if (!constantTimeEqual(cronSecret ?? '', expectedSecret)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
  }

  const result = await processWebhookQueue(10)
  logger.info(result, 'Webhook queue processed')
  return NextResponse.json({ success: true, ...result })
}
