/**
 * VeriFace Edge — Webhook Delivery
 *
 * Delivers signed events to enterprise client endpoints.
 *
 * - Signed with HMAC-SHA256 using the tenant's webhook secret
 * - Retries with exponential backoff (1s, 5s, 30s, 5m, 1h, 6h, 24h)
 * - Dead-letter queue after 7 attempts (24h total)
 * - Idempotency: webhook UUID is included; consumers must dedupe
 */

import { db } from '@/lib/db'
import { hmacSha256, utf8, hex } from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'

const BACKOFF_SCHEDULE = [
  1_000,        // 1s
  5_000,        // 5s
  30_000,       // 30s
  5 * 60_000,   // 5m
  60 * 60_000,  // 1h
  6 * 60 * 60_000, // 6h
  24 * 60 * 60_000, // 24h
]

export interface WebhookEvent {
  eventId: string
  eventType: string
  tenantId: string
  payload: Record<string, unknown>
  timestamp: string
}

/**
 * Enqueue a webhook for delivery. The actual HTTP delivery happens
 * asynchronously via `processWebhookQueue()`.
 */
export async function enqueueWebhook(
  tenantId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant || !tenant.webhookUrl) return

  const event: WebhookEvent = {
    eventId: crypto.randomUUID(),
    eventType,
    tenantId,
    payload,
    timestamp: new Date().toISOString(),
  }

  const payloadStr = JSON.stringify(event)
  const signature = hmacSha256(utf8.encode(tenant.webhookSecret), utf8.encode(payloadStr))

  await db.webhookDelivery.create({
    data: {
      tenantId,
      eventType,
      payload: payloadStr,
      signature,
      state: 'pending',
      attempts: 0,
      nextRetryAt: new Date(),
    },
  })
}

/**
 * Process pending webhook deliveries. Should be called by a cron job
 * or background worker every few seconds.
 *
 * NOTE: In production, this runs as a separate worker process. Here
 * we expose it for the API endpoint /api/webhook/process.
 */
export async function processWebhookQueue(maxToProcess: number = 10): Promise<{
  processed: number
  delivered: number
  failed: number
  deadLettered: number
}> {
  const due = await db.webhookDelivery.findMany({
    where: {
      state: 'pending',
      nextRetryAt: { lte: new Date() },
    },
    take: maxToProcess,
    orderBy: { nextRetryAt: 'asc' },
  })

  let delivered = 0
  let failed = 0
  let deadLettered = 0

  for (const wh of due) {
    const tenant = await db.tenant.findUnique({ where: { id: wh.tenantId } })
    if (!tenant || !tenant.webhookUrl) {
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: { state: 'dead_letter', lastError: 'No webhook URL configured' },
      })
      deadLettered++
      continue
    }

    const attempt = wh.attempts + 1
    let httpCode: number | undefined
    let errorMsg: string | undefined

    try {
      const response = await fetch(tenant.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VeriFace-Event': wh.eventType,
          'X-VeriFace-Signature': `sha256=${wh.signature}`,
          'X-VeriFace-Event-Id': wh.id,
        },
        body: wh.payload,
        signal: AbortSignal.timeout(10_000),
      })
      httpCode = response.status
      if (response.status >= 200 && response.status < 300) {
        delivered++
        await db.webhookDelivery.update({
          where: { id: wh.id },
          data: { state: 'delivered', attempts: attempt, lastResponseCode: httpCode },
        })
        await appendAudit({
          tenantId: wh.tenantId,
          eventType: 'webhook.delivered',
          payload: { webhookId: wh.id, eventType: wh.eventType, httpCode },
        })
        continue
      }
      errorMsg = `HTTP ${response.status}`
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : 'Network error'
    }

    // Failure path — schedule retry or dead-letter
    failed++
    if (attempt >= BACKOFF_SCHEDULE.length) {
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: {
          state: 'dead_letter',
          attempts: attempt,
          lastResponseCode: httpCode,
          lastError: errorMsg,
        },
      })
      await appendAudit({
        tenantId: wh.tenantId,
        eventType: 'webhook.dead_lettered',
        payload: { webhookId: wh.id, eventType: wh.eventType, lastError: errorMsg },
      })
      deadLettered++
    } else {
      const nextDelay = BACKOFF_SCHEDULE[attempt] ?? BACKOFF_SCHEDULE[BACKOFF_SCHEDULE.length - 1]
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: {
          attempts: attempt,
          lastResponseCode: httpCode,
          lastError: errorMsg,
          nextRetryAt: new Date(Date.now() + nextDelay),
        },
      })
    }
  }

  return { processed: due.length, delivered, failed, deadLettered }
}
