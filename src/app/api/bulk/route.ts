/**
 * POST /api/bulk
 *
 * Bulk operations endpoint for enterprise clients that need to perform
 * multiple operations in a single request (e.g., mass GDPR deletion,
 * batch user lookup, bulk consent recording).
 *
 * Body:
 *   {
 *     operations: [
 *       { type: "delete_template", externalUserId: "user_1" },
 *       { type: "delete_template", externalUserId: "user_2" },
 *       { type: "consent", externalUserId: "user_3", purpose: "authentication", granted: false }
 *     ]
 *   }
 *
 * Returns:
 *   { results: [{ index, success, data?, error? }], summary: { total, succeeded, failed } }
 *
 * Limits:
 *   - Max 100 operations per request
 *   - Each operation is independent (partial success allowed)
 *   - Atomic mode available (all-or-nothing) via { atomic: true }
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { revokeTemplate } from '@/lib/tenant'
import { appendAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { z } from 'zod'
import { safeErrorResponse } from '@/lib/config'

const BulkOperationSchema = z.object({
  type: z.enum(['delete_template', 'consent']),
  externalUserId: z.string().min(1).max(256),
  purpose: z.enum(['authentication', 'enrollment', 'age_verification']).optional(),
  granted: z.boolean().optional(),
})

const BulkRequestSchema = z.object({
  operations: z.array(BulkOperationSchema).min(1).max(100),
  atomic: z.boolean().optional(),
})

export async function POST(req: NextRequest) {
  const authResult = await requireApiKey(req, 'tenant:admin')
  if (!authResult.ok) return authResult.response

  const body = await req.json().catch(() => ({}))
  const validation = BulkRequestSchema.safeParse(body)
  if (!validation.success) {
    return NextResponse.json(
      { success: false, error: validation.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 },
    )
  }

  const { operations, atomic } = validation.data
  const tenantId = authResult.auth.tenantId!

  // FIX (H5): In atomic mode, wrap all operations in a single transaction.
  // If any operation fails, the entire transaction rolls back.
  // SECURITY FIX (bulk-test-fix): Pass `tx` to appendAudit so it participates
  // in this transaction instead of opening a nested one (which causes
  // "Transaction already closed" on SQLite under concurrency).
  if (atomic) {
    try {
      await db.$transaction(async (tx) => {
        for (let i = 0; i < operations.length; i++) {
          const op = operations[i]
          try {
            if (op.type === 'delete_template') {
              await revokeTemplate(tenantId, op.externalUserId)
              await appendAudit({
                tenantId,
                eventType: 'template.revoked',
                payload: { externalUserId: op.externalUserId, bulk: true, deleted: true },
                apiKeyId: authResult.auth.apiKeyId,
              }, tx)  // ← pass tx to avoid nested transaction
            } else if (op.type === 'consent') {
              await appendAudit({
                tenantId,
                eventType: 'consent.recorded',
                payload: { externalUserId: op.externalUserId, purpose: op.purpose, granted: op.granted, bulk: true },
                apiKeyId: authResult.auth.apiKeyId,
              }, tx)  // ← pass tx to avoid nested transaction
            }
          } catch (e) {
            // Throwing inside $transaction rolls back ALL changes
            const errMsg = e instanceof Error ? e.message : String(e)
            logger.error({ error: e, operationIndex: i, operationType: op.type }, `Bulk operation ${i} failed: ${errMsg}`)
            throw new Error(`Operation ${i} failed: ${errMsg}`)
          }
        }
      })

      // All succeeded
      const results = operations.map((_, i) => ({ index: i, success: true }))
      return NextResponse.json({
        success: true,
        results,
        summary: { total: operations.length, succeeded: operations.length, failed: 0 },
      }, { headers: authResult.rateLimitHeaders })
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      logger.error({ error: errMsg, stack: e instanceof Error ? e.stack : undefined }, 'Bulk atomic transaction failed')
      return NextResponse.json({
        success: false,
        error: 'Atomic operation failed — all changes rolled back',
        results: [],
        summary: { total: operations.length, succeeded: 0, failed: operations.length },
      }, { status: 400, headers: authResult.rateLimitHeaders })
    }
  }

  // Non-atomic mode: each operation is independent
  const results: Array<{
    index: number
    success: boolean
    data?: any
    error?: string
  }> = []

  let succeeded = 0
  let failed = 0

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i]
    try {
      let data: any

      if (op.type === 'delete_template') {
        const result = await revokeTemplate(tenantId, op.externalUserId)
        data = result
        await appendAudit({
          tenantId,
          eventType: 'template.revoked',
          payload: { externalUserId: op.externalUserId, bulk: true, deleted: result.deleted },
          apiKeyId: authResult.auth.apiKeyId,
        })
      } else if (op.type === 'consent') {
        data = { recorded: true, purpose: op.purpose, granted: op.granted }
        await appendAudit({
          tenantId,
          eventType: 'consent.recorded',
          payload: { externalUserId: op.externalUserId, purpose: op.purpose, granted: op.granted, bulk: true },
          apiKeyId: authResult.auth.apiKeyId,
        })
      }

      results.push({ index: i, success: true, data })
      succeeded++
    } catch (e) {
      results.push({
        index: i,
        success: false,
        error: safeErrorResponse(e).error,
      })
      failed++
    }
  }

  logger.info({ tenantId, total: operations.length, succeeded, failed }, 'Bulk operation completed')

  return NextResponse.json({
    success: true,
    results,
    summary: {
      total: operations.length,
      succeeded,
      failed,
    },
  }, { headers: authResult.rateLimitHeaders })
}
