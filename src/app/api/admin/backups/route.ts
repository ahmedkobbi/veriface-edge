/**
 * GET /api/admin/backups
 * Returns backup history + status for the admin panel.
 *
 * Query params:
 *   ?limit=20  — Number of records (max 100)
 *   ?status=success|failed  — Filter by status
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePlatformSession } from '@/lib/platform-session'

export async function GET(req: NextRequest) {
  const session = await requirePlatformSession(req)
  if (!session.ok) return session.response

  if (session.user.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'Admin only' }, { status: 403 })
  }

  const url = new URL(req.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20', 10), 100)
  const status = url.searchParams.get('status') ?? undefined

  const backups = await db.backupRecord.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    take: limit,
  })

  // Summary stats
  const totalBackups = await db.backupRecord.count()
  const successfulBackups = await db.backupRecord.count({ where: { status: 'success' } })
  const failedBackups = await db.backupRecord.count({ where: { status: 'failed' } })

  const lastSuccessful = await db.backupRecord.findFirst({
    where: { status: 'success' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, encryptedSizeBytes: true, backupId: true },
  })

  // Calculate backup health
  const now = Date.now()
  const lastBackupTime = lastSuccessful?.createdAt?.getTime() ?? 0
  const hoursSinceLastBackup = (now - lastBackupTime) / (1000 * 60 * 60)
  const isHealthy = hoursSinceLastBackup < 8 // Healthy if backup within last 8 hours

  return NextResponse.json({
    success: true,
    summary: {
      total: totalBackups,
      successful: successfulBackups,
      failed: failedBackups,
      lastSuccessful: lastSuccessful?.createdAt ?? null,
      hoursSinceLastBackup: Math.round(hoursSinceLastBackup * 10) / 10,
      isHealthy,
      retentionDays: parseInt(process.env.BACKUP_RETENTION_DAYS ?? '7', 10),
      s3Configured: !!process.env.BACKUP_S3_BUCKET,
    },
    backups,
  })
}
