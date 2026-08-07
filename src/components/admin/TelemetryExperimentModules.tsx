'use client'

/**
 * VeriFace Edge — Telemetry + Experiments Admin Modules
 *
 * 2 modules:
 *   1. TelemetryModule — SDK error dashboard (stats, error log, browser/OS breakdown)
 *   2. ExperimentsModule — A/B test manager (create, start, monitor significance)
 *
 * Both modules match the existing glassmorphism aesthetic.
 */

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast, PremiumDialog } from '@/components/premium/Premium'
import {
  ActivityIcon, PulseIcon, CheckCircleIcon, XCircleIcon, RefreshIcon,
  ZapIcon, CpuIcon, MailIcon, ShieldLockIcon, SettingsIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'

// === TELEMETRY MODULE ===
export function TelemetryModule({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<'stats' | 'errors'>('stats')

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <ActivityIcon className="w-5 h-5 text-emerald-400" />
          SDK Error Telemetry
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Opt-in anonymous error reports from the browser SDK · No PII, no face data
        </p>
      </div>

      <div className="inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1">
        {(['stats', 'errors'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}>
            {t === 'stats' ? 'Dashboard' : 'Error Log'}
          </button>
        ))}
      </div>

      {tab === 'stats' && <TelemetryStatsTab tenantId={tenantId} />}
      {tab === 'errors' && <TelemetryErrorsTab tenantId={tenantId} />}
    </div>
  )
}

