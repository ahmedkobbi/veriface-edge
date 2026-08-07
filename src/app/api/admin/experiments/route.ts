/**
 * GET /api/admin/experiments
 * List all experiments for the tenant.
 *
 * POST /api/admin/experiments
 * Create a new experiment (in 'draft' state).
 *
 * Body: {
 *   name: string,
 *   variable: 'liveness_threshold' | 'capture_duration_ms' | ...,
 *   variants: [{ name: 'control', value: 0.78, weight: 50 }, ...],
 *   description?: string,
 *   minSampleSize?: number,         // default 100
 *   significanceThreshold?: number, // default 0.05
 *   autoStopOnSignificance?: boolean, // default true
 * }
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePlatformSession } from '@/lib/platform-session'
import {
  createExperiment,
  listExperiments,
  type ExperimentVariable,
} from '@/lib/experiments'
import { z } from 'zod'

const VariantSchema = z.object({
  name: z.string().min(1).max(32),
  value: z.union([z.number(), z.string().max(64), z.boolean()]),
  weight: z.number().int().min(0).max(100),
})

const CreateExperimentSchema = z.object({
  name: z.string().min(1).max(120),
  variable: z.enum([
    'liveness_threshold',
    'capture_duration_ms',
    'rppg_window_ms',
    'pad_threshold',
    'cosine_threshold',
  ]),
  variants: z.array(VariantSchema).min(2),
  description: z.string().max(2000).optional(),
  minSampleSize: z.number().int().min(10).max(10000).optional(),
  significanceThreshold: z.number().min(0.001).max(0.5).optional(),
  autoStopOnSignificance: z.boolean().optional(),
})

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  const experiments = await listExperiments(session.tenantId)
  return NextResponse.json({ success: true, experiments })
}

export async function POST(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Only admins can create experiments' }, { status: 403 })
  }

  const body = await req.json()
  const validation = CreateExperimentSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message },
      { status: 400 },
    )
  }

  try {
    const experiment = await createExperiment({
      tenantId: session.tenantId,
      ...validation.data,
      variable: validation.data.variable as ExperimentVariable,
    })
    return NextResponse.json({ success: true, experiment })
  } catch (e: any) {
    return NextResponse.json(
      { success: false, error: e.message ?? 'Failed to create experiment' },
      { status: 400 },
    )
  }
}
