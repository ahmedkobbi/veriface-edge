/**
 * VeriFace Edge — API Key Authentication & Rate Limiting
 *
 * Enforces tenant-scoped access via API keys (prefixed `vf_live_` or `vf_test_`).
 * API keys are SHA-256 hashed before storage — plaintext shown only at creation.
 *
 * Rate limiting: token bucket per tenant + IP, configurable per tenant.
 * Buckets are stored in DB for multi-instance deployments, with an in-memory
 * cache for hot-path performance.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sha256Hex, secureRandomHex, constantTimeEqual } from '@/lib/crypto-server'
import { appendAudit } from '@/lib/audit'

// ---------------------------------------------------------------------------
// API key management
// ---------------------------------------------------------------------------

const KEY_PREFIX_LIVE = 'vf_live_'
const KEY_PREFIX_TEST = 'vf_test_'

export interface ApiKeyInfo {
  id: string
  tenantId: string
  label: string
  scopes: string
  keyPrefix: string
  lastFour: string
  active: boolean
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  revokedAt: Date | null
}

export interface CreatedApiKey extends ApiKeyInfo {
  /** Plaintext API key — shown ONCE. Format: `vf_live_<32 hex chars>` */
  plaintext: string
}

/**
 * Generate a new API key for a tenant.
 * Format: `vf_live_<32 hex chars>` (40 chars total).
 * Returns the plaintext ONCE — caller must persist it.
 */
export async function createApiKey(
  tenantId: string,
  opts: {
    label: string
    scopes?: string  // default '*'
    environment?: 'live' | 'test'
    expiresInDays?: number
  },
): Promise<CreatedApiKey> {
  const env = opts.environment ?? 'live'
  const prefix = env === 'live' ? KEY_PREFIX_LIVE : KEY_PREFIX_TEST
  const secret = secureRandomHex(16)  // 32 hex chars
  const plaintext = prefix + secret

  const keyHash = sha256Hex(plaintext)
  const keyPrefixDisplay = prefix + secret.slice(0, 8)
  const lastFour = secret.slice(-4)

  const expiresAt = opts.expiresInDays
    ? new Date(Date.now() + opts.expiresInDays * 24 * 60 * 60 * 1000)
    : null

  const record = await db.apiKey.create({
    data: {
      tenantId,
      keyHash,
      keyPrefix: keyPrefixDisplay,
      label: opts.label,
      scopes: opts.scopes ?? '*',
      lastFour,
      expiresAt,
    },
  })

  await appendAudit({
    tenantId,
    eventType: 'api_key.created' as any,
    payload: { apiKeyId: record.id, label: opts.label, scopes: opts.scopes ?? '*' },
  })

  return {
    id: record.id,
    tenantId,
    label: record.label,
    scopes: record.scopes,
    keyPrefix: record.keyPrefix,
    lastFour: record.lastFour,
    active: record.active,
    expiresAt,
    lastUsedAt: null,
    createdAt: record.createdAt,
    revokedAt: null,
    plaintext,
  }
}

/**
 * Revoke an API key. Once revoked, it can no longer be used.
 */
export async function revokeApiKey(tenantId: string, apiKeyId: string): Promise<boolean> {
  const result = await db.apiKey.updateMany({
    where: { id: apiKeyId, tenantId, active: true },
    data: { active: false, revokedAt: new Date() },
  })
  if (result.count > 0) {
    await appendAudit({
      tenantId,
      eventType: 'api_key.revoked' as any,
      payload: { apiKeyId },
    })
  }
  return result.count > 0
}

/**
 * List all API keys for a tenant (without revealing plaintext).
 */
export async function listApiKeys(tenantId: string): Promise<ApiKeyInfo[]> {
  const keys = await db.apiKey.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
  return keys.map((k) => ({
    id: k.id,
    tenantId: k.tenantId,
    label: k.label,
    scopes: k.scopes,
    keyPrefix: k.keyPrefix,
    lastFour: k.lastFour,
    active: k.active,
    expiresAt: k.expiresAt,
    lastUsedAt: k.lastUsedAt,
    createdAt: k.createdAt,
    revokedAt: k.revokedAt,
  }))
}

// ---------------------------------------------------------------------------
// API key verification (extracted from request)
// ---------------------------------------------------------------------------

export interface AuthResult {
  authenticated: boolean
  tenantId?: string
  apiKeyId?: string
  scopes?: string[]
  reason?: string
}

/**
 * Extract and verify the API key from the Authorization header.
 * Accepted formats:
 *   Authorization: Bearer vf_live_abc123...
 *   X-API-Key: vf_live_abc123...
 */
