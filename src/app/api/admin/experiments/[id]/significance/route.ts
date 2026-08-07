/**
 * GET /api/admin/experiments/[id]/significance
 * Returns statistical significance results for each variant vs control.
 *
 * Includes:
 *   - Per-variant: nControl, nVariant, pControl, pVariant, uplift, zScore, pValue, significant
 *   - Overall: winningVariant, hasSignificantResult, recommendation
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import { computeSignificance } from '@/lib/experiments'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const { id } = await params

  const experiment = await db.experiment.findUnique({
    where: { id },
    select: { tenantId: true, name: true, state: true, significanceThreshold: true },
  })
  if (!experiment || experiment.tenantId !== session.tenantId) {
    return NextResponse.json({ success: false, error: 'Experiment not found' }, { status: 404 })
  }

  const results = await computeSignificance(id)

  // Determine winner
  const significantResults = results.filter((r) => r.significant && r.hasEnoughSamples)
  const winningVariant = significantResults.length > 0
    ? significantResults.reduce((best, r) => r.uplift > best.uplift ? r : best).variant
    : null

  // Recommendation
  let recommendation = 'Collect more data — not enough samples for significance.'
  const totalSamples = results.length > 0 ? results[0].nControl + results.reduce((s, r) => s + r.nVariant, 0) : 0
  if (significantResults.length > 0) {
    const winner = significantResults.reduce((best, r) => r.uplift > best.uplift ? r : best)
    if (winner.uplift > 0) {
      recommendation = `Variant "${winner.variant}" is significantly better (+${(winner.relativeUplift * 100).toFixed(1)}% improvement). Promote it.`
    } else {
      recommendation = `Variant "${winner.variant}" is significantly worse (${(winner.relativeUplift * 100).toFixed(1)}%). Keep control.`
    }
  } else if (totalSamples > 0) {
    recommendation = `No significant difference yet (${totalSamples} total samples). Continue collecting.`
  }

  return NextResponse.json({
    success: true,
    experiment: {
      id,
      name: experiment.name,
      state: experiment.state,
      significanceThreshold: experiment.significanceThreshold,
    },
    results,
    summary: {
      hasSignificantResult: significantResults.length > 0,
      winningVariant,
      recommendation,
    },
  })
}
