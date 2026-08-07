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
    const escapeCsvCell = (value: string): string => {
      // Escape double quotes
      let escaped = value.replace(/"/g, '""')
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
      const payload = JSON.stringify(JSON.parse(e.payload))
      csvRows.push([
        e.chainIndex,
        escapeCsvCell(e.eventType),
        escapeCsvCell(e.createdAt.toISOString()),
        escapeCsvCell(e.actorIp ?? ''),
        escapeCsvCell(e.apiKeyId ?? ''),
        e.prevHash,
        e.thisHash,
        escapeCsvCell(payload),
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
