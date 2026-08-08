/**
 * VeriFace Edge — Redis Cache Layer
 *
 * Multi-layer caching for hot paths:
 *   1. API key lookup cache (avoid DB hit on every authenticated request)
 *   2. Tenant config cache (avoid DB hit on every rate limit check)
 *   3. Rate limit bucket cache (multi-instance coordination)
 *   4. ZK verification key cache (avoid file read)
 *   5. Monthly usage counter cache (avoid DB hit on every billable event)
 *
 * Architecture:
 *   - L1: In-memory LRU cache (per-instance, sub-millisecond)
 *   - L2: Redis (cross-instance, ~1ms)
 *   - L3: Database (source of truth, ~5-10ms)
 *
 * Cache invalidation:
 *   - API key: invalidated on revoke (TTL: 5 min as fallback)
 *   - Tenant config: invalidated on plan change (TTL: 5 min as fallback)
 *   - Rate limit: TTL = 60s (window duration)
 *   - ZK vkey: TTL = 1 hour (immutable until re-ceremony)
 *   - Monthly usage: write-through (increment in Redis, sync to DB periodically)
 *
 * Environment:
 *   REDIS_URL — redis://localhost:6379 (required in production for multi-instance)
 *   If not set, falls back to in-memory only (single-instance dev mode).
 */

import { createClient, type RedisClientType } from 'redis'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// L1: In-memory LRU cache
// ---------------------------------------------------------------------------

class LRUCache<K, V> {
  private cache = new Map<K, V>()
  private max_size: number

