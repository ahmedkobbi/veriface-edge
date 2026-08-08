/**
 * POST /api/cron/access-review
 * Quarterly access review — generates a report for SOC 2 compliance.
 *
 * Auth: Requires CRON_SECRET header (fail-closed in production).
 * Schedule: First day of every quarter (cron: 0 0 1 1-12/3 *).
 *
 * Reviews:
 *   1. All active API keys (flag unused for 90 days)
 *   2. All admin users (flag dormant for 90 days)
 *   3. All team members per tenant
 *   4. Keys with '*' scope (should be minimized)
 *
 * The report is stored in the audit log as evidence for SOC 2.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { requirePlatformSession } from '@/lib/platform-session'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
    }
  } else if (cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const report: any = {
    reviewDate: new Date().toISOString(),
    reviewType: 'quarterly-access-review',
    findings: {
      unusedApiKeys: [],
      dormantAdmins: [],
      dormantTeamMembers: [],
      wildcardScopeKeys: [],
    },
    summary: {
      totalApiKeys: 0,
      totalAdmins: 0,
      totalTeamMembers: 0,
      findingsCount: 0,
    },
  }

  // 1. Review all active API keys
  const apiKeys = await db.apiKey.findMany({
    where: { active: true },
    include: { tenant: { select: { name: true } } },
  })

  report.summary.totalApiKeys = apiKeys.length

  for (const key of apiKeys) {
    // Flag keys unused for 90 days
    if (!key.lastUsedAt || key.lastUsedAt < ninetyDaysAgo) {
      report.findings.unusedApiKeys.push({
        keyId: key.id,
        label: key.label,
        tenant: key.tenant.name,
        lastUsed: key.lastUsedAt,
        daysSinceLastUse: key.lastUsedAt
          ? Math.floor((Date.now() - key.lastUsedAt.getTime()) / (24 * 60 * 60 * 1000))
          : null,
        recommendation: 'Revoke if no longer needed',
      })
    }

    // Flag keys with wildcard scope
    if (key.scopes === '*') {
      report.findings.wildcardScopeKeys.push({
        keyId: key.id,
        label: key.label,
        tenant: key.tenant.name,
        recommendation: 'Restrict to minimum required scope',
      })
    }
  }

  // 2. Review all admin users
  const admins = await db.platformUser.findMany({
    where: { role: 'admin' },
    select: {
      id: true,
      email: true,
      name: true,
      lastLoginAt: true,
      tenantId: true,
      createdAt: true,
    },
  })

  report.summary.totalAdmins = admins.length

  for (const admin of admins) {
    // Flag admins who haven't logged in for 90 days
    if (!admin.lastLoginAt || admin.lastLoginAt < ninetyDaysAgo) {
      report.findings.dormantAdmins.push({
        userId: admin.id,
        email: admin.email,
        lastLogin: admin.lastLoginAt,
        daysSinceLastLogin: admin.lastLoginAt
          ? Math.floor((Date.now() - admin.lastLoginAt.getTime()) / (24 * 60 * 60 * 1000))
          : null,
        recommendation: 'Deactivate if no longer needed',
      })
    }
  }

  // 3. Review all team members
  const teamMembers = await db.platformUser.findMany({
    select: {
      id: true,
      email: true,
      role: true,
      lastLoginAt: true,
      tenantId: true,
    },
  })

  report.summary.totalTeamMembers = teamMembers.length

  for (const member of teamMembers) {
    if (!member.lastLoginAt || member.lastLoginAt < ninetyDaysAgo) {
      report.findings.dormantTeamMembers.push({
        userId: member.id,
        email: member.email,
        role: member.role,
        lastLogin: member.lastLoginAt,
        daysSinceLastLogin: member.lastLoginAt
          ? Math.floor((Date.now() - member.lastLoginAt.getTime()) / (24 * 60 * 60 * 1000))
          : null,
        recommendation: 'Review access need',
      })
    }
  }

  // Count total findings
  report.summary.findingsCount =
    report.findings.unusedApiKeys.length +
    report.findings.dormantAdmins.length +
    report.findings.dormantTeamMembers.length +
    report.findings.wildcardScopeKeys.length

  // Store the report in the audit log (SOC 2 evidence)
  // We store it against the first tenant (or a system tenant)
  const firstTenant = await db.tenant.findFirst({ select: { id: true } })
  if (firstTenant) {
    await appendAudit({
      tenantId: firstTenant.id,
      // SECURITY FIX (L-4): Was 'key.rotated' — this is a compliance access review.
      eventType: 'compliance.access_review_completed',
      payload: {
        action: 'quarterly_access_review',
        ...report,
      },
    })
  }

  logger.info(
    {
      reviewDate: report.reviewDate,
      findings: report.summary.findingsCount,
      totalKeys: report.summary.totalApiKeys,
      totalAdmins: report.summary.totalAdmins,
    },
    'Quarterly access review completed',
  )

  return NextResponse.json({
    success: true,
    report,
  })
}

/**
 * GET /api/cron/access-review
 * Returns the last access review report from the audit log.
 */
export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
  }

  // Find the last access review in the audit log
  const lastReview = await db.auditLog.findFirst({
    where: {
      tenantId: session.tenantId,
      eventType: 'compliance.access_review_completed',
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
  })

  // Search for access review entries
  const reviewEntries = await db.auditLog.findMany({
    where: {
      tenantId: session.tenantId,
      eventType: 'compliance.access_review_completed',
      payload: { contains: 'quarterly_access_review' },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  })

  const reports = reviewEntries.map(e => {
    try {
      const payload = JSON.parse(e.payload)
      return {
        reviewDate: e.createdAt,
        ...payload,
      }
    } catch {
      return { reviewDate: e.createdAt, error: 'Failed to parse report' }
    }
  })

  return NextResponse.json({
    success: true,
    lastReview: reports[0] ?? null,
    history: reports,
  })
}