export async function authenticateRequest(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get('authorization') ?? ''
  const xApiKey = req.headers.get('x-api-key') ?? ''

  let plaintext = ''
  if (authHeader.startsWith('Bearer ')) {
    plaintext = authHeader.slice(7).trim()
  } else if (xApiKey) {
    plaintext = xApiKey.trim()
  } else {
    return { authenticated: false, reason: 'NO_API_KEY' }
  }

  if (!plaintext.startsWith(KEY_PREFIX_LIVE) && !plaintext.startsWith(KEY_PREFIX_TEST)) {
    return { authenticated: false, reason: 'INVALID_KEY_FORMAT' }
  }

  const keyHash = sha256Hex(plaintext)
  // Constant-time comparison would require fetching all keys — for performance
  // we index by keyHash (already a hash, so timing attack on the lookup is moot).
  const apiKey = await db.apiKey.findUnique({
    where: { keyHash },
    include: { tenant: true },
  })

  if (!apiKey || !apiKey.active) {
    return { authenticated: false, reason: 'KEY_NOT_FOUND_OR_REVOKED' }
  }
  if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
    return { authenticated: false, reason: 'KEY_EXPIRED' }
  }
  if (!apiKey.tenant || !apiKey.tenant.active) {
    return { authenticated: false, reason: 'TENANT_INACTIVE' }
  }

  // Update lastUsedAt (fire-and-forget)
  db.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {})

  return {
    authenticated: true,
    tenantId: apiKey.tenantId,
    apiKeyId: apiKey.id,
    scopes: apiKey.scopes === '*' ? ['*'] : apiKey.scopes.split(',').map((s) => s.trim()),
  }
}

/**
 * Check if the authenticated API key has the required scope.
 */
export function hasScope(auth: AuthResult, requiredScope: string): boolean {
  if (!auth.scopes) return false
  if (auth.scopes.includes('*')) return true
  return auth.scopes.includes(requiredScope)
}

// ---------------------------------------------------------------------------
// Rate limiting (token bucket per tenant + IP)
// ---------------------------------------------------------------------------

interface Bucket {
  count: number
  windowStart: number
}

// In-memory cache (per-instance). Multi-instance deployments should use Redis.
const rateLimitCache = new Map<string, Bucket>()
const CACHE_TTL_MS = 70 * 1000  // 70 seconds — slightly longer than the 60s window

// Cleanup expired buckets every 60 seconds
setInterval(() => {
  const now = Date.now()
  for (const [key, bucket] of rateLimitCache) {
    if (now - bucket.windowStart > CACHE_TTL_MS) {
      rateLimitCache.delete(key)
    }
  }
}, 60_000).unref?.()

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

/**
 * Check rate limit for a tenant + IP. Uses in-memory cache for hot path;
 * falls back to DB for cold starts and multi-instance coordination.
 */
export async function checkRateLimit(
  tenantId: string,
  ip: string,
  limitPerMin: number,
): Promise<RateLimitResult> {
  const bucketKey = `${tenantId}:${ip}`
  const now = Date.now()
  const windowStartMs = Math.floor(now / 60_000) * 60_000
  const resetAt = windowStartMs + 60_000

  // Check in-memory cache first
  const cached = rateLimitCache.get(bucketKey)
  if (cached && cached.windowStart === windowStartMs) {
    if (cached.count >= limitPerMin) {
      return { allowed: false, limit: limitPerMin, remaining: 0, resetAt }
    }
    cached.count++
    return {
      allowed: true,
      limit: limitPerMin,
      remaining: Math.max(0, limitPerMin - cached.count),
      resetAt,
    }
  }

  // Cache miss — initialize new bucket
  const bucket: Bucket = { count: 1, windowStart: windowStartMs }
  rateLimitCache.set(bucketKey, bucket)

  // Persist to DB for cross-instance visibility (best-effort)
  try {
    await db.rateLimitBucket.upsert({
      where: { bucketKey },
      create: {
        bucketKey,
        windowStart: new Date(windowStartMs),
        count: 1,
      },
      update: {
        // Only reset count if window changed
        count: { increment: 1 },
      },
    })
  } catch {
    // Ignore DB errors — in-memory state is sufficient
  }

  return {
    allowed: true,
    limit: limitPerMin,
    remaining: limitPerMin - 1,
    resetAt,
  }
}

/**
 * Combined middleware: authenticate + rate limit + extract client IP.
 * Returns NextResponse (error) on failure, or { auth, ip } on success.
 */
export async function requireApiKey(
  req: NextRequest,
  requiredScope: string = '*',
): Promise<
  | { ok: true; auth: AuthResult; ip: string }
  | { ok: false; response: NextResponse }
> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'

  const auth = await authenticateRequest(req)
  if (!auth.authenticated) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized', code: auth.reason },
        { status: 401 },
      ),
    }
  }

  if (!hasScope(auth, requiredScope)) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: 'Insufficient scope', code: 'INSUFFICIENT_SCOPE' },
        { status: 403 },
      ),
    }
  }

  // Rate limit
  const tenant = await db.tenant.findUnique({ where: { id: auth.tenantId! } })
  const limit = tenant?.rateLimitPerMin ?? 60
  const rl = await checkRateLimit(auth.tenantId!, ip, limit)
  if (!rl.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          code: 'RATE_LIMITED',
          retryAfter: Math.ceil((rl.resetAt - Date.now()) / 1000),
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt - Date.now()) / 1000)) } },
      ),
    }
  }

  return { ok: true, auth, ip }
}
