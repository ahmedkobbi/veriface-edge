'use client'

/**
 * VeriFace Edge — Notifications + Rate Limit Admin Modules
 *
 * 2 modules:
 *   1. NotificationsModule — email queue, history, deliverability stats, preferences
 *   2. RateLimitModule — plan tier, monthly quota progress, per-minute limits
 *
 * Both modules are designed to match the existing glassmorphism aesthetic
 * (GlassSurface, GlassBadge, PremiumButton, etc.).
 */

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import {
  ShieldLockIcon, RadioIcon, CheckCircleIcon, XCircleIcon,
  RefreshIcon, ActivityIcon, ZapIcon, MailIcon, CpuIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'

// === NOTIFICATIONS MODULE ===
export function NotificationsModule({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<'history' | 'queue' | 'stats' | 'prefs'>('history')
  const { toast } = usePremiumToast()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <MailIcon className="w-5 h-5 text-emerald-400" />
            Email Notifications
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Auth alerts, billing alerts, security notifications</p>
        </div>
        <SendTestEmailButton tenantId={tenantId} />
      </div>

      <div className="inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1">
        {(['history', 'queue', 'stats', 'prefs'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}>
            {t === 'history' && 'History'}
            {t === 'queue' && 'Queue'}
            {t === 'stats' && 'Stats'}
            {t === 'prefs' && 'Preferences'}
          </button>
        ))}
      </div>

      {tab === 'history' && <EmailHistoryTab tenantId={tenantId} />}
      {tab === 'queue' && <QueueTab tenantId={tenantId} />}
      {tab === 'stats' && <StatsTab tenantId={tenantId} />}
      {tab === 'prefs' && <PreferencesTab tenantId={tenantId} />}
    </div>
  )
}

function SendTestEmailButton({ tenantId }: { tenantId: string }) {
  const [sending, setSending] = useState(false)
  const { toast } = usePremiumToast()

  const send = async () => {
    setSending(true)
    try {
      const res = await fetch('/api/admin/notifications/send-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Test email sent', data.message)
      } else {
        toast.error('Failed', data.message ?? data.error)
      }
    } catch {
      toast.error('Network error', 'Failed to send test email')
    } finally {
      setSending(false)
    }
  }

  return (
    <PremiumButton variant="secondary" size="sm" onClick={send} disabled={sending} icon={<MailIcon className="w-3.5 h-3.5" />}>
      {sending ? 'Sending...' : 'Send Test'}
    </PremiumButton>
  )
}

