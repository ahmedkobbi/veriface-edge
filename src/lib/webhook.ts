/**
 * VeriFace Edge — Webhook Delivery
 *
 * Delivers signed events to enterprise client endpoints.
 *
 * - Signed with HMAC-SHA256 using the tenant's webhook secret
 * - Retries with exponential backoff + jitter (1s, 5s, 30s, 5m, 1h, 6h, 24h)
 * - Dead-letter queue after 7 attempts (24h total)
 * - Idempotency: webhook UUID is included; consumers must dedupe
 * - SSRF protection: validates webhook URL before each delivery
 * - Circuit breaker: trips after 5 consecutive failures, 5-min cooldown
 */

import { db } from '@/lib/db'
import { hmacSha256, utf8, hex } from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'
import { revalidateWebhookIp } from '@/lib/ssrf'
import { logger } from '@/lib/logger'
import { webhookDeliveriesTotal, webhookDeliveryDurationSeconds } from '@/lib/metrics'

const BACKOFF_SCHEDULE = [
  1_000,        // 1s
  5_000,        // 5s
  30_000,       // 30s
  5 * 60_000,   // 5m
  60 * 60_000,  // 1h
  6 * 60 * 60_000, // 6h
  24 * 60 * 60_000, // 24h
]

// Circuit breaker: per-tenant failure tracking
interface CircuitState {
  consecutiveFailures: number
  tripped: boolean
  trippedAt: number
  cooldownEndsAt: number
}

const circuitBreakers = new Map<string, CircuitState>()
const CIRCUIT_BREAKER_THRESHOLD = 5      // Trip after 5 consecutive failures
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60 * 1000  // 5-minute cooldown

function getCircuitState(tenantId: string): CircuitState {
  let state = circuitBreakers.get(tenantId)
  if (!state) {
    state = {
      consecutiveFailures: 0,
      tripped: false,
      trippedAt: 0,
      cooldownEndsAt: 0,
    }
    circuitBreakers.set(tenantId, state)
  }
  return state
}

function isCircuitOpen(tenantId: string): boolean {
  const state = getCircuitState(tenantId)
  if (!state.tripped) return false
  // Check if cooldown has elapsed
  if (Date.now() >= state.cooldownEndsAt) {
    state.tripped = false
    state.consecutiveFailures = 0
    return false
  }
  return true
}

function recordWebhookSuccess(tenantId: string): void {
  const state = getCircuitState(tenantId)
  state.consecutiveFailures = 0
  state.tripped = false
}

function recordWebhookFailure(tenantId: string): void {
  const state = getCircuitState(tenantId)
  state.consecutiveFailures++
  if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD && !state.tripped) {
    state.tripped = true
    state.trippedAt = Date.now()
    state.cooldownEndsAt = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS
    logger.warn(
      { tenantId, cooldownEndsAt: state.cooldownEndsAt },
      'Webhook circuit breaker tripped — 5-min cooldown',
    )
  }
}

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
 */
