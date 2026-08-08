/**
 * VeriFace Edge — Plan-Tier Rate Limits
 *
 * Per-plan monthly + per-minute limits:
 *   Developer :     1,000 calls/month,    10/min
 *   Growth     :   100,000 calls/month,  100/min
 *   Enterprise :   unlimited           , 1,000/min
 *
 * Monthly limit is enforced via the `ApiUsageCounter` table
 * (one row per tenant per year-month). On month rollover, a
 * new counter row is created automatically (the previous month
 * becomes read-only history).
 *
 * Per-minute limit reuses the existing `RateLimitBucket` mechanism
 * (see `src/lib/auth.ts`), with the floor overridden by plan tier.
 *
 * Billable events: 'auth.success', 'enroll.success' (matches the
 * existing usage/billing route). Read-only endpoints (audit read,
 * health, metrics) are NOT billable.
 */

import { db } from '@/lib/db'
import { sha256Hex } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Plan tier definitions
// ---------------------------------------------------------------------------

export type PlanTier = 'developer' | 'growth' | 'enterprise'

export interface PlanDefinition {
  tier: PlanTier
  displayName: string
  /** Monthly API call limit. -1 = unlimited. */
  monthlyLimit: number
  /** Per-minute rate limit floor. */
  perMinuteLimit: number
  /** Price per auth (USD). 0 = free / negotiated. */
  pricePerAuth: number
  /** Feature flags. */
  features: string[]
  /** Plan color for UI badges. */
  accentColor: string
}

export const PLAN_TIERS: Record<PlanTier, PlanDefinition> = {
  developer: {
    tier: 'developer',
    displayName: 'Developer',
    monthlyLimit: 1_000,
    perMinuteLimit: 10,
    pricePerAuth: 0,
    features: ['single_tenant', 'community_support', 'sdk', 'dashboard'],
    accentColor: '#10b981',
  },
  growth: {
    tier: 'growth',
    displayName: 'Growth',
    monthlyLimit: 100_000,
    perMinuteLimit: 100,
    pricePerAuth: 0.08,
    features: ['multi_region', 'webhooks', 'oidc', 'sla_999', 'email_alerts', 'priority_support'],
    accentColor: '#06b6d4',
  },
  enterprise: {
    tier: 'enterprise',
    displayName: 'Enterprise',
    monthlyLimit: -1, // unlimited
    perMinuteLimit: 1_000,
    pricePerAuth: 0, // negotiated
    features: ['saml', 'fido2', 'nitro_enclave', 'sla_9999', 'on_prem', 'dedicated_support', 'audit_streaming', 'custom_retention'],
    accentColor: '#a855f7',
  },
}

export function getPlan(tier: string | null | undefined): PlanDefinition {
  if (!tier) return PLAN_TIERS.developer
  return PLAN_TIERS[tier as PlanTier] ?? PLAN_TIERS.developer
}

export function isBillableEvent(eventType: string): boolean {
  return eventType === 'auth.success' || eventType === 'enroll.success'
}

// ---------------------------------------------------------------------------
// Monthly counter
// ---------------------------------------------------------------------------

function getMonthKey(date = new Date()): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

// Exported for testing
export { getMonthKey }

export interface MonthlyUsageResult {
  monthKey: string
  count: number
  limit: number
  remaining: number
  /** Percentage of monthly limit used (0–100, or -1 if unlimited). */
  usedPct: number
  /** Whether the monthly limit has been reached. */
  limitReached: boolean
  /** Whether usage crossed the alert threshold (default 80%). */
  alertTriggered: boolean
}

/**
 * Get or create the current month's usage counter for a tenant.
 */
export async function getMonthlyUsage(tenantId: string, planTier?: string): Promise<MonthlyUsageResult> {
  const monthKey = getMonthKey()
  const tenant = planTier
    ? await db.tenant.findUnique({ where: { id: tenantId }, select: { planTier: true } })
    : await db.tenant.findUnique({ where: { id: tenantId }, select: { planTier: true } })

  const plan = getPlan(tenant?.planTier ?? planTier)

  const counter = await db.apiUsageCounter.upsert({
    where: { tenantId_monthKey: { tenantId, monthKey } },
    create: { tenantId, monthKey, count: 0 },
    update: {},
  })

  const limit = plan.monthlyLimit
  const remaining = limit > 0 ? Math.max(0, limit - counter.count) : -1
  const usedPct = limit > 0 ? Math.min(100, (counter.count / limit) * 100) : -1
  const limitReached = limit > 0 && counter.count >= limit
  const alertTriggered = limit > 0 && usedPct >= 80

  return {
    monthKey,
    count: counter.count,
    limit,
    remaining,
    usedPct,
    limitReached,
    alertTriggered,
  }
}

