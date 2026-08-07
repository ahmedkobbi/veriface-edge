/**
 * POST /api/webhook/process
 * Process pending webhook deliveries. Should be called by a cron job.
 */

import { NextRequest, NextResponse } from 'next/server'
import { processWebhookQueue } from '@/lib/webhook'

export async function POST(_req: NextRequest) {
  const result = await processWebhookQueue(10)
  return NextResponse.json({ success: true, ...result })
}
