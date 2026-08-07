/**
 * VeriFace Edge — A/B Testing Framework
 *
 * Allows tenants to test different SDK / backend parameters (e.g., liveness
 * threshold, capture duration, rPPG window size) per user cohort.
 *
 * Architecture:
 *   1. Admin defines an Experiment with N variants (e.g., control=0.78,
 *      strict=0.82) and weights (must sum to 100).
 *   2. On session init, the backend calls `assignVariant(tenantId, experimentId, externalUserId)`.
 *      - Deterministic hash: SHA-256(tenantSalt | experimentId | externalUserId) → bucket 0–99
 *      - Bucket → variant mapping (sticky: stored in ExperimentAssignment table)
 *      - Once assigned, the user always sees the same variant for the experiment's lifetime.
 *   3. The backend reads the variant value (e.g., 0.82) and uses it instead of the default.
 *   4. On session verify, the backend records the outcome (auth.success, auth.failure, etc.).
 *   5. The admin dashboard computes per-variant success rates + statistical significance.
 *
 * Statistical significance: two-proportion z-test
 *   H0: p_control = p_variant
 *   H1: p_control ≠ p_variant
 *   z = (p̂_control - p̂_variant) / sqrt(p̂_pool * (1 - p̂_pool) * (1/n_control + 1/n_variant))
 *   where p̂_pool = (successes_control + successes_variant) / (n_control + n_variant)
 *   p-value = 2 * (1 - Φ(|z|))
 *
 * We declare significance when p-value < experiment.significanceThreshold (default 0.05).
 *
 * Privacy:
 *   - externalUserId is NEVER stored. We hash it with the tenant's webhookSecret
 *     as salt to produce an anonymous userBucketKey.
 *   - The hash is one-way: even if the ExperimentAssignment table leaks, the
 *     externalUserId cannot be recovered.
 */

import { db } from '@/lib/db'
import { sha256Hex, hex, utf8 } from '@/lib/crypto-server'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExperimentVariant {
  /** Variant name (e.g., 'control', 'strict', 'relaxed'). */
  name: string
  /** Resolved value (e.g., 0.78 for liveness_threshold). */
  value: number | string | boolean
  /** Bucket weight (0–100). All variant weights must sum to 100. */
  weight: number
}

export type ExperimentVariable =
  | 'liveness_threshold'
  | 'capture_duration_ms'
  | 'rppg_window_ms'
  | 'pad_threshold'
  | 'cosine_threshold'

export type ExperimentState = 'draft' | 'running' | 'paused' | 'completed'

export interface ExperimentDefinition {
  id: string
  tenantId: string
  name: string
  variable: ExperimentVariable
  variants: ExperimentVariant[]
  description?: string
  state: ExperimentState
  minSampleSize: number
  significanceThreshold: number
  autoStopOnSignificance: boolean
  startedAt: Date | null
  endedAt: Date | null
}

export interface AssignmentResult {
  /** The assigned variant (null if no running experiment for this variable). */
  experimentId: string | null
  variant: string | null
  /** Resolved value of the variant (null if no experiment). */
  value: number | string | boolean | null
}

export interface VariantStats {
  variant: string
  value: number | string | boolean
  assignments: number
  outcomes: number
  successes: number
  failures: number
  successRate: number  // 0–1
  avgLivenessScore: number | null
  avgDurationMs: number | null
}

export interface SignificanceResult {
  /** Variant name being compared against control. */
  variant: string
  /** Sample size of control. */
  nControl: number
  /** Sample size of variant. */
  nVariant: number
  /** Success rate of control (0–1). */
  pControl: number
  /** Success rate of variant (0–1). */
  pVariant: number
  /** Absolute uplift (pVariant - pControl). */
  uplift: number
  /** Relative uplift ((pVariant - pControl) / pControl). */
  relativeUplift: number
  /** z-score. */
  zScore: number
  /** Two-tailed p-value. */
  pValue: number
  /** Whether the result is statistically significant. */
  significant: boolean
  /** Whether we have enough samples to compute significance. */
  hasEnoughSamples: boolean
}