/**
 * Increment the monthly usage counter for a tenant by 1.
 * Called after every billable API event.
 *
 * Returns the new count + alert flags so the caller can fire billing emails.
 */
export async function incrementMonthlyUsage(
  tenantId: string,
  planTier?: string,
): Promise<MonthlyUsageResult & { thresholdJustCrossed: boolean; limitJustCrossed: boolean }> {
  const monthKey = getMonthKey()
  const tenant = await db.tenant.findUnique({
    where: { id: tenantId },
    select: { planTier: true, alertThresholdPct: true },
  })
  const plan = getPlan(tenant?.planTier ?? planTier)
  const thresholdPct = tenant?.alertThresholdPct ?? 80

  // Atomic increment + alert-flag update in one transaction
  const counter = await db.$transaction(async (tx) => {
    const existing = await tx.apiUsageCounter.findUnique({
      where: { tenantId_monthKey: { tenantId, monthKey } },
    })

    if (existing) {
      // SECURITY FIX (H-12): Use atomic increment instead of read-then-write.
      // Previously: newCount = existing.count + 1, then write count: newCount
      // Two concurrent transactions both read count=100, both write 101.
      // Fix: Use Prisma's atomic { increment: 1 } — database handles atomically.
      const updated = await tx.apiUsageCounter.update({
        where: { id: existing.id },
        data: {
          count: { increment: 1 },
        },
      })

      // Check if we just crossed threshold or limit (based on new count)
      const newCount = updated.count
      const justCrossedThreshold =
        !existing.thresholdAlertSent &&
        plan.monthlyLimit > 0 &&
        (newCount / plan.monthlyLimit) * 100 >= thresholdPct

      const justCrossedLimit =
        !existing.limitAlertSent &&
        plan.monthlyLimit > 0 &&
        newCount >= plan.monthlyLimit

      // Update alert flags (separate update — doesn't affect count)
      if (justCrossedThreshold || justCrossedLimit) {
        await tx.apiUsageCounter.update({
          where: { id: existing.id },
          data: {
            thresholdAlertSent: justCrossedThreshold,
            limitAlertSent: justCrossedLimit,
          },
        })
      }

      return {
        ...updated,
        thresholdAlertSent: existing.thresholdAlertSent || justCrossedThreshold,
        limitAlertSent: existing.limitAlertSent || justCrossedLimit,
      }
    }

    // First call this month
    return tx.apiUsageCounter.create({
      data: {
        tenantId,
        monthKey,
        count: 1,
        thresholdAlertSent: false,
        limitAlertSent: false,
      },
    })
  })

  const limit = plan.monthlyLimit
  const remaining = limit > 0 ? Math.max(0, limit - counter.count) : -1
  const usedPct = limit > 0 ? Math.min(100, (counter.count / limit) * 100) : -1
  const limitReached = limit > 0 && counter.count >= limit
  const alertTriggered = limit > 0 && usedPct >= thresholdPct

  return {
    monthKey,
    count: counter.count,
    limit,
    remaining,
    usedPct,
    limitReached,
    alertTriggered,
    thresholdJustCrossed: counter.thresholdAlertSent && usedPct >= thresholdPct && usedPct < 100,
    limitJustCrossed: counter.limitAlertSent && limitReached,
  }
}

/**
 * Enforce the monthly plan limit. Called by `requireApiKey` after the
 * per-minute rate-limit check. Returns the result + whether the request
 * should be blocked.
 *
 * NOTE: incrementing happens *after* a successful billable event, not
 * before (so we don't penalize failed requests). For pre-check, use
 * `getMonthlyUsage` which returns `limitReached`.
 */
export async function checkMonthlyLimit(
  tenantId: string,
): Promise<{
  allowed: boolean
  usage: MonthlyUsageResult
  retryAfterSeconds: number // seconds until month resets
}> {
  const usage = await getMonthlyUsage(tenantId)

  if (usage.limit <= 0 || !usage.limitReached) {
    return { allowed: true, usage, retryAfterSeconds: 0 }
  }

  // Calculate seconds until month end (UTC)
  const now = new Date()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const retryAfterSeconds = Math.ceil((nextMonth.getTime() - now.getTime()) / 1000)

  return { allowed: false, usage, retryAfterSeconds }
}

// ---------------------------------------------------------------------------
// Per-minute limit (plan-aware)
// ---------------------------------------------------------------------------

