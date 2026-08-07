/**
 * GET /api/admin/usage/plan — Get current plan + spending limits
 * PUT /api/admin/usage/plan — Update plan config (spending limit, alert threshold)
 *
 * Plan is stored as a JSON field on the tenant's audit log as a
 * 'tenant.created' event with plan config. For simplicity, we use
 * in-memory config that maps to the tenant's rateLimitPerMin + a
 * spending alert threshold stored in the audit log.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { appendAudit } from '@/lib/audit'
import { z } from 'zod'

const PLAN_TIERS = {
  developer: { name: 'Developer', pricePerAuth: 0, monthlyLimit: 1000, features: ['single_tenant', 'community_support'] },
  growth: { name: 'Growth', pricePerAuth: 0.08, monthlyLimit: 100000, features: ['multi_region', 'webhooks', 'oidc', 'sla_999'] },
  enterprise: { name: 'Enterprise', pricePerAuth: 0, monthlyLimit: -1, features: ['saml', 'fido2', 'nitro_enclave', 'sla_9999', 'on_prem'] },
} as const

const PlanUpdateSchema = z.object({
  spendingLimitUsd: z.number().min(0).max(100000).optional(),
  alertThresholdPct: z.number().min(0).max(100).optional(),
})

// In-memory plan config (production: DB or Stripe)
const planConfig = new Map<string, { spendingLimitUsd: number; alertThresholdPct: number; tier: string }>()

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  // Get current month usage
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const monthEntries = await db.auditLog.count({
    where: {
      tenantId: session.tenantId,
      eventType: { in: ['auth.success', 'enroll.success'] },
      createdAt: { gte: monthStart },
    },
  })

  const config = planConfig.get(session.tenantId) ?? {
    spendingLimitUsd: 100, // $100 default
    alertThresholdPct: 80,
    tier: 'growth',
  }

  const tier = PLAN_TIERS[config.tier as keyof typeof PLAN_TIERS] ?? PLAN_TIERS.growth
  const estimatedCost = monthEntries * tier.pricePerAuth
  const spendingPct = config.spendingLimitUsd > 0 ? (estimatedCost / config.spendingLimitUsd) * 100 : 0
  const authsRemaining = tier.monthlyLimit > 0 ? Math.max(0, tier.monthlyLimit - monthEntries) : -1

  return NextResponse.json({
    success: true,
    plan: {
      tier: config.tier,
      tierName: tier.name,
      pricePerAuth: tier.pricePerAuth,
      monthlyLimit: tier.monthlyLimit,
      features: tier.features,
    },
    usage: {
      authsThisMonth: monthEntries,
      estimatedCost: parseFloat(estimatedCost.toFixed(2)),
      spendingLimitUsd: config.spendingLimitUsd,
      alertThresholdPct: config.alertThresholdPct,
      spendingPct: parseFloat(spendingPct.toFixed(1)),
      authsRemaining,
      overLimit: estimatedCost >= config.spendingLimitUsd,
      alertTriggered: spendingPct >= config.alertThresholdPct,
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

  const current = planConfig.get(session.tenantId) ?? {
    spendingLimitUsd: 100,
    alertThresholdPct: 80,
    tier: 'growth',
  }

  const updated = {
    ...current,
    ...validation.data,
  }

  planConfig.set(session.tenantId, updated)

  await appendAudit({
    tenantId: session.tenantId,
    eventType: 'key.rotated',
    payload: { action: 'plan_updated', ...validation.data },
  })

  return NextResponse.json({ success: true, config: updated })
}
