/**
 * GET /api/admin/templates
 * List all biometric templates for the tenant with metadata.
 * Protected by platform session cookie.
 *
 * Returns: template ID, user external ID, commitment, model version,
 * variant, created/last-used dates, norm. Does NOT return embeddings.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response
  const { tenantId } = session

  const url = new URL(req.url)
  const search = url.searchParams.get('search') ?? ''
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200)

  const templates = await db.biometricTemplate.findMany({
    where: {
      tenantId,
      ...(search
        ? { user: { externalUserId: { contains: search } } }
        : {}),
    },
    include: {
      user: {
        select: { externalUserId: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  return NextResponse.json({
    success: true,
    templates: templates.map((t) => ({
      id: t.id,
      externalUserId: t.user.externalUserId,
      commitment: t.commitment.slice(0, 24) + '...',
      modelVersion: t.modelVersion,
      variant: t.variant,
      norm: t.norm,
      createdAt: t.createdAt,
      lastUsedAt: t.lastUsedAt,
    })),
    count: templates.length,
  })
}
