/**
 * GET    /api/admin/experiments/[id]   — Get experiment details + variant stats
 * PATCH  /api/admin/experiments/[id]   — Update experiment state (start/pause/complete)
 * DELETE /api/admin/experiments/[id]   — Delete experiment (only if draft or completed)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'
import {
  startExperiment,
  pauseExperiment,
  completeExperiment,
  computeVariantStats,
} from '@/lib/experiments'
import { z } from 'zod'

const PatchSchema = z.object({
  action: z.enum(['start', 'pause', 'complete']),
})

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const { id } = await params

  const experiment = await db.experiment.findUnique({
    where: { id },
  })

  if (!experiment || experiment.tenantId !== session.tenantId) {
    return NextResponse.json({ success: false, error: 'Experiment not found' }, { status: 404 })
  }

  const variantStats = await computeVariantStats(id)

  return NextResponse.json({
    success: true,
    experiment: {
      id: experiment.id,
      name: experiment.name,
      variable: experiment.variable,
      variants: JSON.parse(experiment.variants),
      description: experiment.description,
      state: experiment.state,
      minSampleSize: experiment.minSampleSize,
      significanceThreshold: experiment.significanceThreshold,
      autoStopOnSignificance: experiment.autoStopOnSignificance,
      startedAt: experiment.startedAt,
      endedAt: experiment.endedAt,
      createdAt: experiment.createdAt,
    },
    variantStats,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can modify experiments' }, { status: 403 })
  }

  const { id } = await params

  // Verify ownership
  const experiment = await db.experiment.findUnique({
    where: { id },
    select: { tenantId: true, state: true },
  })
  if (!experiment || experiment.tenantId !== session.tenantId) {
    return NextResponse.json({ success: false, error: 'Experiment not found' }, { status: 404 })
  }

  const body = await req.json()
  const validation = PatchSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json({ success: false, error: validation.error.issues[0]?.message }, { status: 400 })
  }

  const { action } = validation.data

  // State machine validation
  if (action === 'start' && experiment.state !== 'draft' && experiment.state !== 'paused') {
    return NextResponse.json({ success: false, error: `Cannot start experiment in state: ${experiment.state}` }, { status: 400 })
  }
  if (action === 'pause' && experiment.state !== 'running') {
    return NextResponse.json({ success: false, error: `Cannot pause experiment in state: ${experiment.state}` }, { status: 400 })
  }
  if (action === 'complete' && experiment.state !== 'running' && experiment.state !== 'paused') {
    return NextResponse.json({ success: false, error: `Cannot complete experiment in state: ${experiment.state}` }, { status: 400 })
  }

  if (action === 'start') await startExperiment(id)
  if (action === 'pause') await pauseExperiment(id)
  if (action === 'complete') await completeExperiment(id)

  return NextResponse.json({ success: true, action })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can delete experiments' }, { status: 403 })
  }

  const { id } = await params

  const experiment = await db.experiment.findUnique({
    where: { id },
    select: { tenantId: true, state: true },
  })
  if (!experiment || experiment.tenantId !== session.tenantId) {
    return NextResponse.json({ success: false, error: 'Experiment not found' }, { status: 404 })
  }

  // Only allow deletion of draft or completed experiments
  if (experiment.state === 'running' || experiment.state === 'paused') {
    return NextResponse.json(
      { success: false, error: 'Cannot delete running/paused experiment — complete it first' },
      { status: 400 },
    )
  }

  // Cascade delete assignments + outcomes
  await db.$transaction([
    db.experimentOutcome.deleteMany({ where: { experimentId: id } }),
    db.experimentAssignment.deleteMany({ where: { experimentId: id } }),
    db.experiment.delete({ where: { id } }),
  ])

  return NextResponse.json({ success: true, deleted: true })
}