function TelemetryStatsTab({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/telemetry/stats', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setStats(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!stats) return null

  return (
    <div className="space-y-3">
      {/* Severity counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total (24h)" value={stats.counts['24h'].total} color="text-slate-200" />
        <StatCard label="Fatal (30d)" value={stats.counts['30d'].fatal} color="text-red-400" />
        <StatCard label="Errors (30d)" value={stats.counts['30d'].error} color="text-amber-400" />
        <StatCard label="Warnings (30d)" value={stats.counts['30d'].warning} color="text-cyan-400" />
      </div>

      {/* Trend chart */}
      <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-4">
        <h4 className="text-xs font-medium text-slate-300 mb-3">Error Trend (14 days)</h4>
        <div className="flex items-end gap-1 h-32">
          {stats.trend.length === 0 ? (
            <p className="text-xs text-slate-500 m-auto">No errors in the last 14 days 🎉</p>
          ) : (
            stats.trend.map((day: any) => {
              const total = day.fatal + day.error + day.warning
              const maxTotal = Math.max(...stats.trend.map((d: any) => d.fatal + d.error + d.warning), 1)
              const heightPct = (total / maxTotal) * 100
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1" title={`${day.date}: ${total} errors`}>
                  <div className="w-full flex flex-col-reverse rounded-t-sm overflow-hidden" style={{ height: `${heightPct}%`, minHeight: total > 0 ? '4px' : '0' }}>
                    {day.fatal > 0 && <div className="bg-red-500" style={{ flex: day.fatal }} />}
                    {day.error > 0 && <div className="bg-amber-500" style={{ flex: day.error }} />}
                    {day.warning > 0 && <div className="bg-cyan-500" style={{ flex: day.warning }} />}
                  </div>
                  <div className="text-[9px] text-slate-600">{day.date.slice(5)}</div>
                </div>
              )
            })
          )}
        </div>
        <div className="flex items-center gap-3 mt-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> Fatal</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-amber-500" /> Error</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-cyan-500" /> Warning</span>
        </div>
      </GlassSurface>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Top error codes */}
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Top Error Codes (30d)</h4>
          {stats.topErrorCodes.length === 0 ? (
            <p className="text-xs text-slate-500">No errors recorded.</p>
          ) : (
            <div className="space-y-2">
              {stats.topErrorCodes.map((e: any) => (
                <div key={e.code} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-300">{e.code}</span>
                  <span className="font-bold text-slate-200">{e.count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        {/* Top stages */}
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Top Stages (30d)</h4>
          {stats.topStages.length === 0 ? (
            <p className="text-xs text-slate-500">No errors recorded.</p>
          ) : (
            <div className="space-y-2">
              {stats.topStages.map((s: any) => (
                <div key={s.stage} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-300">{s.stage}</span>
                  <span className="font-bold text-slate-200">{s.count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Browser breakdown */}
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Browsers</h4>
          {stats.browserBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500">—</p>
          ) : (
            <div className="space-y-1">
              {stats.browserBreakdown.map((b: any) => (
                <div key={b.family} className="flex justify-between text-xs">
                  <span className="text-slate-400">{b.family}</span>
                  <span className="text-slate-200">{b.count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        {/* OS breakdown */}
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Operating Systems</h4>
          {stats.osBreakdown.length === 0 ? (
            <p className="text-xs text-slate-500">—</p>
          ) : (
            <div className="space-y-1">
              {stats.osBreakdown.map((o: any) => (
                <div key={o.family} className="flex justify-between text-xs">
                  <span className="text-slate-400">{o.family}</span>
                  <span className="text-slate-200">{o.count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        {/* WebGPU adoption */}
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">WebGPU Adoption</h4>
          <div className="text-3xl font-bold text-emerald-400">{stats.webgpuAdoptionRate}%</div>
          <div className="text-[10px] text-slate-600 mt-1">of error reports have WebGPU available</div>
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="text-[10px] text-slate-500 mb-1">SDK Versions</div>
            {stats.sdkVersions.map((v: any) => (
              <div key={v.version} className="flex justify-between text-[10px]">
                <span className="font-mono text-slate-400">{v.version}</span>
                <span className="text-slate-300">{v.count}</span>
              </div>
            ))}
          </div>
        </GlassSurface>
      </div>

      <PremiumAlert variant="info">
        <span className="font-medium">Privacy:</span>{' '}
        All telemetry is opt-in and anonymous. We collect error codes, SDK version, browser/OS family,
        and timing metrics — NEVER face data, embeddings, PII, or full user-agent strings.
        Tenant IDs are hashed (SHA-256) before storage. Rate limited: 10 events/min per IP.
      </PremiumAlert>
    </div>
  )
}

function TelemetryErrorsTab({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/admin/telemetry/errors${filter ? `?errorCode=${filter}` : ''}`
      const res = await fetch(url, { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setEntries(data.entries)
    } finally {
      setLoading(false)
    }
  }, [tenantId, filter])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  const errorCodes = ['NO_WEBGPU', 'CAMERA_DENIED', 'NO_CAMERA', 'INJECTION_SUSPECTED', 'LIVENESS_FAILED', 'NO_FACE', 'NETWORK_ERROR', 'VERIFICATION_FAILED']

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`px-2.5 py-1 rounded-md text-xs font-medium ${!filter ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:bg-white/5'}`}>
          All
        </button>
        {errorCodes.map((c) => (
          <button key={c} onClick={() => setFilter(c)}
            className={`px-2.5 py-1 rounded-md text-xs font-mono ${filter === c ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:bg-white/5'}`}>
            {c}
          </button>
        ))}
      </div>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-2">
        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No error events recorded.</p>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 p-2">
              {entries.map((e) => (
                <div key={e.id} className="rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GlassBadge variant={
                          e.severity === 'fatal' ? 'error' :
                          e.severity === 'warning' ? 'warning' : 'default'
                        }>
                          {e.severity}
                        </GlassBadge>
                        <span className="text-xs font-mono text-emerald-400">{e.errorCode}</span>
                        <span className="text-[10px] text-slate-500">@ {e.stage}</span>
                        {e.experimentVariant && (
                          <GlassBadge variant="info">{e.experimentVariant}</GlassBadge>
                        )}
                      </div>
                      <div className="text-xs text-slate-300 mt-1.5 font-mono break-all">{e.errorMessage}</div>
                      <div className="text-[10px] text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span>SDK {e.sdkVersion}</span>
                        <span>·</span>
                        <span>{e.browserFamily} / {e.osFamily}</span>
                        <span>·</span>
                        <span>WebGPU: {e.hasWebGPU ? '✓' : '✗'}</span>
                        <span>·</span>
                        <span>{new Date(e.createdAt).toLocaleString()}</span>
                      </div>
                      {e.metrics && (
                        <div className="text-[10px] text-slate-600 mt-1 font-mono">
                          {Object.entries(e.metrics).map(([k, v]) => `${k}=${v}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </GlassSurface>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
    </div>
  )
}

// === EXPERIMENTS MODULE ===
export function ExperimentsModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [experiments, setExperiments] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/experiments', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setExperiments(data.experiments)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  if (selected) {
    return <ExperimentDetail experimentId={selected} tenantId={tenantId} onBack={() => { setSelected(null); load() }} />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <ZapIcon className="w-5 h-5 text-amber-400" />
            A/B Experiments
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Test different liveness thresholds, capture durations, and more</p>
        </div>
        {userRole === 'admin' && (
          <PremiumButton variant="secondary" size="sm" onClick={() => setShowCreate(true)} icon={<ZapIcon className="w-3.5 h-3.5" />}>
            New Experiment
          </PremiumButton>
        )}
      </div>

      {experiments.length === 0 ? (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-8 text-center">
          <ZapIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-sm text-slate-400 mb-1">No experiments yet</p>
          <p className="text-xs text-slate-600">Create your first experiment to test different SDK parameters.</p>
        </GlassSurface>
      ) : (
        <div className="space-y-2">
          {experiments.map((exp) => (
            <button key={exp.id} onClick={() => setSelected(exp.id)}
              className="w-full text-left rounded-xl bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.06] p-4 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <GlassBadge variant={
                      exp.state === 'running' ? 'success' :
                      exp.state === 'completed' ? 'info' :
                      exp.state === 'paused' ? 'warning' : 'default'
                    }>
                      {exp.state}
                    </GlassBadge>
                    <span className="text-sm font-medium text-slate-200">{exp.name}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Variable: <code className="text-emerald-400">{exp.variable}</code> ·
                    {' '}{exp.variants.length} variants ·
                    {' '}Created {new Date(exp.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-slate-500">Min sample</div>
                  <div className="text-sm font-bold text-slate-300">{exp.minSampleSize}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <CreateExperimentDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        tenantId={tenantId}
        onCreated={() => { setShowCreate(false); load() }}
      />
    </div>
  )
}

function CreateExperimentDialog({ open, onClose, tenantId, onCreated }: {
  open: boolean; onClose: () => void; tenantId: string; onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [variable, setVariable] = useState('liveness_threshold')
  const [description, setDescription] = useState('')
  const [variants, setVariants] = useState([
    { name: 'control', value: 0.78, weight: 50 },
    { name: 'strict', value: 0.82, weight: 50 },
  ])
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  const totalWeight = variants.reduce((s, v) => s + v.weight, 0)

  const submit = async () => {
    if (!name.trim()) { toast.error('Name required'); return }
    if (totalWeight !== 100) { toast.error('Weights must sum to 100', `Currently: ${totalWeight}`); return }
    if (!variants.some(v => v.name === 'control')) { toast.error('Control variant required'); return }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/experiments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ name, variable, description, variants }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Experiment created', 'Start it to begin collecting data')
        onCreated()
      } else {
        toast.error('Creation failed', data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <PremiumDialog open={open} onClose={onClose} title="Create A/B Experiment">
      <div className="space-y-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Name</label>
          <GlassInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Liveness threshold Q3 2026" className="w-full" />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Variable</label>
          <select value={variable} onChange={(e) => setVariable(e.target.value)}
            className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200">
            <option value="liveness_threshold">liveness_threshold</option>
            <option value="capture_duration_ms">capture_duration_ms</option>
            <option value="rppg_window_ms">rppg_window_ms</option>
            <option value="pad_threshold">pad_threshold</option>
            <option value="cosine_threshold">cosine_threshold</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Description (optional)</label>
          <GlassInput value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Testing stricter liveness threshold to reduce FAR" className="w-full" />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Variants <span className={`ml-2 ${totalWeight === 100 ? 'text-emerald-400' : 'text-amber-400'}`}>(weights: {totalWeight}/100)</span>
          </label>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  value={v.name}
                  onChange={(e) => {
                    const next = [...variants]
                    next[i] = { ...v, name: e.target.value }
                    setVariants(next)
                  }}
                  className="flex-1 bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                  placeholder="variant name"
                />
                <input
                  type="number"
                  step="0.01"
                  value={v.value}
                  onChange={(e) => {
                    const next = [...variants]
                    next[i] = { ...v, value: Number(e.target.value) }
                    setVariants(next)
                  }}
                  className="w-20 bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                />
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={v.weight}
                  onChange={(e) => {
                    const next = [...variants]
                    next[i] = { ...v, weight: Number(e.target.value) }
                    setVariants(next)
                  }}
                  className="w-16 bg-slate-900/80 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-200"
                />
                <span className="text-[10px] text-slate-500">%</span>
                {variants.length > 2 && (
                  <button onClick={() => setVariants(variants.filter((_, j) => j !== i))}
                    className="text-red-400 hover:text-red-300 text-xs">×</button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => setVariants([...variants, { name: `variant_${variants.length}`, value: 0.8, weight: 0 }])}
            className="text-xs text-emerald-400 hover:text-emerald-300 mt-2">+ Add variant</button>
        </div>
        <div className="flex justify-end gap-2 pt-3">
          <PremiumButton variant="ghost" size="sm" onClick={onClose}>Cancel</PremiumButton>
          <PremiumButton variant="primary" size="sm" onClick={submit} disabled={saving}>
            {saving ? 'Creating...' : 'Create Experiment'}
          </PremiumButton>
        </div>
      </div>
    </PremiumDialog>
  )
}

function ExperimentDetail({ experimentId, tenantId, onBack }: {
  experimentId: string; tenantId: string; onBack: () => void
}) {
  const [data, setData] = useState<any>(null)
  const [sig, setSig] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [expRes, sigRes] = await Promise.all([
        fetch(`/api/admin/experiments/${experimentId}`, { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
        fetch(`/api/admin/experiments/${experimentId}/significance`, { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
      ])
      if (expRes.success) setData(expRes)
      if (sigRes.success) setSig(sigRes)
    } finally {
      setLoading(false)
    }
  }, [experimentId, tenantId])

  useEffect(() => { load() }, [load])

  const patch = async (action: 'start' | 'pause' | 'complete') => {
    try {
      const res = await fetch(`/api/admin/experiments/${experimentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ action }),
      })
      const d = await res.json()
      if (d.success) {
        toast.success(`Experiment ${action}ed`)
        load()
        onBack()
      } else {
        toast.error('Action failed', d.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return null

  const exp = data.experiment

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <PremiumButton variant="ghost" size="sm" onClick={onBack}>← Back</PremiumButton>
          <div>
            <h2 className="text-lg font-semibold text-slate-100">{exp.name}</h2>
            <p className="text-xs text-slate-500">
              <code className="text-emerald-400">{exp.variable}</code> ·
              {' '}<GlassBadge variant={
                exp.state === 'running' ? 'success' :
                exp.state === 'completed' ? 'info' :
                exp.state === 'paused' ? 'warning' : 'default'
              }>{exp.state}</GlassBadge>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {exp.state === 'draft' && <PremiumButton variant="primary" size="sm" onClick={() => patch('start')}>Start</PremiumButton>}
          {exp.state === 'running' && <PremiumButton variant="secondary" size="sm" onClick={() => patch('pause')}>Pause</PremiumButton>}
          {exp.state === 'paused' && <PremiumButton variant="primary" size="sm" onClick={() => patch('start')}>Resume</PremiumButton>}
          {(exp.state === 'running' || exp.state === 'paused') && <PremiumButton variant="danger" size="sm" onClick={() => patch('complete')}>Complete</PremiumButton>}
        </div>
      </div>

      {exp.description && <PremiumAlert variant="info">{exp.description}</PremiumAlert>}

      {/* Significance summary */}
      {sig && (
        <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-4">
          <h4 className="text-sm font-medium text-slate-200 mb-2">Statistical Analysis</h4>
          {sig.summary.recommendation && (
            <PremiumAlert variant={sig.summary.hasSignificantResult ? 'success' : 'info'} className="mb-3">
              {sig.summary.recommendation}
            </PremiumAlert>
          )}
          {sig.results.length > 0 && (
            <div className="space-y-2">
              {sig.results.map((r: any) => (
                <div key={r.variant} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{r.variant}</span>
                      {r.significant && r.hasEnoughSamples && (
                        <GlassBadge variant={r.uplift > 0 ? 'success' : 'error'}>
                          {r.uplift > 0 ? '↑' : '↓'} {Math.abs(r.relativeUplift * 100).toFixed(1)}%
                        </GlassBadge>
                      )}
                      {!r.hasEnoughSamples && <GlassBadge variant="warning">Need more samples</GlassBadge>}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      p-value: {r.pValue.toFixed(4)} · z: {r.zScore.toFixed(2)}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-2 text-xs">
                    <div>
                      <div className="text-slate-500 text-[10px]">Control rate</div>
                      <div className="font-bold text-slate-200">{(r.pControl * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Variant rate</div>
                      <div className="font-bold text-slate-200">{(r.pVariant * 100).toFixed(1)}%</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Control n</div>
                      <div className="font-bold text-slate-200">{r.nControl}</div>
                    </div>
                    <div>
                      <div className="text-slate-500 text-[10px]">Variant n</div>
                      <div className="font-bold text-slate-200">{r.nVariant}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      )}

      {/* Variant stats */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h4 className="text-xs font-medium text-slate-300 mb-3">Variant Performance</h4>
        <div className="space-y-2">
          {data.variantStats.map((v: any) => (
            <div key={v.variant} className="rounded-lg bg-white/[0.02] p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-200">{v.variant}</span>
                  <code className="text-[10px] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">value: {String(v.value)}</code>
                  {v.variant === 'control' && <GlassBadge>control</GlassBadge>}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <div>
                  <div className="text-slate-500 text-[10px]">Assignments</div>
                  <div className="font-bold text-slate-200">{v.assignments}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px]">Outcomes</div>
                  <div className="font-bold text-slate-200">{v.outcomes}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px]">Success rate</div>
                  <div className={`font-bold ${(v.successRate * 100) >= 80 ? 'text-emerald-400' : (v.successRate * 100) >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                    {(v.successRate * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px]">Avg liveness</div>
                  <div className="font-bold text-slate-200">{v.avgLivenessScore != null ? v.avgLivenessScore.toFixed(3) : '—'}</div>
                </div>
                <div>
                  <div className="text-slate-500 text-[10px]">Avg duration</div>
                  <div className="font-bold text-slate-200">{v.avgDurationMs != null ? `${v.avgDurationMs}ms` : '—'}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassSurface>

      <PremiumAlert variant="info">
        <span className="font-medium">How it works:</span>{' '}
        Users are deterministically bucketed via SHA-256(tenantSalt | experimentId | externalUserId) mod 100.
        Assignments are sticky — the same user always sees the same variant for the experiment's lifetime.
        Significance is computed via two-proportion z-test (p &lt; {exp.significanceThreshold}).
        {exp.autoStopOnSignificance && ' Auto-stops when significance is reached.'}
      </PremiumAlert>
    </div>
  )
}
