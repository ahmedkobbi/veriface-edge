/**
 * VeriFace Edge — Multi-Region Deployment & Replication
 *
 * Manages active-active multi-region deployment:
 *   - Region registry (us-east, eu-west, ap-southeast, etc.)
 *   - Cross-region audit log replication
 *   - Replication lag monitoring
 *   - Failover management
 *
 * In production, each region runs an independent VeriFace instance
 * with its own database. Audit logs are replicated across regions
 * via this service (using a combination of DB sync + webhook push).
 *
 * For this implementation, we simulate multi-region with an in-memory
 * registry + a replication queue. In production, this would use:
 *   - PostgreSQL logical replication
 *   - AWS DynamoDB Global Tables
 *   - CockroachDB multi-region
 *   - Or a custom Kafka-based replication pipeline
 */

import { db } from '@/lib/db'
import { logger } from '@/lib/logger'
import { sha256Hex } from '@/lib/crypto-server'

// ---------------------------------------------------------------------------
// Region registry
// ---------------------------------------------------------------------------

export interface Region {
  id: string
  name: string
  location: string
  endpoint: string         // API endpoint for this region
  status: 'active' | 'standby' | 'degraded' | 'offline'
  isPrimary: boolean
  latencyMs: number
  lastHeartbeat: Date
  entryCount: number       // total audit entries in this region
}

const defaultRegions: Region[] = [
  {
    id: 'us-east-1',
    name: 'US East (N. Virginia)',
    location: 'North America',
    endpoint: process.env.REGION_US_EAST_ENDPOINT ?? 'https://us-east.api.veriface.io',
    status: 'active',
    isPrimary: true,
    latencyMs: 12,
    lastHeartbeat: new Date(),
    entryCount: 0,
  },
  {
    id: 'eu-west-1',
    name: 'EU West (Ireland)',
    location: 'Europe',
    endpoint: process.env.REGION_EU_WEST_ENDPOINT ?? 'https://eu-west.api.veriface.io',
    status: 'active',
    isPrimary: false,
    latencyMs: 8,
    lastHeartbeat: new Date(),
    entryCount: 0,
  },
  {
    id: 'ap-southeast-1',
    name: 'AP Southeast (Singapore)',
    location: 'Asia Pacific',
    endpoint: process.env.REGION_AP_SOUTHEAST_ENDPOINT ?? 'https://ap-southeast.api.veriface.io',
    status: 'active',
    isPrimary: false,
    latencyMs: 24,
    lastHeartbeat: new Date(),
    entryCount: 0,
  },
]

const regionRegistry = new Map<string, Region>(defaultRegions.map(r => [r.id, r]))

// ---------------------------------------------------------------------------
// Replication queue (in-memory — production: Kafka/SQS)
// ---------------------------------------------------------------------------

interface ReplicationTask {
  id: string
  auditEntryId: string
  tenantId: string
  sourceRegion: string
  targetRegion: string
  status: 'pending' | 'synced' | 'failed'
  attempts: number
  createdAt: Date
  syncedAt?: Date
}

const replicationQueue: ReplicationTask[] = []
const MAX_REPLICATION_LAG_MS = 5 * 60 * 1000 // 5 minutes

// ---------------------------------------------------------------------------
// Region management
// ---------------------------------------------------------------------------

export function getRegions(): Region[] {
  // Update entry counts from DB
  return Array.from(regionRegistry.values())
}

export function getPrimaryRegion(): Region {
  for (const region of regionRegistry.values()) {
    if (region.isPrimary) return region
  }
  // Fallback to first
  return Array.from(regionRegistry.values())[0]
}

export async function updateRegionHeartbeat(regionId: string): Promise<void> {
  const region = regionRegistry.get(regionId)
  if (region) {
    region.lastHeartbeat = new Date()
    region.status = 'active'
  }
}

