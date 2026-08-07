/**
 * VeriFace Edge — Audit Log Streaming Service
 *
 * Provides real-time audit log streaming for SIEM integration:
 *   - SSE (Server-Sent Events) endpoint for HTTP-based streaming
 *   - WebSocket broadcast from the WS mini-service
 *   - Webhook-based streaming (push to external SIEM)
 *   - Syslog format export (CEF, LEEF, JSON)
 *
 * When a new audit entry is created via appendAudit(), all connected
 * SSE/WS subscribers receive it in real-time.
 */

import { NextRequest } from 'next/server'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// In-memory subscriber registry (production: Redis Pub/Sub)
// ---------------------------------------------------------------------------

export interface AuditSubscriber {
  id: string
  tenantId: string
  controller: ReadableStreamDefaultController
  filters?: {
    eventTypes?: string[]
  }
}

const subscribers = new Map<string, AuditSubscriber>()

/**
 * Register a new SSE subscriber.
 */
export function subscribe(subscriber: AuditSubscriber): () => void {
  subscribers.set(subscriber.id, subscriber)
  logger.info({ subscriberId: subscriber.id, tenantId: subscriber.tenantId, total: subscribers.size }, 'Audit subscriber added')
  return () => {
    subscribers.delete(subscriber.id)
    logger.info({ subscriberId: subscriber.id, total: subscribers.size }, 'Audit subscriber removed')
  }
}

/**
 * Broadcast a new audit entry to all matching subscribers.
 * Called from appendAudit after the entry is written to the DB.
 */
export function broadcastAuditEntry(entry: {
  tenantId: string
  eventType: string
  payload: Record<string, unknown>
  chainIndex: number
  thisHash: string
  actorIp: string | null
  createdAt: Date
}): void {
  const data = `data: ${JSON.stringify({
    type: 'audit',
    tenantId: entry.tenantId,
    eventType: entry.eventType,
    payload: entry.payload,
    chainIndex: entry.chainIndex,
    hash: entry.thisHash,
    actorIp: entry.actorIp,
    timestamp: entry.createdAt.toISOString(),
  })}\n\n`

  let sent = 0
  for (const [id, sub] of subscribers) {
    // Filter by tenant
    if (sub.tenantId !== entry.tenantId) continue

    // Filter by event type
    if (sub.filters?.eventTypes && !sub.filters.eventTypes.includes(entry.eventType)) continue

    try {
      sub.controller.enqueue(new TextEncoder().encode(data))
      sent++
    } catch {
      // Subscriber disconnected — clean up
      subscribers.delete(id)
    }
  }

  if (sent > 0) {
    logger.debug({ sent, total: subscribers.size, eventType: entry.eventType }, 'Audit entry streamed')
  }
}

/**
 * Get the number of active subscribers for a tenant.
 */
export function getSubscriberCount(tenantId: string): number {
  let count = 0
  for (const sub of subscribers.values()) {
    if (sub.tenantId === tenantId) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// SIEM format converters
// ---------------------------------------------------------------------------

/**
 * Convert an audit entry to CEF (Common Event Format) for SIEM ingestion.
 * Format: CEF:Version|Vendor|Product|DevVersion|SignatureID|Name|Severity|Extension
 */
export function toCEF(entry: {
  eventType: string
  payload: Record<string, unknown>
  actorIp: string | null
  createdAt: Date
  tenantId: string
}): string {
  const severity = entry.eventType.includes('failure') || entry.eventType.includes('injection') ? 8 :
                   entry.eventType.includes('success') ? 3 : 5
  const extension = Object.entries(entry.payload)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join(' ')
  return `CEF:0|VeriFace|Edge|1.0|${entry.eventType}|${entry.eventType}|${severity}|src=${entry.actorIp ?? 'unknown'} tenant=${entry.tenantId} ${extension}`
}

/**
 * Convert an audit entry to LEEF (Log Event Extended Format) for IBM QRadar.
 * Format: LEEF:Version|Vendor|Product|DevVersion|EventID|key=value\tkey=value
 */
export function toLEEF(entry: {
  eventType: string
  payload: Record<string, unknown>
  actorIp: string | null
  createdAt: Date
  tenantId: string
}): string {
  const fields = Object.entries(entry.payload)
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
    .join('\t')
  return `LEEF:1.0|VeriFace|Edge|1.0|${entry.eventType}|src=${entry.actorIp ?? 'unknown'}\ttenant=${entry.tenantId}\t${fields}`
}

/**
 * Convert an audit entry to syslog format.
 * Format: <priority>timestamp hostname program[pid]: message
 */
export function toSyslog(entry: {
  eventType: string
  payload: Record<string, unknown>
  actorIp: string | null
  createdAt: Date
  tenantId: string
}): string {
  const priority = entry.eventType.includes('failure') ? 141 : // warning (4*8+5)
                    entry.eventType.includes('success') ? 134 : // info (3*8+6)
                    136 // notice (4*8+0)
  const timestamp = entry.createdAt.toISOString()
  const message = JSON.stringify({ eventType: entry.eventType, tenantId: entry.tenantId, ip: entry.actorIp, ...entry.payload })
  return `<${priority}>${timestamp} veriface-edge audit[${process.pid}]: ${message}`
}