// ---------------------------------------------------------------------------
// Variant assignment (deterministic + sticky)
// ---------------------------------------------------------------------------

/**
 * Compute the anonymous user bucket key.
 * SHA-256(tenantWebhookSecret | experimentId | externalUserId) → hex
 *
 * The tenant's webhookSecret acts as a salt — so the same externalUserId
 * hashes differently across tenants, preventing cross-tenant correlation.
 */
function computeUserBucketKey(
  tenantWebhookSecret: string,
  experimentId: string,
  externalUserId: string,
): string {
  return sha256Hex(`${tenantWebhookSecret}|${experimentId}|${externalUserId}`)
}

/**
 * Deterministically assign a user to a variant based on their bucket key.
 *
 * Algorithm:
 *   1. Take the first 8 hex chars of the bucket key (32 bits).
 *   2. Convert to integer, mod 100 → bucket 0–99.
 *   3. Walk the variant weights: if bucket < cumulative weight, assign.
 *
 * This is deterministic — the same user always gets the same bucket,
 * even before the assignment is persisted.
 */
function bucketToVariant(bucketKey: string, variants: ExperimentVariant[]): ExperimentVariant {
  const bucket = parseInt(bucketKey.slice(0, 8), 16) % 100
  let cumulative = 0
  for (const variant of variants) {
    cumulative += variant.weight
    if (bucket < cumulative) return variant
  }
  // Fallback (shouldn't happen if weights sum to 100)
  return variants[variants.length - 1]
}

/**
 * Get or create an assignment for a user.
 *
 * - If the user already has an assignment for this experiment, return it (sticky).
 * - Otherwise, compute the variant deterministically and persist it.
 *
 * Returns null if the experiment is not running.
 */
export async function assignVariant(
  tenantId: string,
  experimentId: string,
  externalUserId: string,
): Promise<AssignmentResult> {
  const experiment = await db.experiment.findUnique({
    where: { id: experimentId },
    include: { tenant: true },
  })

  if (!experiment || experiment.state !== 'running' || !experiment.tenant) {
    return { experimentId: null, variant: null, value: null }
  }

  const variants = parseVariants(experiment.variants)
  if (variants.length === 0) {
    return { experimentId: null, variant: null, value: null }
  }

  const bucketKey = computeUserBucketKey(
    experiment.tenant.webhookSecret,
    experimentId,
    externalUserId,
  )

  // Check for existing assignment (sticky)
  const existing = await db.experimentAssignment.findUnique({
    where: { experimentId_userBucketKey: { experimentId, userBucketKey: bucketKey } },
  })

  if (existing) {
    return {
      experimentId: existing.experimentId,
      variant: existing.variant,
      value: parseVariantValue(existing.variantValue),
    }
  }

  // Compute new assignment
  const variant = bucketToVariant(bucketKey, variants)

  try {
    const assignment = await db.experimentAssignment.create({
      data: {
        tenantId,
        experimentId,
        userBucketKey: bucketKey,
        variant: variant.name,
        variantValue: String(variant.value),
      },
    })
    return {
      experimentId: assignment.experimentId,
      variant: assignment.variant,
      value: parseVariantValue(assignment.variantValue),
    }
  } catch (e: any) {
    // P2002 = unique constraint violation = race condition (another request
    // created the assignment in parallel). Re-fetch.
    if (e?.code === 'P2002') {
      const retry = await db.experimentAssignment.findUnique({
        where: { experimentId_userBucketKey: { experimentId, userBucketKey: bucketKey } },
      })
      if (retry) {
        return {
          experimentId: retry.experimentId,
          variant: retry.variant,
          value: parseVariantValue(retry.variantValue),
        }
      }
    }
    throw e
  }
}

/**
 * Find the active (running) experiment for a given variable on a tenant.
 * Returns null if no experiment is running.
 */
export async function getActiveExperiment(
  tenantId: string,
  variable: ExperimentVariable,
): Promise<ExperimentDefinition | null> {
  const experiment = await db.experiment.findFirst({
    where: { tenantId, variable, state: 'running' },
    orderBy: { startedAt: 'desc' },
  })
  if (!experiment) return null
  return toDefinition(experiment)
}

