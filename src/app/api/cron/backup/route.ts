/**
 * POST /api/cron/backup
 * Cron endpoint — runs the encrypted database backup.
 *
 * Auth: Requires CRON_SECRET header (fail-closed in production).
 * Called every 6 hours by external scheduler (Vercel Cron, GitHub Actions, k8s cron).
 *
 * Security:
 *   - CRON_SECRET required (fail-closed in production)
 *   - Backup encrypted with AES-256-GCM
 *   - SHA-256 integrity verification
 *   - Round-trip decryption test
 *   - S3 upload with KMS encryption (if configured)
 *   - BackupRecord stored in DB for audit trail
 */

import { NextRequest, NextResponse } from 'next/server'
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { db } from '@/lib/db'
import { logger } from '@/lib/logger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Auth: CRON_SECRET (fail-closed in production)
  const cronSecret = req.headers.get('x-cron-secret')
  const expected = process.env.CRON_SECRET

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('CRON_SECRET not configured — refusing to run backup cron')
      return NextResponse.json({ error: 'Cron not configured' }, { status: 503 })
    }
    // Dev: allow without secret
  } else if (cronSecret !== expected) {
    logger.warn({ hasSecret: !!cronSecret }, 'Backup cron called with invalid secret')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    // Run the backup script
    const scriptPath = join(process.cwd(), 'scripts', 'backup-db.sh')

    if (!existsSync(scriptPath)) {
      return NextResponse.json({ error: 'Backup script not found' }, { status: 500 })
    }

    // Execute backup script (captures stdout)
    const output = execSync(`bash ${scriptPath}`, {
      timeout: 300_000, // 5 min timeout
      encoding: 'utf8',
      env: {
        ...process.env,
        // Ensure required env vars are passed
        DATABASE_URL: process.env.DATABASE_URL,
        BACKUP_ENCRYPTION_KEY: process.env.BACKUP_ENCRYPTION_KEY,
        BACKUP_S3_BUCKET: process.env.BACKUP_S3_BUCKET,
        BACKUP_S3_KMS_KEY_ID: process.env.BACKUP_S3_KMS_KEY_ID,
      },
    })

    // Parse the backup manifest (created by the script)
    const manifestMatch = output.match(/Manifest:\s+\S+\/(\S+\.manifest\.json)/)
    let manifest: any = null

    if (manifestMatch) {
      const manifestPath = join(process.cwd(), 'backups', manifestMatch[1])
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

        // Store backup record in DB for audit trail
        await db.backupRecord.create({
          data: {
            backupId: manifest.backupId,
            backupType: manifest.backupType,
            source: manifest.source,
            encryptedFile: manifest.encryptedFile,
            encryptedSizeBytes: manifest.encryptedSizeBytes,
            encryptedSha256: manifest.encryptedSha256,
            originalSizeBytes: manifest.originalSizeBytes,
            originalSha256: manifest.originalSha256,
            iv: manifest.encryption.iv,
            s3Bucket: manifest.s3Bucket || null,
            s3Key: manifest.s3Key || null,
            s3Uri: manifest.s3Bucket ? `s3://${manifest.s3Bucket}/${manifest.s3Key}` : null,
            status: 'success',
            host: manifest.host,
          },
        })

        logger.info({ backupId: manifest.backupId, durationMs: Date.now() - startTime }, 'Backup completed successfully')
      }
    }

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startTime,
      backup: manifest,
      output: output.slice(-500), // Last 500 chars of output
    })
  } catch (e: any) {
    logger.error({ error: e, durationMs: Date.now() - startTime }, 'Backup failed')

    // Record failed backup
    try {
      await db.backupRecord.create({
        data: {
          backupId: `failed-${Date.now()}`,
          backupType: 'unknown',
          source: process.env.DATABASE_URL || 'unknown',
          encryptedFile: '',
          encryptedSizeBytes: 0,
          encryptedSha256: '',
          originalSizeBytes: 0,
          originalSha256: '',
          iv: '',
          status: 'failed',
          error: String(e.message || e).slice(0, 500),
        },
      })
    } catch {
      // Ignore DB errors (DB might be down — that's why we're backing up)
    }

    return NextResponse.json(
      { success: false, error: e.message, durationMs: Date.now() - startTime },
      { status: 500 },
    )
  }
}

/**
 * GET /api/cron/backup
 * Returns backup status (last backup + history).
 */
export async function GET() {
  const recentBackups = await db.backupRecord.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      backupId: true,
      backupType: true,
      encryptedSizeBytes: true,
      status: true,
      s3Uri: true,
      host: true,
      createdAt: true,
      error: true,
    },
  })

  const lastSuccessful = await db.backupRecord.findFirst({
    where: { status: 'success' },
    orderBy: { createdAt: 'desc' },
  })

  return NextResponse.json({
    success: true,
    lastBackup: lastSuccessful?.createdAt ?? null,
    recentBackups,
  })
}