export async function failoverRegion(targetRegionId: string): Promise<{ success: boolean; message: string }> {
  const target = regionRegistry.get(targetRegionId)
  if (!target) {
    return { success: false, message: 'Region not found' }
  }
  if (target.status === 'offline') {
    return { success: false, message: 'Cannot failover to an offline region' }
  }

  // Demote current primary
  for (const [id, region] of regionRegistry) {
    region.isPrimary = (id === targetRegionId)
  }

  logger.warn({ newPrimary: targetRegionId }, 'Region failover executed')

  return {
    success: true,
    message: `Primary region changed to ${target.name}. All new requests will be routed there.`,
  }
}

// ---------------------------------------------------------------------------
// Replication status
// ---------------------------------------------------------------------------

export function getReplicationStatus(): {
  queueSize: number
  pendingCount: number
  syncedCount: number
  failedCount: number
  avgLagMs: number
  lastSyncAt: Date | null
  regions: Array<{ id: string; name: string; lag: number; status: string }>
} {
  const pending = replicationQueue.filter(t => t.status === 'pending')
  const synced = replicationQueue.filter(t => t.status === 'synced')
  const failed = replicationQueue.filter(t => t.status === 'failed')

  const now = Date.now()
  const lags = pending.map(t => now - t.createdAt.getTime())
  const avgLag = lags.length > 0 ? lags.reduce((a, b) => a + b, 0) / lags.length : 0

  const lastSynced = synced
    .map(t => t.syncedAt)
    .filter(Boolean)
    .sort((a, b) => b!.getTime() - a!.getTime())[0]

  return {
    queueSize: replicationQueue.length,
    pendingCount: pending.length,
    syncedCount: synced.length,
    failedCount: failed.length,
    avgLagMs: Math.round(avgLag),
    lastSyncAt: lastSynced ?? null,
    regions: getRegions().map(r => ({
      id: r.id,
      name: r.name,
      lag: r.id === getPrimaryRegion().id ? 0 : Math.round(avgLag),
      status: r.status,
    })),
  }
}

/**
 * Enqueue an audit entry for cross-region replication.
 * Called from appendAudit after the entry is written locally.
 */
export function enqueueReplication(auditEntryId: string, tenantId: string, sourceRegion: string): void {
  const primaryRegion = getPrimaryRegion()

  for (const [regionId] of regionRegistry) {
    if (regionId === sourceRegion) continue // Don't replicate to self

    replicationQueue.push({
      id: crypto.randomUUID(),
      auditEntryId,
      tenantId,
      sourceRegion,
      targetRegion: regionId,
      status: 'pending',
      attempts: 0,
      createdAt: new Date(),
    })
  }

  // Trim queue if it grows too large (production: move to dead-letter table)
  if (replicationQueue.length > 10_000) {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000
    for (let i = replicationQueue.length - 1; i >= 0; i--) {
      if (replicationQueue[i].createdAt.getTime() < cutoff) {
        replicationQueue.splice(i, 1)
      }
    }
  }
}

/**
 * Process pending replication tasks (called by cron).
 * In production, this would push to remote region APIs via HTTPS.
 */
export async function processReplicationQueue(maxTasks: number = 50): Promise<{
  processed: number
  synced: number
  failed: number
}> {
  const pending = replicationQueue
    .filter(t => t.status === 'pending')
    .slice(0, maxTasks)

  let synced = 0
  let failed = 0

  for (const task of pending) {
    try {
      // Simulate replication (production: POST to remote region API)
      // await fetch(`${regionRegistry.get(task.targetRegion)?.endpoint}/api/internal/replicate`, ...)

      task.status = 'synced'
      task.syncedAt = new Date()
      task.attempts++
      synced++

      // Update region entry count
      const targetRegion = regionRegistry.get(task.targetRegion)
      if (targetRegion) targetRegion.entryCount++
    } catch (e) {
      task.status = 'failed'
      task.attempts++
      failed++
      logger.error({ error: e, taskId: task.id }, 'Replication task failed')
    }
  }

  return { processed: pending.length, synced, failed }
}