function EmailHistoryTab({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [summary, setSummary] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const url = `/api/admin/notifications/history${filter ? `?state=${filter}` : ''}`
      const res = await fetch(url, { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) {
        setEntries(data.entries)
        setSummary(data.summary)
      }
    } finally {
      setLoading(false)
    }
  }, [tenantId, filter])

  useEffect(() => { load() }, [load])

  const retry = async (emailId: string) => {
    try {
      const res = await fetch('/api/admin/notifications/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ emailId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Retry scheduled', 'Email will be re-sent shortly')
        load()
      } else {
        toast.error('Retry failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {[
            { label: 'Total', value: summary.total, color: 'text-slate-200' },
            { label: 'Sent', value: summary.sent, color: 'text-emerald-400' },
            { label: 'Pending', value: summary.pending, color: 'text-amber-400' },
            { label: 'Failed', value: summary.failed, color: 'text-red-400' },
            { label: 'Suppressed', value: summary.suppressed, color: 'text-slate-500' },
          ].map((s) => (
            <div key={s.label} className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="text-xs text-slate-500">{s.label}</div>
              <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {['', 'sent', 'pending', 'failed', 'suppressed'].map((s) => (
          <button key={s || 'all'} onClick={() => setFilter(s)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
              filter === s ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'text-slate-400 hover:bg-white/5'
            }`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-2">
        {entries.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No emails yet. Trigger an event (login, billing threshold) to see history.</p>
        ) : (
          <ScrollArea className="h-[500px]">
            <div className="space-y-1 p-2">
              {entries.map((e) => (
                <div key={e.id} className="rounded-lg bg-white/[0.02] hover:bg-white/[0.04] border border-white/[0.04] p-3 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <GlassBadge variant={
                          e.state === 'sent' ? 'success' :
                          e.state === 'pending' ? 'warning' :
                          e.state === 'failed' ? 'error' : 'default'
                        }>
                          {e.state}
                        </GlassBadge>
                        <span className="text-xs font-mono text-slate-400">{e.template}</span>
                        <span className="text-[10px] text-slate-600">attempt {e.attempts}/{e.maxAttempts}</span>
                      </div>
                      <div className="text-xs text-slate-200 mt-1.5 truncate">{e.subject}</div>
                      <div className="text-[10px] text-slate-500 mt-1">To: {e.toAddress} · {new Date(e.createdAt).toLocaleString()}</div>
                      {e.lastError && (
                        <div className="text-[10px] text-red-400 mt-1 font-mono truncate">Error: {e.lastError}</div>
                      )}
                    </div>
                    {e.state === 'failed' && (
                      <PremiumButton variant="ghost" size="sm" onClick={() => retry(e.id)} icon={<RefreshIcon className="w-3 h-3" />}>
                        Retry
                      </PremiumButton>
                    )}
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

function QueueTab({ tenantId }: { tenantId: string }) {
  const [health, setHealth] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications/process-queue', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setHealth(data)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const triggerProcess = async () => {
    setProcessing(true)
    try {
      const res = await fetch('/api/notifications/process-queue', {
        method: 'POST',
        headers: { 'X-Tenant-Id': tenantId },
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Queue processed', `${data.processed} emails, ${data.sent} sent, ${data.failed} failed`)
        load()
      } else {
        toast.error('Processing failed', data.error)
      }
    } catch {
      toast.error('Network error')
    } finally {
      setProcessing(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!health) return null

  return (
    <div className="space-y-3">
      <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-500 mb-1">Queue Depth</div>
            <div className="text-2xl font-bold text-amber-400">{health.queueDepth}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">pending delivery</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Failed (24h)</div>
            <div className="text-2xl font-bold text-red-400">{health.failed}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">dead-lettered</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Sent (24h)</div>
            <div className="text-2xl font-bold text-emerald-400">{health.sent24h}</div>
            <div className="text-[10px] text-slate-600 mt-0.5">successful deliveries</div>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-white/[0.06]">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">
              Cron job runs every 5 minutes. Trigger manually to process the queue now.
            </div>
            <PremiumButton variant="secondary" size="sm" onClick={triggerProcess} disabled={processing}
              icon={<RefreshIcon className={`w-3.5 h-3.5 ${processing ? 'animate-spin' : ''}`} />}>
              {processing ? 'Processing...' : 'Process Now'}
            </PremiumButton>
          </div>
        </div>
      </GlassSurface>

      <PremiumAlert variant="info">
        <span className="font-medium">How it works:</span>{' '}
        Triggered emails (login alerts, billing alerts) are written to the queue with state='pending'.
        A cron job processes pending entries every 5 minutes — sending via SMTP/SES/Resend.
        Failed sends retry with exponential backoff (1m, 10m, 1h), up to 4 attempts total.
      </PremiumAlert>
    </div>
  )
}

function StatsTab({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/notifications/stats', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setStats(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!stats) return null

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-4">
          <div className="text-xs text-slate-500">Deliverability Rate (30d)</div>
          <div className="text-3xl font-bold text-emerald-400 mt-1">{stats.deliverabilityRate}%</div>
          <div className="text-[10px] text-slate-600 mt-1">{stats.sent30d} emails sent</div>
        </GlassSurface>
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <div className="text-xs text-slate-500">Avg Attempts to Success</div>
          <div className="text-3xl font-bold text-cyan-400 mt-1">{Number(stats.averageAttempts).toFixed(2)}</div>
          <div className="text-[10px] text-slate-600 mt-1">Lower is better (1.0 = first-try delivery)</div>
        </GlassSurface>
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <div className="text-xs text-slate-500">30-Day Volume</div>
          <div className="text-3xl font-bold text-slate-200 mt-1">
            {stats.counts['30d'].sent + stats.counts['30d'].failed + stats.counts['30d'].suppressed}
          </div>
          <div className="text-[10px] text-slate-600 mt-1">
            {stats.counts['30d'].sent} sent · {stats.counts['30d'].failed} failed · {stats.counts['30d'].suppressed} suppressed
          </div>
        </GlassSurface>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Top Templates (30d)</h4>
          {stats.topTemplates.length === 0 ? (
            <p className="text-xs text-slate-500">No emails sent yet.</p>
          ) : (
            <div className="space-y-2">
              {stats.topTemplates.map((t: any) => (
                <div key={t.template} className="flex items-center justify-between text-xs">
                  <span className="font-mono text-slate-400">{t.template}</span>
                  <span className="font-bold text-slate-200">{t.count}</span>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>

        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Top Failure Reasons (30d)</h4>
          {stats.topErrors.length === 0 ? (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircleIcon className="w-3.5 h-3.5" /> No failures.
            </p>
          ) : (
            <div className="space-y-2">
              {stats.topErrors.map((e: any, i: number) => (
                <div key={i} className="text-xs">
                  <div className="font-mono text-red-400 truncate">{e.error}</div>
                  <div className="text-[10px] text-slate-600">{e.count} occurrences</div>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      </div>
    </div>
  )
}

function PreferencesTab({ tenantId }: { tenantId: string }) {
  const [prefs, setPrefs] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  useEffect(() => {
    fetch('/api/admin/notifications/preferences', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setPrefs(d.preferences) }).finally(() => setLoading(false))
  }, [tenantId])

  const toggle = async (key: string, value: boolean) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/notifications/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ [key]: value }),
      })
      const data = await res.json()
      if (data.success) {
        setPrefs(data.preferences)
        toast.success('Preferences updated')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!prefs) return null

  const prefRows = [
    { key: 'authAlerts', label: 'Auth Alerts', desc: 'New device logins, password changes, 2FA changes', icon: <ShieldLockIcon className="w-4 h-4 text-emerald-400" /> },
    { key: 'securityAlerts', label: 'Security Alerts', desc: 'Injection attacks, brute force, suspicious activity', icon: <ShieldLockIcon className="w-4 h-4 text-red-400" /> },
    { key: 'billingAlerts', label: 'Billing Alerts', desc: 'Usage thresholds, monthly limit reached, spending alerts', icon: <ZapIcon className="w-4 h-4 text-amber-400" /> },
    { key: 'productUpdates', label: 'Product Updates', desc: 'New features, changelog, scheduled maintenance', icon: <CpuIcon className="w-4 h-4 text-cyan-400" /> },
    { key: 'weeklyDigest', label: 'Weekly Digest', desc: 'Weekly usage summary delivered every Monday', icon: <ActivityIcon className="w-4 h-4 text-purple-400" /> },
  ]

  return (
    <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-4">
      <h4 className="text-sm font-medium text-slate-200 mb-3">Notification Preferences</h4>
      <div className="space-y-3">
        {prefRows.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3 py-3 border-b border-white/[0.04] last:border-0">
            <div className="flex items-start gap-3 flex-1">
              <div className="mt-0.5">{p.icon}</div>
              <div>
                <div className="text-sm font-medium text-slate-200">{p.label}</div>
                <div className="text-xs text-slate-500 mt-0.5">{p.desc}</div>
              </div>
            </div>
            <Switch
              checked={prefs[p.key]}
              onCheckedChange={(v) => toggle(p.key, v)}
              disabled={saving}
            />
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-3">
        Changes take effect immediately. Suppressed emails are still logged for audit but not delivered.
      </p>
    </GlassSurface>
  )
}

// === RATE LIMIT / PLAN MODULE ===
export function RateLimitModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [plan, setPlan] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/plan', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setPlan(data)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const changeTier = async (tier: string) => {
    if (userRole !== 'admin') {
      toast.error('Admin only', 'Only admins can change plan tier')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ planTier: tier }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Plan updated', `Now on ${tier} plan`)
        load()
      } else {
        toast.error('Update failed', data.error)
      }
    } finally {
      setSaving(false)
    }
  }

  const updateSpending = async (spendingLimitUsd: number, alertThresholdPct: number) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ spendingLimitUsd, alertThresholdPct }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Settings updated')
        load()
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!plan) return null

  const { plan: planInfo, config, usage } = plan

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <ZapIcon className="w-5 h-5 text-amber-400" />
          API Rate Limits & Plan
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Per-plan monthly quotas + per-minute rate limits</p>
      </div>

      {/* Plan tier cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {(['developer', 'growth', 'enterprise'] as const).map((tier) => {
          const info = PLAN_INFO[tier]
          const isCurrent = planInfo.tier === tier
          return (
            <button
              key={tier}
              onClick={() => changeTier(tier)}
              disabled={saving || isCurrent}
              className={`text-left rounded-2xl p-4 border transition-all ${
                isCurrent
                  ? 'bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border-emerald-500/30'
                  : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
              }`}
              style={isCurrent ? { boxShadow: `0 0 0 1px ${info.color}40` } : undefined}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold" style={{ color: info.color }}>{info.name}</span>
                {isCurrent && <GlassBadge variant="success">Current</GlassBadge>}
              </div>
              <div className="text-2xl font-bold text-slate-100">
                {tier === 'enterprise' ? '∞' : info.monthlyLimit.toLocaleString()}
                <span className="text-xs font-normal text-slate-500 ml-1">/month</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">{info.perMin}/min burst</div>
              {tier === 'growth' && <div className="text-[10px] text-amber-400 mt-1">${info.pricePerAuth}/auth</div>}
              {tier === 'developer' && <div className="text-[10px] text-emerald-400 mt-1">Free</div>}
              {tier === 'enterprise' && <div className="text-[10px] text-purple-400 mt-1">Custom pricing</div>}
            </button>
          )
        })}
      </div>

      {/* Monthly usage progress */}
      <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-medium text-slate-200">Monthly API Usage</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Resets in {usage.daysUntilReset} days ({new Date(usage.resetsAt).toLocaleDateString()})
            </p>
          </div>
          <GlassBadge variant={planInfo.tier === 'developer' ? 'default' : 'success'}>
            {planInfo.tierName}
          </GlassBadge>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400">
              {usage.authsThisMonth.toLocaleString()} / {planInfo.monthlyLimit === -1 ? '∞' : planInfo.monthlyLimit.toLocaleString()} calls
            </span>
            <span className={`font-bold ${
              usage.usedPct >= 100 ? 'text-red-400' :
              usage.usedPct >= 80 ? 'text-amber-400' : 'text-emerald-400'
            }`}>
              {planInfo.monthlyLimit === -1 ? '∞' : `${usage.usedPct.toFixed(1)}%`}
            </span>
          </div>
          <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
            <div
              className="h-full transition-all rounded-full"
              style={{
                width: `${Math.min(100, usage.usedPct)}%`,
                background: usage.usedPct >= 100
                  ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                  : usage.usedPct >= 80
                  ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                  : 'linear-gradient(90deg, #10b981, #06b6d4)',
              }}
            />
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500">
            <span>
              Remaining: {usage.authsRemaining === -1 ? '∞' : usage.authsRemaining.toLocaleString()}
            </span>
            <span>Est. cost: ${usage.estimatedCost.toFixed(2)}</span>
          </div>
        </div>

        {usage.limitReached && (
          <PremiumAlert variant="error" className="mt-3">
            Monthly quota exhausted — all API requests are returning HTTP 429 until {new Date(usage.resetsAt).toLocaleDateString()}.
            Upgrade your plan to restore service.
          </PremiumAlert>
        )}
        {usage.alertTriggered && !usage.limitReached && (
          <PremiumAlert variant="warning" className="mt-3">
            You've crossed the {config.alertThresholdPct}% usage threshold. Consider upgrading to avoid hitting the monthly limit.
          </PremiumAlert>
        )}
      </GlassSurface>

      {/* Per-minute limit + spending config */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-2">Per-Minute Rate Limit</h4>
          <div className="text-2xl font-bold text-cyan-400">{planInfo.perMinuteLimit}/min</div>
          <div className="text-[10px] text-slate-600 mt-1">
            Effective limit (max of plan floor & tenant custom: {config.customPerMinuteLimit}/min)
          </div>
          <div className="mt-3 pt-3 border-t border-white/[0.06]">
            <div className="text-[10px] text-slate-500">Response headers</div>
            <div className="font-mono text-[10px] text-slate-400 mt-1 space-y-0.5">
              <div>X-RateLimit-Limit: {planInfo.perMinuteLimit}</div>
              <div>X-RateLimit-Remaining: &lt;int&gt;</div>
              <div>X-RateLimit-Reset: &lt;unix-ts&gt;</div>
              <div className="text-emerald-400">X-RateLimit-Quota-Limit: {planInfo.monthlyLimit}</div>
              <div className="text-emerald-400">X-RateLimit-Quota-Remaining: &lt;int&gt;</div>
              <div className="text-cyan-400">X-Plan-Tier: {planInfo.tier}</div>
            </div>
          </div>
        </GlassSurface>

        <SpendingConfig
          tenantId={tenantId}
          spendingLimitUsd={config.spendingLimitUsd}
          alertThresholdPct={config.alertThresholdPct}
          estimatedCost={usage.estimatedCost}
          spendingPct={usage.spendingPct}
          onSave={updateSpending}
          saving={saving}
        />
      </div>

      <PremiumAlert variant="info">
        <span className="font-medium">How billing works:</span>{' '}
        Developer plan: free (1K calls/mo). Growth: $0.08/auth (100K calls/mo).
        Enterprise: custom pricing (unlimited). Only <code className="text-emerald-400">auth.success</code> and{' '}
        <code className="text-emerald-400">enroll.success</code> events count against quota — read endpoints (audit, metrics) are free.
      </PremiumAlert>
    </div>
  )
}

const PLAN_INFO: Record<string, { name: string; monthlyLimit: number; perMin: number; pricePerAuth: number; color: string }> = {
  developer: { name: 'Developer', monthlyLimit: 1_000, perMin: 10, pricePerAuth: 0, color: '#10b981' },
  growth: { name: 'Growth', monthlyLimit: 100_000, perMin: 100, pricePerAuth: 0.08, color: '#06b6d4' },
  enterprise: { name: 'Enterprise', monthlyLimit: -1, perMin: 1_000, pricePerAuth: 0, color: '#a855f7' },
}

function SpendingConfig({
  tenantId, spendingLimitUsd, alertThresholdPct, estimatedCost, spendingPct,
  onSave, saving,
}: {
  tenantId: string
  spendingLimitUsd: number
  alertThresholdPct: number
  estimatedCost: number
  spendingPct: number
  onSave: (spendingLimitUsd: number, alertThresholdPct: number) => void
  saving: boolean
}) {
  const [limit, setLimit] = useState(spendingLimitUsd)
  const [threshold, setThreshold] = useState(alertThresholdPct)

  useEffect(() => {
    setLimit(spendingLimitUsd)
    setThreshold(alertThresholdPct)
  }, [spendingLimitUsd, alertThresholdPct])

  return (
    <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
      <h4 className="text-xs font-medium text-slate-300 mb-2">Spending Configuration</h4>
      <div className="space-y-3">
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Monthly Budget (USD)</label>
          <GlassInput
            type="number"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            min={0}
            step={10}
            className="w-full"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 block mb-1">Alert Threshold ({threshold}%)</label>
          <input
            type="range"
            min={50}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>
        <div className="text-[10px] text-slate-500 space-y-0.5">
          <div>Current spend: <span className="text-amber-400 font-bold">${estimatedCost.toFixed(2)}</span></div>
          <div>Budget used: <span className={spendingPct >= 100 ? 'text-red-400' : 'text-slate-300'}>{spendingPct.toFixed(1)}%</span></div>
        </div>
        <PremiumButton
          variant="secondary"
          size="sm"
          onClick={() => onSave(limit, threshold)}
          disabled={saving || (limit === spendingLimitUsd && threshold === alertThresholdPct)}
          className="w-full"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </PremiumButton>
      </div>
    </GlassSurface>
  )
}
