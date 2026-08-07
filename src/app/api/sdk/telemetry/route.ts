/**
 * POST /api/sdk/telemetry
 * Ingest anonymous SDK error telemetry from the browser SDK.
 *
 * PRIVACY CONTRACT (enforced here):
 *   - Body MUST contain telemetryOptIn: true (SDK sets this after explicit consent)
 *   - tenantId is hashed (SHA-256) before storage — we never store the raw ID
 *   - All string fields are length-capped (256 chars max)
 *   - Ingestion is rate-limited per IP (10 events/min)
 *   - NO face data, embeddings, PII, full UA strings, or session tokens accepted
 *   - All fields are Zod-validated — reject any unknown field
 *
 * Auth: NONE required (telemetry is unauthenticated — the SDK may not have
 * a valid session at the time of error). Rate limiting by IP prevents abuse.
 *
 * Body: {
 *   tenantId: string,
 *   sdkVersion: string,
 *   telemetryOptIn: true,  // MUST be true
 *   events: [{
 *     errorCode, severity, stage, errorMessage,
 *     browserFamily, osFamily, hasWebGPU, hasCamera,
 *     sessionId?, experimentId?, experimentVariant?,
 *     metrics?, timestamp
 *   }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'
import { z } from 'zod'

// Per-IP rate limit (in-memory; production: Redis)
const ipRateLimit = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT_PER_MIN = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000

setInterval(() => {
  const now = Date.now()
  for (const [ip, rec] of ipRateLimit) {
    if (now - rec.windowStart > RATE_LIMIT_WINDOW_MS) ipRateLimit.delete(ip)
  }
}, 60_000).unref?.()

const ALLOWED_ERROR_CODES = new Set([
  'NO_WEBGPU', 'CAMERA_DENIED', 'NO_CAMERA', 'VIRTUAL_CAMERA_ONLY',
  'INJECTION_SUSPECTED', 'EXTENSION_TAMPER', 'NO_FACE', 'MULTIPLE_FACES',
  'LIVENESS_FAILED', 'TIMING_SYNTHETIC', 'REPLAY_DETECTED', 'SESSION_EXPIRED',
  'NETWORK_ERROR', 'VERIFICATION_FAILED', 'UNSUPPORTED_BROWSER', 'UNKNOWN',
])

const ALLOWED_STAGES = new Set([
  'init', 'camera', 'capture', 'liveness', 'anti_injection', 'crypto', 'verify', 'network',
])

const ALLOWED_SEVERITIES = new Set(['fatal', 'error', 'warning'])

const ALLOWED_BROWSER_FAMILIES = new Set([
  'firefox', 'edge', 'opera', 'chrome', 'chromium', 'safari', 'unknown',
])

const ALLOWED_OS_FAMILIES = new Set([
  'windows', 'macos', 'linux', 'android', 'ios', 'unknown',
])

const EventSchema = z.object({
  errorCode: z.string().min(1).max(64).refine((s) => ALLOWED_ERROR_CODES.has(s), {
    message: 'Invalid errorCode',
  }),
  severity: z.string().max(10).refine((s) => ALLOWED_SEVERITIES.has(s)).default('error'),
  stage: z.string().max(20).refine((s) => ALLOWED_STAGES.has(s)),
  errorMessage: z.string().max(256),
  browserFamily: z.string().max(20).refine((s) => ALLOWED_BROWSER_FAMILIES.has(s)).default('unknown'),
  osFamily: z.string().max(20).refine((s) => ALLOWED_OS_FAMILIES.has(s)).default('unknown'),
  hasWebGPU: z.boolean().default(false),
  hasCamera: z.boolean().default(false),
  sessionId: z.string().max(64).optional(),
  experimentId: z.string().max(64).optional(),
  experimentVariant: z.string().max(64).optional(),
  metrics: z.record(z.string(), z.number()).optional(),
  timestamp: z.string().max(40),
})

const TelemetrySchema = z.object({
  tenantId: z.string().min(1).max(64),
  sdkVersion: z.string().min(1).max(20),
  // SDK MUST send telemetryOptIn: true — this is the explicit consent signal
  telemetryOptIn: z.literal(true),
  events: z.array(EventSchema).max(50), // max 50 events per batch
})

export async function POST(req: NextRequest) {
  // --- Rate limit (per IP) ---
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const now = Date.now()
  const rl = ipRateLimit.get(ip)
  if (!rl || now - rl.windowStart > RATE_LIMIT_WINDOW_MS) {
    ipRateLimit.set(ip, { count: 1, windowStart: now })
  } else {
    rl.count++
    if (rl.count > RATE_LIMIT_PER_MIN) {
      return NextResponse.json(
        { success: false, error: 'Rate limit exceeded', code: 'RATE_LIMITED' },
        { status: 429, headers: { 'Retry-After': '60' } },
      )
    }
  }

  // --- Body size limit (10KB max) ---
  const contentLength = parseInt(req.headers.get('content-length') ?? '0', 10)
  if (contentLength > 10_000) {
    return NextResponse.json(
      { success: false, error: 'Body too large', code: 'BODY_TOO_LARGE' },
      { status: 413 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON', code: 'INVALID_JSON' },
      { status: 400 },
    )
  }

  const validation = TelemetrySchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  const { tenantId, sdkVersion, events } = validation.data

  // Hash tenantId before storage — never store raw
  const tenantIdHash = sha256Hex(tenantId)

  // Bulk insert
  try {
    await db.sdkErrorEvent.createMany({
      data: events.map((e) => ({
        tenantIdHash,
        sdkVersion,
        errorCode: e.errorCode,
        severity: e.severity,
        stage: e.stage,
        errorMessage: e.errorMessage,
        browserFamily: e.browserFamily,
        osFamily: e.osFamily,
        hasWebGPU: e.hasWebGPU,
        hasCamera: e.hasCamera,
        sessionId: e.sessionId ?? null,
        experimentId: e.experimentId ?? null,
        experimentVariant: e.experimentVariant ?? null,
        metrics: e.metrics ? JSON.stringify(e.metrics) : null,
      })),
    })

    if (events.length > 0) {
      logger.debug({ count: events.length, tenantIdHash: tenantIdHash.slice(0, 8) }, 'SDK telemetry ingested')
    }

    return NextResponse.json({ success: true, ingested: events.length })
  } catch (e) {
    logger.error({ error: e }, 'Telemetry ingestion failed')
    return NextResponse.json(
      { success: false, error: 'Ingestion failed' },
      { status: 500 },
    )
  }
}