  constructor(max_size: number = 1000) {
    this.max_size = max_size
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key)
      this.cache.set(key, value)
    }
    return value
  }

  set(key: K, value: V): void {
    if (this.cache.size >= this.max_size) {
      // Delete oldest entry (first in Map)
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  delete(key: K): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  get size(): number {
    return this.cache.size
  }
}

// ---------------------------------------------------------------------------
// Redis client (lazy init)
// ---------------------------------------------------------------------------

let redisClient: RedisClientType | null = null
let redisConnected = false

/**
 * Get the Redis client. Returns null if Redis is not configured.
 * In that case, only the L1 in-memory cache is used.
 */
export async function getRedis(): Promise<RedisClientType | null> {
  const redisUrl = process.env.REDIS_URL

  if (!redisUrl) {
    return null // Dev mode — in-memory only
  }

  if (!redisClient) {
    redisClient = createClient({ url: redisUrl }) as RedisClientType

    redisClient.on('error', (err: Error) => {
      logger.error({ error: err }, 'Redis client error')
    })

    redisClient.on('connect', () => {
      logger.info('Redis connected')
      redisConnected = true
    })

    redisClient.on('disconnect', () => {
      logger.warn('Redis disconnected — falling back to in-memory cache')
      redisConnected = false
    })

    try {
      await redisClient.connect()
    } catch (e) {
      logger.error({ error: e }, 'Failed to connect to Redis — using in-memory only')
      return null
    }
  }

  if (!redisConnected) {
    return null
  }

  return redisClient
}

export function isRedisAvailable(): boolean {
  return redisConnected
}

// ---------------------------------------------------------------------------
// Multi-layer cache
// ---------------------------------------------------------------------------

// L1 caches (per-instance)
const apiKeyCache = new LRUCache<string, any>(500) // API key hash → key record
const tenantCache = new LRUCache<string, any>(100) // tenantId → tenant record
const zkVkeyCache = new LRUCache<string, object>(1) // 'vkey' → verification key
const usageCache = new LRUCache<string, number>(1000) // tenantId:monthKey → count

// Cache TTLs (seconds)
const TTL_API_KEY = 300 // 5 min
const TTL_TENANT = 300 // 5 min
const TTL_ZK_VKEY = 3600 // 1 hour
const TTL_USAGE = 60 // 1 min

// ---------------------------------------------------------------------------
// API Key cache
// ---------------------------------------------------------------------------

/**
 * Get an API key from cache (L1 → L2 → DB).
 * Falls back gracefully: if Redis is down, uses L1 only.
 */
export async function getCachedApiKey(
  keyHash: string,
  dbLookup: () => Promise<any>,
): Promise<any | null> {
  const cacheKey = `apikey:${keyHash}`

  // L1: In-memory
  const l1 = apiKeyCache.get(cacheKey)
  if (l1) return l1

  // L2: Redis
  const redis = await getRedis()
  if (redis) {
    try {
      const l2 = await redis.get(cacheKey)
      if (l2) {
        const parsed = JSON.parse(l2)
        apiKeyCache.set(cacheKey, parsed) // Populate L1
        return parsed
      }
    } catch {
      // Redis error — fall through to DB
    }
  }

  // L3: Database
  const dbResult = await dbLookup()
  if (dbResult) {
    // Populate L1 + L2
    apiKeyCache.set(cacheKey, dbResult)
    if (redis) {
      try {
        await redis.setEx(cacheKey, TTL_API_KEY, JSON.stringify(dbResult))
      } catch {}
    }
  }

  return dbResult
}

/**
 * Invalidate the API key cache (on revoke or update).
 */
export async function invalidateApiKeyCache(keyHash: string): Promise<void> {
  const cacheKey = `apikey:${keyHash}`
  apiKeyCache.delete(cacheKey)

  const redis = await getRedis()
  if (redis) {
    try {
      await redis.del(cacheKey)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// Tenant config cache
// ---------------------------------------------------------------------------

/**
 * Get tenant config from cache (L1 → L2 → DB).
 */
export async function getCachedTenant(
  tenantId: string,
  dbLookup: () => Promise<any>,
): Promise<any | null> {
  const cacheKey = `tenant:${tenantId}`

  // L1
  const l1 = tenantCache.get(cacheKey)
  if (l1) return l1

  // L2
  const redis = await getRedis()
  if (redis) {
    try {
      const l2 = await redis.get(cacheKey)
      if (l2) {
        const parsed = JSON.parse(l2)
        tenantCache.set(cacheKey, parsed)
        return parsed
      }
    } catch {}
  }

  // L3
  const dbResult = await dbLookup()
  if (dbResult) {
    tenantCache.set(cacheKey, dbResult)
    if (redis) {
      try {
        await redis.setEx(cacheKey, TTL_TENANT, JSON.stringify(dbResult))
      } catch {}
    }
  }

  return dbResult
}

/**
 * Invalidate tenant cache (on plan change, config update).
 */
export async function invalidateTenantCache(tenantId: string): Promise<void> {
  const cacheKey = `tenant:${tenantId}`
  tenantCache.delete(cacheKey)

  const redis = await getRedis()
  if (redis) {
    try {
      await redis.del(cacheKey)
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// ZK verification key cache
// ---------------------------------------------------------------------------

/**
 * Get the ZK verification key from cache (L1 → L2 → file).
 * The key is immutable until the trusted setup is re-run.
 */
export async function getCachedZkVKey(
  fileLookup: () => Promise<object>,
): Promise<object | null> {
  const cacheKey = 'zk:vkey'

  // L1
  const l1 = zkVkeyCache.get(cacheKey)
  if (l1) return l1

  // L2
  const redis = await getRedis()
  if (redis) {
    try {
      const l2 = await redis.get(cacheKey)
      if (l2) {
        const parsed = JSON.parse(l2)
        zkVkeyCache.set(cacheKey, parsed)
        return parsed
      }
    } catch {}
  }

  // L3: File
  try {
    const fileResult = await fileLookup()
    zkVkeyCache.set(cacheKey, fileResult)
    if (redis) {
      try {
        await redis.setEx(cacheKey, TTL_ZK_VKEY, JSON.stringify(fileResult))
      } catch {}
    }
    return fileResult
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Rate limit cache (Redis-based for multi-instance)
// ---------------------------------------------------------------------------

/**
 * Check + increment rate limit using Redis (atomic operation).
 * Falls back to in-memory if Redis is not available.
 *
 * Uses Redis INCR with EXPIRE for atomic sliding window.
 */
export async function checkCachedRateLimit(
  tenantId: string,
  ip: string,
  limit: number,
): Promise<{ allowed: boolean; count: number; resetAt: number }> {
  const bucketKey = `ratelimit:${tenantId}:${ip}`
  const now = Date.now()
  const windowStartMs = Math.floor(now / 60_000) * 60_000
  const resetAt = windowStartMs + 60_000

  const redis = await getRedis()
  if (redis) {
    try {
      // Atomic INCR + EXPIRE
      const count = await redis.incr(bucketKey)
      if (count === 1) {
        // First request in window — set TTL
        await redis.expire(bucketKey, 60)
      }

      if (count > limit) {
        return { allowed: false, count, resetAt }
      }

      return { allowed: true, count, resetAt }
    } catch {
      // Redis error — fall back to in-memory
    }
  }

  // Fallback: in-memory (single-instance only)
  return checkInMemoryRateLimit(tenantId, ip, limit)
}

// In-memory rate limit (fallback when Redis is unavailable)
const rateLimitCache = new Map<string, { count: number; windowStart: number }>()

function checkInMemoryRateLimit(
  tenantId: string,
  ip: string,
  limit: number,
): { allowed: boolean; count: number; resetAt: number } {
  const bucketKey = `${tenantId}:${ip}`
  const now = Date.now()
  const windowStartMs = Math.floor(now / 60_000) * 60_000
  const resetAt = windowStartMs + 60_000

  const cached = rateLimitCache.get(bucketKey)
  if (cached && cached.windowStart === windowStartMs) {
    if (cached.count >= limit) {
      // SECURITY FIX (M-18): Previously returned `{ allowed: false, remaining: 0, resetAt }`
      // — wrong shape (missing `count`, has extra `remaining` field). The function's
      // return type is `{ allowed, count, resetAt }`. Callers reading `count` would
      // get `undefined`, breaking rate-limit-exceeded logging and metrics.
      return { allowed: false, count: cached.count, resetAt }
    }
    cached.count++
    return { allowed: true, count: cached.count, resetAt }
  }

  rateLimitCache.set(bucketKey, { count: 1, windowStart: windowStartMs })
  return { allowed: true, count: 1, resetAt }
}

// ---------------------------------------------------------------------------
// Monthly usage counter cache (Redis-based for multi-instance)
// ---------------------------------------------------------------------------

/**
 * Get monthly usage from cache (L1 → L2 → DB).
 */
export async function getCachedMonthlyUsage(
  tenantId: string,
  monthKey: string,
  dbLookup: () => Promise<number>,
): Promise<number> {
  const cacheKey = `usage:${tenantId}:${monthKey}`

  // L1
  const l1 = usageCache.get(cacheKey)
  if (l1 !== undefined) return l1

  // L2
  const redis = await getRedis()
  if (redis) {
    try {
      const l2 = await redis.get(cacheKey)
      if (l2 !== null) {
        const parsed = parseInt(l2, 10)
        usageCache.set(cacheKey, parsed)
        return parsed
      }
    } catch {}
  }

  // L3
  const dbResult = await dbLookup()
  usageCache.set(cacheKey, dbResult)
  if (redis) {
    try {
      await redis.setEx(cacheKey, TTL_USAGE, String(dbResult))
    } catch {}
  }

  return dbResult
}

/**
 * Increment monthly usage in Redis (atomic) + sync to DB periodically.
 * Returns the new count.
 */
export async function incrementCachedUsage(
  tenantId: string,
  monthKey: string,
): Promise<number> {
  const cacheKey = `usage:${tenantId}:${monthKey}`

  const redis = await getRedis()
  if (redis) {
    try {
      const newCount = await redis.incr(cacheKey)
      await redis.expire(cacheKey, 86400) // 24-hour TTL (re-fetched from DB if expired)
      // Update L1
      usageCache.set(cacheKey, newCount)
      return newCount
    } catch {}
  }

  // Fallback: just update L1 (DB increment happens separately)
  const current = usageCache.get(cacheKey) ?? 0
  const newCount = current + 1
  usageCache.set(cacheKey, newCount)
  return newCount
}

// ---------------------------------------------------------------------------
// Cache statistics (for monitoring)
// ---------------------------------------------------------------------------

export function getCacheStats() {
  return {
    l1: {
      apiKeyCacheSize: apiKeyCache.size,
      tenantCacheSize: tenantCache.size,
      zkVkeyCacheSize: zkVkeyCache.size,
      usageCacheSize: usageCache.size,
      rateLimitCacheSize: rateLimitCache.size,
    },
    l2: {
      redisConnected,
      redisUrl: process.env.REDIS_URL ? 'configured' : 'not configured',
    },
  }
}

/**
 * Clear all L1 caches (for testing or cache flush).
 */
export function clearAllL1Caches(): void {
  apiKeyCache.clear()
  tenantCache.clear()
  zkVkeyCache.clear()
  usageCache.clear()
  rateLimitCache.clear()
}