/**
 * Convenience: get the variant value for a given variable, falling back to
 * the provided default if no experiment is running.
 *
 * Usage:
 *   const threshold = await getExperimentValue(tenantId, 'liveness_threshold', externalUserId, 0.78)
 */
export async function getExperimentValue(
  tenantId: string,
  variable: ExperimentVariable,
  externalUserId: string,
  defaultValue: number,
): Promise<{ value: number; experimentId: string | null; variant: string | null }> {
  const experiment = await getActiveExperiment(tenantId, variable)
  if (!experiment) {
    return { value: defaultValue, experimentId: null, variant: null }
  }
  const assignment = await assignVariant(tenantId, experiment.id, externalUserId)
  if (!assignment.variant || assignment.value === null) {
    return { value: defaultValue, experimentId: null, variant: null }
  }
  return {
    value: Number(assignment.value),
    experimentId: assignment.experimentId,
    variant: assignment.variant,
  }
}

// ---------------------------------------------------------------------------
// Outcome recording
// ---------------------------------------------------------------------------

export type ExperimentOutcomeType =
  | 'auth.success'
  | 'auth.failure'
  | 'enroll.success'
  | 'enroll.failure'
  | 'liveness.failed'
  | 'injection.detected'

/**
 * Record an outcome for an experiment assignment.
 *
 * Called from /api/session/verify after auth.success / auth.failure / etc.
 * No-op if no experiment is active.
 */
export async function recordOutcome(opts: {
  tenantId: string
  experimentId: string | null
  variant: string | null
  externalUserId: string
  outcome: ExperimentOutcomeType
  livenessScore?: number
  cosineSimilarity?: number
  durationMs?: number
}): Promise<void> {
  if (!opts.experimentId || !opts.variant) return

  // Find the assignment (so we can link the outcome to it)
  const experiment = await db.experiment.findUnique({
    where: { id: opts.experimentId },
    include: { tenant: true },
  })
  if (!experiment || !experiment.tenant) return

  const bucketKey = computeUserBucketKey(
    experiment.tenant.webhookSecret,
    opts.experimentId,
    opts.externalUserId,
  )

  const assignment = await db.experimentAssignment.findUnique({
    where: { experimentId_userBucketKey: { experimentId: opts.experimentId, userBucketKey: bucketKey } },
  })
  if (!assignment) return

  await db.experimentOutcome.create({
    data: {
      tenantId: opts.tenantId,
      experimentId: opts.experimentId,
      assignmentId: assignment.id,
      variant: opts.variant,
      outcome: opts.outcome,
      livenessScore: opts.livenessScore ?? null,
      cosineSimilarity: opts.cosineSimilarity ?? null,
      durationMs: opts.durationMs ?? null,
    },
  })

  // Auto-stop check (if enabled)
  if (experiment.autoStopOnSignificance && experiment.state === 'running') {
    const result = await computeSignificance(opts.experimentId)
    const anySignificant = result.some((r) => r.significant && r.hasEnoughSamples)
    if (anySignificant) {
      await db.experiment.update({
        where: { id: opts.experimentId },
        data: { state: 'completed', endedAt: new Date() },
      })
      logger.info({ experimentId: opts.experimentId }, 'Experiment auto-stopped (significance reached)')
    }
  }
}

// ---------------------------------------------------------------------------
// Significance calculation (two-proportion z-test)
// ---------------------------------------------------------------------------

/**
 * Compute per-variant stats + statistical significance for an experiment.
 *
 * Returns one SignificanceResult per non-control variant, comparing each
 * against the 'control' variant.
 */
