/**
 * POST /api/session/init
 * Initialize a new authentication session.
 *
 * Requires API key with 'session:init' scope.
 * Validates input via Zod schema.
 * Returns: sessionId, challenge, backendPubKey, expiresAt, experiment
 *
 * If an A/B experiment for 'liveness_threshold' (or other variable) is
 * running, the response includes the assigned variant + value so the SDK
 * can use the experiment-driven threshold instead of its default.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { initSession, isSessionConsumed } from '@/lib/session'
import { requireApiKey } from '@/lib/auth'
import { validateInput, SessionInitSchema } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { authAttemptsTotal, activeSessions } from '@/lib/metrics'
import { getExperimentValue } from '@/lib/experiments'

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'session:init')
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const validation = validateInput(SessionInitSchema, body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }
  const { flow, externalUserId } = validation.data

  const tenantId = authResult.auth.tenantId!

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } })
  if (!tenant || !tenant.active) {
    return NextResponse.json({ success: false, error: 'Tenant not found or inactive' }, { status: 403 })
  }

  const session = await initSession({
    tenantId,
    flow,
    targetUserId: externalUserId,
    clientIp: authResult.ip,
    userAgent: req.headers.get('user-agent') ?? '',
  })

  // A/B test: check for active liveness_threshold experiment
  // (The SDK uses this value instead of its default 0.78 if present)
  let experiment: {
    experimentId: string | null
    variant: string | null
    livenessThreshold: number
  } | null = null

  if (externalUserId) {
    try {
      const result = await getExperimentValue(
        tenantId,
        'liveness_threshold',
        externalUserId,
        tenant.livenessThreshold ?? 0.78,
      )
      experiment = {
        experimentId: result.experimentId,
        variant: result.variant,
        livenessThreshold: result.value,
      }
    } catch (e) {
      logger.warn({ error: e, tenantId }, 'Experiment assignment failed (non-blocking)')
    }
  }

  logger.info({ tenantId, sessionId: session.sessionId, flow }, 'Session initialized')
  activeSessions.inc({ tenant_id: tenantId })
  authAttemptsTotal.inc({ tenant_id: tenantId, flow, outcome: 'init' })

  return NextResponse.json({
    success: true,
    sessionId: session.sessionId,
    challenge: session.challenge,
    backendPubKey: session.backendPubKey,
    expiresAt: session.expiresAt.toISOString(),
    experiment,
  })
}
