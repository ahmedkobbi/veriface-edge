/**
 * GET /api/admin/plan
 * Returns the current tenant's plan tier + monthly usage + spending limit config.
 *
 * PUT /api/admin/plan
 * Update plan-related config (spending limit, alert threshold, plan tier).
 *
 * Plan tier change requires admin role. Spending limit + alert threshold
 * can be set by any tenant admin.
 *
 * NOTE: In production, plan tier changes would be tied to Stripe subscription
 * updates. Here we allow direct tier changes for demo/testing purposes.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import {
  getPlan,
  getMonthlyUsage,
  updateTenantPlan,
  type PlanTier,
} from '@/lib/rate-limit-tiers'
import { z } from 'zod'

const PlanUpdateSchema = z.object({
  planTier: z.enum(['developer', 'growth', 'enterprise']).optional(),
  spendingLimitUsd: z.number().min(0).max(1_000_000).optional(),
  alertThresholdPct: z.number().min(0).max(100).optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: {
      planTier: true,
      spendingLimitUsd: true,
      alertThresholdPct: true,
      rateLimitPerMin: true,
    },
  })

  if (!tenant) {
    return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 })
  }

  const plan = getPlan(tenant.planTier)
  const usage = await getMonthlyUsage(session.tenantId, tenant.planTier)

  // Calculate spending metrics
  const estimatedCost = usage.count * plan.pricePerAuth
  const spendingPct = tenant.spendingLimitUsd > 0
    ? (estimatedCost / tenant.spendingLimitUsd) * 100
    : 0

  // Days until month reset
  const now = new Date()
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const daysUntilReset = Math.ceil((nextMonth.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))

  return NextResponse.json({
    success: true,
    plan: {
      tier: plan.tier,
      tierName: plan.displayName,
      pricePerAuth: plan.pricePerAuth,
      monthlyLimit: plan.monthlyLimit,
      perMinuteLimit: plan.perMinuteLimit,
      features: plan.features,
      accentColor: plan.accentColor,
    },
    config: {
      spendingLimitUsd: tenant.spendingLimitUsd,
      alertThresholdPct: tenant.alertThresholdPct,
      customPerMinuteLimit: tenant.rateLimitPerMin,
    },
    usage: {
      monthKey: usage.monthKey,
      authsThisMonth: usage.count,
      estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      spendingPct: parseFloat(spendingPct.toFixed(1)),
      authsRemaining: usage.remaining,
      usedPct: usage.usedPct === -1 ? 0 : parseFloat(usage.usedPct.toFixed(1)),
      limitReached: usage.limitReached,
      alertTriggered: usage.alertTriggered,
      daysUntilReset,
      resetsAt: nextMonth.toISOString(),
    },
  })
}

export async function PUT(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can update plan settings' }, { status: 403 })
  }

  const body = await req.json()
  const validation = PlanUpdateSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { planTier, spendingLimitUsd, alertThresholdPct } = validation.data

  await updateTenantPlan(
    session.tenantId,
    (planTier ?? 'developer') as PlanTier,
    {
      spendingLimitUsd,
      alertThresholdPct,
    },
  )

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: {
      action: 'plan_updated',
      planTier,
      spendingLimitUsd,
      alertThresholdPct,
    },
  })

  return NextResponse.json({
    success: true,
    message: planTier ? `Plan updated to ${planTier}` : 'Plan settings updated',
  })
}