export async function computeSignificance(experimentId: string): Promise<SignificanceResult[]> {
  const experiment = await db.experiment.findUnique({
    where: { id: experimentId },
  })
  if (!experiment) return []

  const variants = parseVariants(experiment.variants)
  const control = variants.find((v) => v.name === 'control')
  if (!control) return []

  // Fetch all outcomes grouped by variant + outcome
  const outcomes = await db.experimentOutcome.groupBy({
    by: ['variant', 'outcome'],
    where: { experimentId },
    _count: { outcome: true },
  })

  // Build per-variant summary
  const stats = new Map<string, { successes: number; total: number }>()
  for (const row of outcomes) {
    if (!stats.has(row.variant)) stats.set(row.variant, { successes: 0, total: 0 })
    const s = stats.get(row.variant)!
    s.total += row._count.outcome
    if (row.outcome === 'auth.success' || row.outcome === 'enroll.success') {
      s.successes += row._count.outcome
    }
  }

  const controlStats = stats.get('control') ?? { successes: 0, total: 0 }
  const nControl = controlStats.total
  const pControl = nControl > 0 ? controlStats.successes / nControl : 0

  const results: SignificanceResult[] = []
  for (const variant of variants) {
    if (variant.name === 'control') continue
    const vStats = stats.get(variant.name) ?? { successes: 0, total: 0 }
    const nVariant = vStats.total
    const pVariant = nVariant > 0 ? vStats.successes / nVariant : 0

    const hasEnoughSamples = nControl >= experiment.minSampleSize && nVariant >= experiment.minSampleSize
    let zScore = 0
    let pValue = 1

    if (hasEnoughSamples && nControl > 0 && nVariant > 0) {
      const pPool = (controlStats.successes + vStats.successes) / (nControl + nVariant)
      const denominator = Math.sqrt(pPool * (1 - pPool) * (1 / nControl + 1 / nVariant))
      zScore = denominator > 0 ? (pControl - pVariant) / denominator : 0
      pValue = 2 * (1 - normalCdf(Math.abs(zScore)))
    }

    const uplift = pVariant - pControl
    const relativeUplift = pControl > 0 ? uplift / pControl : 0

    results.push({
      variant: variant.name,
      nControl,
      nVariant,
      pControl,
      pVariant,
      uplift,
      relativeUplift,
      zScore,
      pValue,
      significant: pValue < experiment.significanceThreshold,
      hasEnoughSamples,
    })
  }

  return results
}

/**
 * Compute variant-level summary stats (success rate, avg liveness, avg duration).
 */
export async function computeVariantStats(experimentId: string): Promise<VariantStats[]> {
  const experiment = await db.experiment.findUnique({
    where: { id: experimentId },
  })
  if (!experiment) return []

  const variants = parseVariants(experiment.variants)

  // Get assignment counts per variant
  const assignmentCounts = await db.experimentAssignment.groupBy({
    by: ['variant'],
    where: { experimentId },
    _count: { variant: true },
  })

  // Get outcome counts + aggregates per variant
  const outcomeAggs = await db.experimentOutcome.groupBy({
    by: ['variant', 'outcome'],
    where: { experimentId },
    _count: { outcome: true },
    _avg: { livenessScore: true, durationMs: true },
  })

  // Aggregate per variant
  const summary = new Map<string, VariantStats>()
  for (const v of variants) {
    summary.set(v.name, {
      variant: v.name,
      value: v.value,
      assignments: 0,
      outcomes: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
      avgLivenessScore: null,
      avgDurationMs: null,
    })
  }

  for (const ac of assignmentCounts) {
    const s = summary.get(ac.variant)
    if (s) s.assignments = ac._count.variant
  }

  // Track avg liveness/duration per variant (across all outcomes)
  const livenessSum = new Map<string, { sum: number; count: number }>()
  const durationSum = new Map<string, { sum: number; count: number }>()

  for (const oa of outcomeAggs) {
    const s = summary.get(oa.variant)
    if (!s) continue
    s.outcomes += oa._count.outcome
    if (oa.outcome === 'auth.success' || oa.outcome === 'enroll.success') {
      s.successes += oa._count.outcome
    } else {
      s.failures += oa._count.outcome
    }
    if (oa._avg.livenessScore != null) {
      const cur = livenessSum.get(oa.variant) ?? { sum: 0, count: 0 }
      cur.sum += oa._avg.livenessScore * oa._count.outcome
      cur.count += oa._count.outcome
      livenessSum.set(oa.variant, cur)
    }
    if (oa._avg.durationMs != null) {
      const cur = durationSum.get(oa.variant) ?? { sum: 0, count: 0 }
      cur.sum += oa._avg.durationMs * oa._count.outcome
      cur.count += oa._count.outcome
      durationSum.set(oa.variant, cur)
    }
  }

  for (const s of summary.values()) {
    if (s.outcomes > 0) s.successRate = s.successes / s.outcomes
    const ls = livenessSum.get(s.variant)
    if (ls && ls.count > 0) s.avgLivenessScore = ls.sum / ls.count
    const ds = durationSum.get(s.variant)
    if (ds && ds.count > 0) s.avgDurationMs = Math.round(ds.sum / ds.count)
  }

  return Array.from(summary.values())
}

