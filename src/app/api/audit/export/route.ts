/**
 * GET /api/audit/export?tenantId=xxx&format=json|csv&from=ISO&to=ISO
 * Export the full audit log for compliance / external review.
 *
 * Requires 'audit:read' scope. Returns the entire log (up to 10,000 entries)
 * as JSON or CSV. The hash chain is preserved in the export for offline
 * integrity verification.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireApiKey } from '@/lib/auth'
import { safeErrorResponse } from '@/lib/config'

const MAX_EXPORT_ENTRIES = 10_000

export async function GET(req: NextRequest) {
  const authResult = await requireApiKey(req, 'audit:read')
  if (!authResult.ok) return authResult.response

  const url = new URL(req.url)
  const format = url.searchParams.get('format') ?? 'json'
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const tenantId = authResult.auth.tenantId!

  if (format !== 'json' && format !== 'csv') {
    return NextResponse.json({ success: false, error: 'format must be json or csv' }, { status: 400 })
  }

  try {
    const entries = await db.auditLog.findMany({
      where: {
        tenantId,
        ...(from || to
          ? {
              createdAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { chainIndex: 'asc' },
      take: MAX_EXPORT_ENTRIES,
    })

    if (format === 'json') {
      return NextResponse.json({
        success: true,
        tenantId,
        exportedAt: new Date().toISOString(),
        count: entries.length,
        entries: entries.map((e) => ({
          chainIndex: e.chainIndex,
          eventType: e.eventType,
          payload: JSON.parse(e.payload),
          prevHash: e.prevHash,
          thisHash: e.thisHash,
          actorIp: e.actorIp,
          apiKeyId: e.apiKeyId,
          createdAt: e.createdAt,
        })),
      })
    }

    // CSV format — with formula injection protection (CWE-1236)
    // SECURITY FIX (L-9): Handle null/undefined values explicitly.
    // Previously: `escapeCsvCell(e.actorIp ?? '')` handled null, but
    // `e.prevHash` and `e.thisHash` were passed raw — if they were null
    // (e.g., corrupted DB row), they'd render as "null" or "undefined" in
    // the CSV, breaking parsers. Also, `JSON.parse(e.payload)` could throw
    // if the payload was malformed, crashing the entire export.
    const escapeCsvCell = (value: unknown): string => {
      // Handle null/undefined explicitly
      if (value === null || value === undefined) {
        return '""'
      }
      let str: string
      if (value instanceof Date) {
        str = value.toISOString()
      } else if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
      } else if (typeof value === 'object') {
        str = JSON.stringify(value)
      } else {
        str = String(value)
      }
      // Escape double quotes
      let escaped = str.replace(/"/g, '""')
      // Prevent CSV formula injection: prefix dangerous chars with single quote
      if (/^[=+\-@\t\r]/.test(escaped)) {
        escaped = "'" + escaped
      }
      return `"${escaped}"`
    }

    const csvRows: string[] = [
      'chainIndex,eventType,createdAt,actorIp,apiKeyId,prevHash,thisHash,payload',
    ]
    for (const e of entries) {
      // SECURITY FIX (L-9): Wrap JSON.parse in try/catch — a corrupted payload
      // should not crash the entire export.
      let payloadStr: string
      try {
        payloadStr = JSON.stringify(JSON.parse(e.payload))
      } catch {
        // Malformed JSON — export raw (escaped)
        payloadStr = e.payload ?? ''
      }
      csvRows.push([
        escapeCsvCell(e.chainIndex),
        escapeCsvCell(e.eventType),
        escapeCsvCell(e.createdAt),
        escapeCsvCell(e.actorIp),
        escapeCsvCell(e.apiKeyId),
        escapeCsvCell(e.prevHash),
        escapeCsvCell(e.thisHash),
        escapeCsvCell(payloadStr),
      ].join(','))
    }

    return new NextResponse(csvRows.join('\n'), {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="veriface-audit-${tenantId}-${Date.now()}.csv"`,
      },
    })
  } catch (e) {
    return NextResponse.json(
      safeErrorResponse(e),
      { status: 500 },
    )
  }
}