export async function processWebhookQueue(maxToProcess: number = 10): Promise<{
  processed: number
  delivered: number
  failed: number
  deadLettered: number
  circuitOpen: number
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
  let circuitOpen = 0

  for (const wh of due) {
    // Check circuit breaker
    if (isCircuitOpen(wh.tenantId)) {
      // Reschedule for after cooldown
      const state = getCircuitState(wh.tenantId)
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: { nextRetryAt: new Date(state.cooldownEndsAt) },
      })
      circuitOpen++
      continue
    }

    const tenant = await db.tenant.findUnique({ where: { id: wh.tenantId } })
    if (!tenant || !tenant.webhookUrl) {
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: { state: 'dead_letter', lastError: 'No webhook URL configured' },
      })
      deadLettered++
      continue
    }

    // SSRF re-validation (catches DNS rebinding)
    const ssrfCheck = await revalidateWebhookIp(tenant.webhookUrl)
    if (!ssrfCheck.allowed) {
      logger.error(
        { tenantId: wh.tenantId, url: tenant.webhookUrl, reason: ssrfCheck.reason },
        'Webhook SSRF check failed — disabling webhook',
      )
      await db.tenant.update({
        where: { id: wh.tenantId },
        data: { webhookUrl: null },
      })
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: { state: 'dead_letter', lastError: `SSRF check failed: ${ssrfCheck.reason}` },
      })
      await appendAudit({
        tenantId: wh.tenantId,
        eventType: 'webhook.dead_lettered',
        payload: { webhookId: wh.id, reason: `SSRF: ${ssrfCheck.reason}` },
      })
      deadLettered++
      recordWebhookFailure(wh.tenantId)
      continue
    }

    const attempt = wh.attempts + 1
    let httpCode: number | undefined
    let errorMsg: string | undefined
    const deliveryStart = Date.now()

    try {
      // SECURITY FIX (B-07): Use 'error' instead of 'manual'.
      //
      // 'manual' returns the 3xx response without following the redirect —
      // BUT in some fetch implementations (undici in Node.js), the TCP
      // connection to the redirect target is still established internally
      // before the 3xx is returned. This creates an SSRF oracle: an attacker
      // can register a webhook URL that returns 302 to an internal IP, and
      // the server connects to that IP even though it doesn't follow through.
      //
      // 'error' throws a TypeError on ANY redirect response, preventing the
      // server from even receiving the 3xx headers. This is the safest option
      // — no redirect target is ever contacted.
      //
      // We catch the TypeError and convert it to a clear error message.
      const response = await fetch(tenant.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-VeriFace-Event': wh.eventType,
          'X-VeriFace-Signature': `sha256=${wh.signature}`,
          'X-VeriFace-Event-Id': wh.id,
          'User-Agent': 'VeriFace-Edge-Webhook/1.0',
        },
        body: wh.payload,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error' as RequestRedirect,  // SECURITY FIX (B-07): throw on any redirect
      })
      httpCode = response.status
      const duration = (Date.now() - deliveryStart) / 1000

      if (response.status >= 200 && response.status < 300) {
        delivered++
        recordWebhookSuccess(wh.tenantId)
        await db.webhookDelivery.update({
          where: { id: wh.id },
          data: { state: 'delivered', attempts: attempt, lastResponseCode: httpCode },
        })
        webhookDeliveriesTotal.inc(
          { tenant_id: wh.tenantId, event_type: wh.eventType, outcome: 'delivered' },
        )
        webhookDeliveryDurationSeconds.observe(
          { tenant_id: wh.tenantId, event_type: wh.eventType },
          duration,
        )
        await appendAudit({
          tenantId: wh.tenantId,
          eventType: 'webhook.delivered',
          payload: { webhookId: wh.id, eventType: wh.eventType, httpCode },
        })
        continue
      }

      // Any non-2xx is a failure (3xx is unreachable here because redirect: 'error' throws)
      errorMsg = `HTTP ${response.status}`
    } catch (e) {
      // SECURITY FIX (B-07): Detect redirect errors specifically.
      // fetch with redirect: 'error' throws a TypeError with message
      // "redirect mode is set to error" when a 3xx is received.
      const errMsg = e instanceof Error ? e.message : 'Network error'
      if (errMsg.includes('redirect') || errMsg.includes('Redirect')) {
        errorMsg = `Redirect response rejected (SSRF protection) — webhook endpoint returned a 3xx redirect`
        logger.warn(
          { tenantId: wh.tenantId, webhookId: wh.id, webhookUrl: wh.tenantId },
          'Webhook delivery rejected: endpoint returned redirect (possible SSRF attempt)',
        )
      } else {
        errorMsg = errMsg
      }
    }

    // Failure path — schedule retry or dead-letter
    failed++
    recordWebhookFailure(wh.tenantId)
    webhookDeliveriesTotal.inc(
      { tenant_id: wh.tenantId, event_type: wh.eventType, outcome: 'failed' },
    )

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
      // SECURITY FIX (L-5): Off-by-one in the backoff index.
      // `attempt` starts at 1 (it's `wh.attempts + 1` after the first failure).
      // The backoff schedule is indexed from 0, so:
      //   - 1st failure (attempt=1) → should use BACKOFF_SCHEDULE[0] (1s delay)
      //   - 2nd failure (attempt=2) → should use BACKOFF_SCHEDULE[1] (5s delay)
      //   - ...
      // Previously: `BACKOFF_SCHEDULE[attempt]` used index 1 for the 1st failure
      // (skipping the 1s delay entirely) and index 7 for the 8th failure (out of
      // bounds → fell through to the last element, 24h, which is wrong).
      //
      // Fix: use `attempt - 1` as the index, and clamp to the last valid index.
      const backoffIndex = Math.min(attempt - 1, BACKOFF_SCHEDULE.length - 1)
      const baseDelay = BACKOFF_SCHEDULE[backoffIndex]
      // Exponential backoff with jitter (±20%)
      const jitter = baseDelay * 0.2 * (Math.random() * 2 - 1)
      const delay = Math.max(1000, baseDelay + jitter)
      await db.webhookDelivery.update({
        where: { id: wh.id },
        data: {
          attempts: attempt,
          lastResponseCode: httpCode,
          lastError: errorMsg,
          nextRetryAt: new Date(Date.now() + delay),
        },
      })
    }
  }

  return { processed: due.length, delivered, failed, deadLettered, circuitOpen }
}

/**
 * Get circuit breaker state for a tenant (for monitoring/debugging).
 */
export function getCircuitBreakerState(tenantId: string): {
  tripped: boolean
  consecutiveFailures: number
  cooldownEndsAt: number | null
} {
  const state = circuitBreakers.get(tenantId)
  if (!state) {
    return { tripped: false, consecutiveFailures: 0, cooldownEndsAt: null }
  }
  return {
    tripped: state.tripped && Date.now() < state.cooldownEndsAt,
    consecutiveFailures: state.consecutiveFailures,
    cooldownEndsAt: state.tripped ? state.cooldownEndsAt : null,
  }
}
