'use client'

/**
 * VeriFace Edge — Audit Streaming & Multi-Region Dashboard
 *
 * Two modules:
 *   1. Audit Stream — live SSE feed with format selector (JSON/CEF/LEEF/Syslog)
 *   2. Multi-Region — region map, replication status, failover control
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassStatCard, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import {
  ShieldLockIcon, RadioIcon, ActivityIcon, RefreshIcon, CheckCircleIcon,
  XCircleIcon, ZapIcon, CopyIcon, CpuIcon, EyeIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'

// === AUDIT STREAM MODULE ===
export function AuditStreamModule({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [format, setFormat] = useState<'json' | 'cef' | 'leef' | 'syslog'>('json')
  const [eventTypeFilter, setEventTypeFilter] = useState('')
  const [subscriberCount, setSubscriberCount] = useState(0)
  const eventSourceRef = useRef<EventSource | null>(null)
  const { toast } = usePremiumToast()

  const pausedRef = useRef(false)
  useEffect(() => { pausedRef.current = paused }, [paused])

  const connectRef = useRef<() => void>(() => {})

  const connect = () => {
    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const params = new URLSearchParams({ format })
    if (eventTypeFilter) params.set('eventType', eventTypeFilter)

    const es = new EventSource(`/api/admin/audit/stream?${params.toString()}`)
    eventSourceRef.current = es

    es.addEventListener('connected', (e: any) => {
      setConnected(true)
      try {
        const data = JSON.parse(e.data)
        setSubscriberCount(data.activeSubscribers ?? 0)
      } catch {}
      toast.success('Connected to audit stream')
    })

    es.addEventListener('audit', (e: any) => {
      if (paused) return
      try {
        const entry = JSON.parse(e.data)
        setEntries(prev => [entry, ...prev].slice(0, 200))
      } catch {}
    })

    es.onerror = () => {
      setConnected(false)
      toast.error('Stream disconnected — reconnecting...')
      // Auto-reconnect after 3s — use a ref to avoid circular dependency
      setTimeout(() => { if (!pausedRef.current) connectRef.current() }, 3000)
    }
  }


  useEffect(() => {
    connectRef.current = connect
    connect()
    return () => {
      if (eventSourceRef.current) eventSourceRef.current.close()
    }
  })

  const handleCopy = (entry: any) => {
    const text = format === 'json' ? JSON.stringify(entry, null, 2)
      : format === 'cef' ? `CEF:0|VeriFace|Edge|1.0|${entry.eventType}|${entry.eventType}|${entry.eventType.includes('failure') ? 8 : 3}|src=${entry.actorIp} ${Object.entries(entry.payload).map(([k,v]) => `${k}=${v}`).join(' ')}`
      : format === 'leef' ? `LEEF:1.0|VeriFace|Edge|1.0|${entry.eventType}|src=${entry.actorIp}\t${Object.entries(entry.payload).map(([k,v]) => `${k}=${v}`).join('\t')}`
      : `<${entry.eventType.includes('failure') ? 141 : 134}>${entry.timestamp} veriface-edge audit[${process.pid}]: ${JSON.stringify({ eventType: entry.eventType, ...entry.payload })}`
    navigator.clipboard.writeText(text)
    toast.success('Copied')
  }

  const handleCopyStreamURL = () => {
    const url = `${window.location.origin}/api/admin/audit/stream?format=${format}${eventTypeFilter ? `&eventType=${eventTypeFilter}` : ''}`
    navigator.clipboard.writeText(url)
    toast.success('Stream URL copied', 'Import this into Splunk/Datadog/Elastic SIEM')
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
            <span className="text-xs font-medium text-slate-200">
              {connected ? 'Connected' : 'Disconnected'}
            </span>
            {subscriberCount > 0 && <GlassBadge variant="default">{subscriberCount} subscribers</GlassBadge>}
          </div>
          <div className="flex items-center gap-2">
            <select value={format} onChange={e => setFormat(e.target.value as any)}
              className="px-2 py-1 rounded-lg bg-slate-950 border border-white/[0.08] text-[10px] text-slate-200">
              <option value="json">JSON</option>
              <option value="cef">CEF (Splunk)</option>
              <option value="leef">LEEF (QRadar)</option>
              <option value="syslog">Syslog</option>
            </select>
            <PremiumButton variant="ghost" size="sm" onClick={() => setPaused(!paused)} icon={paused ? <RadioIcon className="w-3 h-3" /> : <ActivityIcon className="w-3 h-3" />}>
              {paused ? 'Resume' : 'Pause'}
            </PremiumButton>
            <PremiumButton variant="ghost" size="sm" onClick={handleCopyStreamURL} icon={<CopyIcon className="w-3 h-3" />}>
              Copy URL
            </PremiumButton>
          </div>
        </div>

        <GlassInput
          placeholder="Filter by event type (comma-separated): auth.success,auth.failure"
          value={eventTypeFilter}
          onChange={e => setEventTypeFilter(e.target.value)}
          className="text-[10px]"
        />

        {/* SIEM integration hint */}
        <div className="mt-3 p-2 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
          <p className="text-[10px] text-cyan-300">
            <strong>SIEM Integration:</strong> Use the stream URL with Splunk HTTP Event Collector,
            Datadog Logs API, Elastic Logstash, or IBM QRadar Universal Cloud Connector.
          </p>
        </div>
      </GlassSurface>

      {/* Live feed */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">Live Audit Feed</h3>
          <GlassBadge variant="default">{entries.length} events</GlassBadge>
        </div>
        {entries.length === 0 ? (
          <div className="text-center py-12">
            {connected ? (
              <>
                <div className="flex justify-center mb-3"><PremiumSpinner variant="dots" /></div>
                <p className="text-xs text-slate-500">Waiting for audit events...</p>
              </>
            ) : (
              <p className="text-xs text-slate-500">Not connected. Reconnecting...</p>
            )}
          </div>
        ) : (
          <ScrollArea className="h-80 pr-3">
            <div className="space-y-1">
              {entries.map((entry, i) => (
                <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.04] transition-colors group">
                  {entry.eventType.includes('success') ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 mt-0.5" />
                    : entry.eventType.includes('failure') || entry.eventType.includes('injection') ? <XCircleIcon className="w-3.5 h-3.5 text-red-400 mt-0.5" />
                    : <ActivityIcon className="w-3.5 h-3.5 text-slate-500 mt-0.5" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <GlassBadge variant={entry.eventType.includes('success') ? 'success' : entry.eventType.includes('failure') ? 'error' : 'default'}>
                        {entry.eventType}
                      </GlassBadge>
                      <span className="text-[10px] text-slate-500 font-mono">#{entry.chainIndex}</span>
                      {entry.actorIp && <code className="text-[10px] text-slate-600">{entry.actorIp.slice(0, 12)}</code>}
                      <span className="text-[10px] text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                    </div>
                    <pre className="text-[10px] text-slate-400 font-mono mt-0.5 overflow-x-auto">{JSON.stringify(entry.payload)}</pre>
                  </div>
                  <button onClick={() => handleCopy(entry)} className="opacity-0 group-hover:opacity-100 p-1 text-slate-500 hover:text-slate-300 transition-opacity">
                    <CopyIcon className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </GlassSurface>
    </div>
  )
}

// === MULTI-REGION MODULE ===
export function MultiRegionModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [regions, setRegions] = useState<any[]>([])
  const [replication, setReplication] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [failoverTarget, setFailoverTarget] = useState<string | null>(null)
  const [failingOver, setFailingOver] = useState(false)
  const { toast } = usePremiumToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [regionsRes, replRes] = await Promise.all([
        fetch('/api/admin/regions', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
        fetch('/api/admin/replication/status', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
      ])
      if (regionsRes.success) setRegions(regionsRes.regions)
      if (replRes.success) setReplication(replRes)
    } catch { toast.error('Failed to load region data') }
    finally { setLoading(false) }
  }, [tenantId, toast])

  useEffect(() => { fetchData() }, [fetchData])

  const handleFailover = async (regionId: string) => {
    setFailingOver(true)
    try {
      const res = await fetch('/api/admin/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ action: 'failover', regionId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Failover complete', data.message)
        setFailoverTarget(null)
        fetchData()
      } else toast.error('Failover failed', data.message)
    } catch { toast.error('Failover failed') }
    finally { setFailingOver(false) }
  }

  const handleProcessReplication = async () => {
    try {
      const res = await fetch('/api/admin/replication/status', {
        method: 'POST',
        headers: { 'X-Tenant-Id': tenantId },
      })
      const data = await res.json()
      if (data.success) {
        toast.success(`Replication processed: ${data.synced} synced, ${data.failed} failed`)
        fetchData()
      }
    } catch { toast.error('Failed') }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      {/* Region overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {regions.map(region => (
          <GlassSurface key={region.id} blur="xl" opacity={region.isPrimary ? 'heavy' : 'medium'} glow={region.isPrimary}
            className={`rounded-2xl p-4 ${region.isPrimary ? 'border-emerald-500/20' : ''}`}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${region.status === 'active' ? 'bg-emerald-400 animate-pulse' : region.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className="text-sm font-medium text-slate-200">{region.name}</span>
              </div>
              {region.isPrimary && <GlassBadge variant="success">PRIMARY</GlassBadge>}
            </div>
            <div className="space-y-1 text-[10px] text-slate-500">
              <div className="flex justify-between"><span>ID:</span><code className="font-mono">{region.id}</code></div>
              <div className="flex justify-between"><span>Location:</span><span>{region.location}</span></div>
              <div className="flex justify-between"><span>Endpoint:</span><code className="font-mono text-[9px]">{region.endpoint.slice(0, 30)}...</code></div>
              <div className="flex justify-between"><span>Latency:</span><span className={region.latencyMs < 20 ? 'text-emerald-400' : 'text-amber-400'}>{region.latencyMs}ms</span></div>
              <div className="flex justify-between"><span>Status:</span><span className={region.status === 'active' ? 'text-emerald-400' : 'text-amber-400'}>{region.status}</span></div>
              <div className="flex justify-between"><span>Last heartbeat:</span><span>{new Date(region.lastHeartbeat).toLocaleTimeString()}</span></div>
            </div>
            {!region.isPrimary && userRole === 'admin' && region.status !== 'offline' && (
              <div className="mt-3">
                {failoverTarget === region.id ? (
                  <div className="space-y-2">
                    <PremiumAlert variant="warning">Promote {region.name} to primary? Current primary will be demoted.</PremiumAlert>
                    <div className="flex gap-2">
                      <PremiumButton variant="ghost" size="sm" onClick={() => setFailoverTarget(null)}>Cancel</PremiumButton>
                      <PremiumButton variant="danger" size="sm" onClick={() => handleFailover(region.id)} loading={failingOver}>Confirm Failover</PremiumButton>
                    </div>
                  </div>
                ) : (
                  <PremiumButton variant="ghost" size="sm" onClick={() => setFailoverTarget(region.id)} icon={<ZapIcon className="w-3 h-3" />}>Failover</PremiumButton>
                )}
              </div>
            )}
          </GlassSurface>
        ))}
      </div>

      {/* Replication status */}
      {replication && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <GlassStatCard label="Queue Size" value={replication.queueSize} icon={<ActivityIcon className="w-4 h-4" />} />
            <GlassStatCard label="Pending" value={replication.pendingCount} icon={<RefreshIcon className="w-4 h-4" />} />
            <GlassStatCard label="Synced" value={replication.syncedCount} icon={<CheckCircleIcon className="w-4 h-4" />} />
            <GlassStatCard label="Failed" value={replication.failedCount} icon={<XCircleIcon className="w-4 h-4" />} />
            <GlassStatCard label="Avg Lag" value={`${replication.avgLagMs}ms`} icon={<ZapIcon className="w-4 h-4" />} />
          </div>

          <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-200">Cross-Region Replication</h3>
              <div className="flex items-center gap-2">
                {replication.lastSyncAt && <span className="text-[10px] text-slate-500">Last sync: {new Date(replication.lastSyncAt).toLocaleTimeString()}</span>}
                {userRole === 'admin' && (
                  <PremiumButton variant="ghost" size="sm" onClick={handleProcessReplication} icon={<RefreshIcon className="w-3 h-3" />}>Process Now</PremiumButton>
                )}
              </div>
            </div>
            <div className="space-y-2">
              {replication.regions.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <div className="flex items-center gap-2">
                    <CpuIcon className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="text-xs text-slate-300">{r.name}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] ${r.lag < 1000 ? 'text-emerald-400' : r.lag < 10000 ? 'text-amber-400' : 'text-red-400'}`}>
                      {r.lag === 0 ? 'primary' : `${r.lag}ms lag`}
                    </span>
                    <GlassBadge variant={r.status === 'active' ? 'success' : 'warning'}>{r.status}</GlassBadge>
                  </div>
                </div>
              ))}
            </div>
          </GlassSurface>

          {/* Architecture diagram */}
          <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
            <h3 className="text-sm font-medium text-slate-200 mb-3">Active-Active Architecture</h3>
            <div className="flex items-center justify-around gap-2 py-4">
              {regions.map((region, i) => (
                <div key={region.id} className="flex items-center gap-2">
                  <div className={`flex flex-col items-center p-3 rounded-xl border ${region.isPrimary ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/[0.08] bg-white/[0.02]'}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${region.isPrimary ? 'bg-emerald-500/20' : 'bg-slate-700/50'}`}>
                      <CpuIcon className={`w-4 h-4 ${region.isPrimary ? 'text-emerald-400' : 'text-slate-400'}`} />
                    </div>
                    <span className="text-[10px] text-slate-300 text-center">{region.id}</span>
                    {region.isPrimary && <span className="text-[8px] text-emerald-400 mt-0.5">PRIMARY</span>}
                  </div>
                  {i < regions.length - 1 && (
                    <div className="flex flex-col items-center">
                      <div className="flex gap-0.5">
                        <div className="w-4 h-px bg-emerald-500/30" />
                        <div className="w-4 h-px bg-emerald-500/30" />
                      </div>
                      <span className="text-[8px] text-slate-600 mt-0.5">replicate</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </GlassSurface>
        </>
      )}
    </div>
  )
}
