/**
 * VeriFace Edge — Prometheus Metrics
 *
 * Exposes metrics at /api/metrics for Prometheus scraping.
 * Tracks:
 *   - HTTP request count + duration (by route + method + status)
 *   - Authentication attempts (success/failure)
 *   - Active sessions
 *   - Audit log entries
 *   - Webhook delivery attempts + outcomes
 *   - Rate limit hits
 *   - Crypto operation durations
 */

import { Registry, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client'

const registry = new Registry()
collectDefaultMetrics({ register: registry, prefix: 'veriface_' })

// HTTP metrics
export const httpRequestsTotal = new Counter({
  name: 'veriface_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry],
})

export const httpRequestDurationSeconds = new Histogram({
  name: 'veriface_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
})

// Authentication metrics
export const authAttemptsTotal = new Counter({
  name: 'veriface_auth_attempts_total',
  help: 'Authentication attempts',
  labelNames: ['tenant_id', 'flow', 'outcome'],
  registers: [registry],
})

export const enrollmentsTotal = new Counter({
  name: 'veriface_enrollments_total',
  help: 'Template enrollments',
  labelNames: ['tenant_id', 'variant', 'outcome'],
  registers: [registry],
})

// Session metrics
export const activeSessions = new Gauge({
  name: 'veriface_active_sessions',
  help: 'Currently active (pending) sessions',
  labelNames: ['tenant_id'],
  registers: [registry],
})

// Audit log metrics
export const auditEntriesTotal = new Counter({
  name: 'veriface_audit_entries_total',
  help: 'Audit log entries created',
  labelNames: ['tenant_id', 'event_type'],
  registers: [registry],
})

// Webhook metrics
export const webhookDeliveriesTotal = new Counter({
  name: 'veriface_webhook_deliveries_total',
  help: 'Webhook delivery attempts',
  labelNames: ['tenant_id', 'event_type', 'outcome'],
  registers: [registry],
})

export const webhookDeliveryDurationSeconds = new Histogram({
  name: 'veriface_webhook_delivery_duration_seconds',
  help: 'Webhook delivery duration in seconds',
  labelNames: ['tenant_id', 'event_type'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
})

// Rate limit metrics
export const rateLimitHitsTotal = new Counter({
  name: 'veriface_rate_limit_hits_total',
  help: 'Rate limit hits (429 responses)',
  labelNames: ['tenant_id', 'reason'],
  registers: [registry],
})

// Crypto operation metrics
export const cryptoOperationDurationSeconds = new Histogram({
  name: 'veriface_crypto_operation_duration_seconds',
  help: 'Cryptographic operation duration',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
})

// Anti-injection metrics
export const injectionSuspectedTotal = new Counter({
  name: 'veriface_injection_suspected_total',
  help: 'Anti-injection defense triggered',
  labelNames: ['tenant_id', 'reason'],
  registers: [registry],
})

// API key metrics
export const apiKeyAuthAttemptsTotal = new Counter({
  name: 'veriface_apikey_auth_attempts_total',
  help: 'API key authentication attempts',
  labelNames: ['outcome'],
  registers: [registry],
})

/**
 * Get the Prometheus metrics text for the /api/metrics endpoint.
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics()
}

export function getMetricsContentType(): string {
  return registry.contentType
}

/**
 * Record an HTTP request.
 */
export function recordHttpRequest(
  method: string,
  route: string,
  status: number,
  durationSeconds: number,
): void {
  httpRequestsTotal.inc({ method, route, status: String(status) })
  httpRequestDurationSeconds.observe(
    { method, route, status: String(status) },
    durationSeconds,
  )
}
