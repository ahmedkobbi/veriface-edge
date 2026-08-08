/**
 * GET /api/admin/usage/plan — Get current plan + spending limits + monthly usage
 * PUT /api/admin/usage/plan — Update spending limit + alert threshold
 *
 * DEPRECATED: This route is kept for backward compatibility. The new
 * /api/admin/plan endpoint is the canonical source of plan info.
 * This route proxies to the new lib/rate-limit-tiers module.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { getPlan, getMonthlyUsage, updateTenantPlan } from '@/lib/rate-limit-tiers'
import { z } from 'zod'

const PlanUpdateSchema = z.object({
  spendingLimitUsd: z.number().min(0).max(100000).optional(),
  alertThresholdPct: z.number().min(0).max(100).optional(),
  planTier: z.enum(['developer', 'growth', 'enterprise']).optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const tenant = await db.tenant.findUnique({
    where: { id: session.tenantId },
    select: { planTier: true, spendingLimitUsd: true, alertThresholdPct: true },
  })

  if (!tenant) {
    return NextResponse.json({ success: false, error: 'Tenant not found' }, { status: 404 })
  }

  const plan = getPlan(tenant.planTier)
  const usage = await getMonthlyUsage(session.tenantId, tenant.planTier)

  const estimatedCost = usage.count * plan.pricePerAuth
  const spendingPct = tenant.spendingLimitUsd > 0
    ? (estimatedCost / tenant.spendingLimitUsd) * 100
    : 0

  return NextResponse.json({
    success: true,
    plan: {
      tier: plan.tier,
      tierName: plan.displayName,
      pricePerAuth: plan.pricePerAuth,
      monthlyLimit: plan.monthlyLimit,
      features: plan.features,
    },
    usage: {
      authsThisMonth: usage.count,
      estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      spendingLimitUsd: tenant.spendingLimitUsd,
      alertThresholdPct: tenant.alertThresholdPct,
      spendingPct: parseFloat(spendingPct.toFixed(1)),
      authsRemaining: usage.remaining,
      usedPct: usage.usedPct === -1 ? 0 : parseFloat(usage.usedPct.toFixed(1)),
      overLimit: estimatedCost >= tenant.spendingLimitUsd,
      alertTriggered: usage.alertTriggered,
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

  await updateTenantPlan(
    session.tenantId,
    (validation.data.planTier ?? 'growth') as 'developer' | 'growth' | 'enterprise',
    {
      spendingLimitUsd: validation.data.spendingLimitUsd,
      alertThresholdPct: validation.data.alertThresholdPct,
    },
  )

  await appendAudit({
    tenantId: session.tenantId,
    // SECURITY FIX (L-4): Was 'key.rotated' — this is a plan update event.
    eventType: 'tenant.plan_changed',
    payload: { action: 'plan_updated', ...validation.data },
  })

  return NextResponse.json({ success: true, message: 'Plan updated' })
}