// ---------------------------------------------------------------------------
// Experiment CRUD
// ---------------------------------------------------------------------------

export async function createExperiment(opts: {
  tenantId: string
  name: string
  variable: ExperimentVariable
  variants: ExperimentVariant[]
  description?: string
  minSampleSize?: number
  significanceThreshold?: number
  autoStopOnSignificance?: boolean
}): Promise<ExperimentDefinition> {
  validateVariants(opts.variants)

  const experiment = await db.experiment.create({
    data: {
      tenantId: opts.tenantId,
      name: opts.name,
      variable: opts.variable,
      variants: JSON.stringify(opts.variants),
      description: opts.description,
      minSampleSize: opts.minSampleSize ?? 100,
      significanceThreshold: opts.significanceThreshold ?? 0.05,
      autoStopOnSignificance: opts.autoStopOnSignificance ?? true,
      state: 'draft',
    },
  })

  return toDefinition(experiment)
}

export async function startExperiment(experimentId: string): Promise<void> {
  await db.experiment.update({
    where: { id: experimentId },
    data: { state: 'running', startedAt: new Date() },
  })
}

export async function pauseExperiment(experimentId: string): Promise<void> {
  await db.experiment.update({
    where: { id: experimentId },
    data: { state: 'paused' },
  })
}

export async function completeExperiment(experimentId: string): Promise<void> {
  await db.experiment.update({
    where: { id: experimentId },
    data: { state: 'completed', endedAt: new Date() },
  })
}

export async function listExperiments(tenantId: string): Promise<ExperimentDefinition[]> {
  const experiments = await db.experiment.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  })
  return experiments.map(toDefinition)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVariants(variantsJson: string): ExperimentVariant[] {
  try {
    return JSON.parse(variantsJson)
  } catch {
    return []
  }
}

function parseVariantValue(s: string): number | string | boolean {
  // Try number, then boolean, then string
  if (s === 'true') return true
  if (s === 'false') return false
  const num = Number(s)
  if (!isNaN(num) && s.trim() !== '') return num
  return s
}

function toDefinition(row: any): ExperimentDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    variable: row.variable as ExperimentVariable,
    variants: parseVariants(row.variants),
    description: row.description ?? undefined,
    state: row.state as ExperimentState,
    minSampleSize: row.minSampleSize,
    significanceThreshold: row.significanceThreshold,
    autoStopOnSignificance: row.autoStopOnSignificance,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  }
}

function validateVariants(variants: ExperimentVariant[]): void {
  if (variants.length < 2) {
    throw new Error('Experiment must have at least 2 variants')
  }
  if (!variants.some((v) => v.name === 'control')) {
    throw new Error('Experiment must include a "control" variant')
  }
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0)
  if (totalWeight !== 100) {
    throw new Error(`Variant weights must sum to 100 (got ${totalWeight})`)
  }
  for (const v of variants) {
    if (v.weight < 0 || v.weight > 100) {
      throw new Error(`Variant "${v.name}" has invalid weight ${v.weight}`)
    }
  }
  // Unique names
  const names = new Set(variants.map((v) => v.name))
  if (names.size !== variants.length) {
    throw new Error('Variant names must be unique')
  }
}

/**
 * Standard normal CDF (cumulative distribution function).
 * Abramowitz & Stegun formula 7.1.26 — accurate to ~1e-7.
 *
 * Used for computing p-values from z-scores.
 */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp(-x * x / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}