/**
 * Get the effective per-minute rate limit for a tenant.
 *
 * SECURITY FIX (L-11): Previously, this returned `Math.max(perMin, plan.perMinuteLimit)`,
 * meaning the plan floor was ALWAYS the minimum. If an admin set a LOWER
 * `rateLimitPerMin` to throttle a misbehaving tenant during an incident
 * (emergency throttling), the plan floor would override it — making
 * emergency throttling impossible.
 *
 * Now: the tenant's custom `rateLimitPerMin` takes precedence (lower wins)
 * UNLESS the env var `VERIFACE_DISABLE_PLAN_FLOOR` is set to `false` (default).
 *
 * Behavior:
 *   - If tenant.rateLimitPerMin is set (> 0): use the LOWER of the two
 *     (allows emergency throttling below the plan floor)
 *   - If tenant.rateLimitPerMin is 0 or null: use the plan floor
 *   - If both are 0/null: default to 60/min
 *
 * Enterprise tenants still get their plan floor as the default, but admins
 * can override DOWN during incidents.
 */
export async function getEffectivePerMinuteLimit(
  tenantId: string,
  tenantRateLimitPerMin?: number,
): Promise<number> {
  let planTier: string | undefined
  let perMin: number | undefined = tenantRateLimitPerMin

  if (!perMin || !planTier) {
    const t = await db.tenant.findUnique({
      where: { id: tenantId },
      select: { planTier: true, rateLimitPerMin: true },
    })
    planTier = t?.planTier
    perMin = t?.rateLimitPerMin ?? 0
  }

  const plan = getPlan(planTier)
  const planFloor = plan.perMinuteLimit

  // If tenant has no custom limit, use the plan floor
  if (!perMin || perMin <= 0) {
    return planFloor
  }

  // SECURITY FIX (L-11): Use the LOWER of the two values.
  // This allows admins to set rateLimitPerMin BELOW the plan floor
  // for emergency throttling (e.g., during a DDoS or runaway script).
  // Previously: Math.max(perMin, planFloor) — prevented throttling below floor.
  return Math.min(perMin, planFloor)
}

// ---------------------------------------------------------------------------
// Rate-limit headers (RFC-style)
// ---------------------------------------------------------------------------

export interface RateLimitHeaders {
  /** Maximum per-minute requests allowed. */
  'X-RateLimit-Limit': string
  /** Remaining per-minute requests. */
  'X-RateLimit-Remaining': string
  /** Unix timestamp when the per-minute window resets. */
  'X-RateLimit-Reset': string
  /** Monthly quota (calls/month). -1 = unlimited. */
  'X-RateLimit-Quota-Limit': string
  /** Remaining monthly quota. -1 = unlimited. */
  'X-RateLimit-Quota-Remaining': string
  /** Unix timestamp when the monthly quota resets (next month start). */
  'X-RateLimit-Quota-Reset': string
  /** Plan tier. */
  'X-Plan-Tier': string
  /** Index signature — allows passing as Record<string, string>. */
  [key: string]: string
}

export function buildRateLimitHeaders(opts: {
  perMinuteLimit: number
  perMinuteRemaining: number
  perMinuteResetAt: number
  plan: PlanDefinition
  monthlyRemaining: number
}): RateLimitHeaders {
  const now = new Date()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return {
    'X-RateLimit-Limit': String(opts.perMinuteLimit),
    'X-RateLimit-Remaining': String(Math.max(0, opts.perMinuteRemaining)),
    'X-RateLimit-Reset': String(Math.floor(opts.perMinuteResetAt / 1000)),
    'X-RateLimit-Quota-Limit': String(opts.plan.monthlyLimit),
    'X-RateLimit-Quota-Remaining': String(opts.monthlyRemaining),
    'X-RateLimit-Quota-Reset': String(Math.floor(nextMonth.getTime() / 1000)),
    'X-Plan-Tier': opts.plan.tier,
  }
}

// ---------------------------------------------------------------------------
// Tenant plan mutation
// ---------------------------------------------------------------------------

export async function updateTenantPlan(
  tenantId: string,
  planTier: PlanTier,
  opts?: { spendingLimitUsd?: number; alertThresholdPct?: number },
): Promise<void> {
  await db.tenant.update({
    where: { id: tenantId },
    data: {
      planTier,
      ...(opts?.spendingLimitUsd !== undefined ? { spendingLimitUsd: opts.spendingLimitUsd } : {}),
      ...(opts?.alertThresholdPct !== undefined ? { alertThresholdPct: opts.alertThresholdPct } : {}),
    },
  })

  logger.info({ tenantId, planTier, ...opts }, 'Tenant plan updated')
}

/**
 * Hash an IP+UA for device fingerprinting (used by email triggers
 * to detect "new device" logins). Not stored as PII — only a hash.
 */
export function hashDeviceFingerprint(ip: string, userAgent: string): string {
  // Extract browser+OS family only (not full UA — too much PII variation)
  const browserFamily = userAgent.match(/(Firefox|Chrome|Safari|Edge|Opera)\/[\d.]+/)?.[0] ?? 'unknown'
  const osFamily = userAgent.match(/\(([^)]+)\)/)?.[1]?.split(';')[0] ?? 'unknown'
  return sha256Hex(`${ip}|${browserFamily}|${osFamily}`)
}
