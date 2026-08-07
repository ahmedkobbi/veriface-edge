/**
 * VeriFace Edge — Idempotency Key Support
 *
 * Allows clients to safely retry POST requests without side effects.
 * If a request with the same Idempotency-Key is received within 24h,
 * the cached response is returned instead of re-executing.
 *
 * Usage:
 *   POST /api/session/verify
 *   Idempotency-Key: <uuid>
 *   ...
 *
 *   → First request: executes, caches response
 *   → Retry with same key: returns cached response (200)
 *   → Retry with different key: executes new request
 */

import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto-server'

const CACHE_TTL_HOURS = 24

interface CachedResponse {
  status: number
  body: unknown
  cachedAt: number
}

// In-memory cache (multi-instance deployments should use Redis)
const idempotencyCache = new Map<string, CachedResponse>()

// Cleanup expired entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - CACHE_TTL_HOURS * 60 * 60 * 1000
  for (const [key, entry] of idempotencyCache) {
    if (entry.cachedAt < cutoff) {
      idempotencyCache.delete(key)
    }
  }
}, 10 * 60 * 1000).unref?.()

/**
 * Check if a request with this idempotency key has already been processed.
 * Returns the cached response if found, null otherwise.
 *
 * The key is scoped to tenantId + endpoint + key to prevent cross-tenant
 * collision attacks.
 */
export function getIdempotentResponse(
  tenantId: string,
  endpoint: string,
  idempotencyKey: string,
): CachedResponse | null {
  const cacheKey = buildCacheKey(tenantId, endpoint, idempotencyKey)
  const cached = idempotencyCache.get(cacheKey)
  if (!cached) return null

  // Check TTL
  if (Date.now() - cached.cachedAt > CACHE_TTL_HOURS * 60 * 60 * 1000) {
    idempotencyCache.delete(cacheKey)
    return null
  }

  return cached
}

/**
 * Cache a response for idempotent retry.
 */
export function cacheIdempotentResponse(
  tenantId: string,
  endpoint: string,
  idempotencyKey: string,
  status: number,
  body: unknown,
): void {
  const cacheKey = buildCacheKey(tenantId, endpoint, idempotencyKey)
  idempotencyCache.set(cacheKey, {
    status,
    body,
    cachedAt: Date.now(),
  })
}

function buildCacheKey(tenantId: string, endpoint: string, idempotencyKey: string): string {
  // Hash the composite key to prevent leakage via cache inspection
  return sha256Hex(`${tenantId}|${endpoint}|${idempotencyKey}`)
}

/**
 * Extract idempotency key from request headers.
 * Returns null if not present.
 */
export function extractIdempotencyKey(req: Request): string | null {
  const key = req.headers.get('idempotency-key')
  if (!key) return null
  // Validate format: UUID or alphanumeric, 1-256 chars
  if (!/^[a-zA-Z0-9_\-]{1,256}$/.test(key)) return null
  return key
}
