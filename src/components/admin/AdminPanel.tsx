'use client'

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassStatCard, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast, PremiumDialog } from '@/components/premium/Premium'
import {
  ShieldLockIcon, KeyIcon, RadioIcon, ActivityIcon, UserPlusIcon, TrashIcon,
  RefreshIcon, CheckCircleIcon, XCircleIcon, DownloadIcon, SettingsIcon, LockIcon,
  CpuIcon, ZapIcon, FingerprintIcon, EyeIcon, PulseIcon, CopyIcon, MailIcon,
} from '@/components/brand/Icons'
import { AuthPage } from '@/components/auth/AuthPage'
import { ScrollArea } from '@/components/ui/scroll-area'
import { FraudScoreModule, AccessPoliciesModule, WebhookDeliveryModule, BrandingModule, EmbedCodeModule, StatusPage } from '@/components/admin/AdvancedModules'
import { SamlConfigModule } from '@/components/admin/SamlConfigModule'
import { AuditStreamModule, MultiRegionModule } from '@/components/admin/StreamRegionModules'
import { NotificationsModule, RateLimitModule } from '@/components/admin/NotificationsModules'
import { TelemetryModule, ExperimentsModule } from '@/components/admin/TelemetryExperimentModules'

type AdminTab = 'dashboard' | 'usage' | 'security' | 'templates' | 'analytics' | 'team' | 'integrations' | 'compliance' | 'developer' | 'settings' | 'fraud' | 'policies' | 'webhooks' | 'branding' | 'embed' | 'status' | 'audit-stream' | 'regions' | 'notifications' | 'rate-limits' | 'telemetry' | 'experiments'

interface PlatformUser {
  id: string; email: string; name: string | null; role: string
  tenantId: string | null; emailVerified: boolean
  createdAt: Date; lastLoginAt: Date | null
}

export function AdminPanel() {
  const [user, setUser] = useState<PlatformUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const { toast } = usePremiumToast()

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.success) setUser(d.user) })
      .catch(() => {}).finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null); toast.info('Signed out')
  }

  if (loading) return <div className="flex items-center justify-center py-20"><div className="flex flex-col items-center gap-3"><PremiumSpinner size="xl" variant="pulse" /><span className="text-xs text-slate-400">Loading...</span></div></div>
  if (!user) return <AuthPage onSuccess={(u) => { if (u) setUser(u); else fetch('/api/auth/me').then(r => r.json()).then(d => { if (d.success) setUser(d.user) }) }} />
  if (!user.tenantId) return <div className="container mx-auto px-4 py-20"><PremiumAlert variant="error" title="No tenant">Your account has no tenant. Contact support.</PremiumAlert></div>

  const tabs: Array<{id: AdminTab; label: string; icon: React.ReactNode}> = [
    { id: 'dashboard', label: 'Dashboard', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'usage', label: 'Usage & Billing', icon: <ZapIcon className="w-3.5 h-3.5" /> },
    { id: 'security', label: 'Security', icon: <ShieldLockIcon className="w-3.5 h-3.5" /> },
    { id: 'templates', label: 'Templates', icon: <FingerprintIcon className="w-3.5 h-3.5" /> },
    { id: 'analytics', label: 'Analytics', icon: <PulseIcon className="w-3.5 h-3.5" /> },
    { id: 'team', label: 'Team', icon: <UserPlusIcon className="w-3.5 h-3.5" /> },
    { id: 'integrations', label: 'Integrations', icon: <CpuIcon className="w-3.5 h-3.5" /> },
    { id: 'compliance', label: 'Compliance', icon: <CheckCircleIcon className="w-3.5 h-3.5" /> },
    { id: 'developer', label: 'Developer', icon: <KeyIcon className="w-3.5 h-3.5" /> },
    { id: 'settings', label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
    { id: 'fraud', label: 'Fraud Score', icon: <ShieldLockIcon className="w-3.5 h-3.5" /> },
    { id: 'policies', label: 'Access Policies', icon: <LockIcon className="w-3.5 h-3.5" /> },
    { id: 'webhooks', label: 'Webhook Log', icon: <RadioIcon className="w-3.5 h-3.5" /> },
    { id: 'branding', label: 'Branding', icon: <CpuIcon className="w-3.5 h-3.5" /> },
    { id: 'embed', label: 'Embed Code', icon: <CopyIcon className="w-3.5 h-3.5" /> },
    { id: 'status', label: 'Status', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'audit-stream', label: 'Live Audit', icon: <RadioIcon className="w-3.5 h-3.5" /> },
    { id: 'regions', label: 'Multi-Region', icon: <CpuIcon className="w-3.5 h-3.5" /> },
    { id: 'notifications', label: 'Notifications', icon: <MailIcon className="w-3.5 h-3.5" /> },
    { id: 'rate-limits', label: 'Rate Limits', icon: <ZapIcon className="w-3.5 h-3.5" /> },
    { id: 'telemetry', label: 'Telemetry', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'experiments', label: 'Experiments', icon: <ZapIcon className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Admin Panel</h1>
          <p className="text-xs text-slate-500 mt-0.5">Signed in as <span className="text-slate-400">{user.email}</span> · <GlassBadge variant={user.role === 'admin' ? 'success' : 'default'}>{user.role}</GlassBadge></p>
        </div>
        <PremiumButton variant="ghost" size="sm" onClick={handleLogout} icon={<LockIcon className="w-3.5 h-3.5" />}><span className="hidden sm:inline">Logout</span></PremiumButton>
      </div>

      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <div className="inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1 min-w-max">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                tab === t.id ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'dashboard' && <DashboardTab tenantId={user.tenantId} />}
      {tab === 'usage' && <UsageTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'security' && <SecurityTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'templates' && <TemplatesTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'analytics' && <AnalyticsTab tenantId={user.tenantId} />}
      {tab === 'team' && <TeamTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'integrations' && <IntegrationsTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'compliance' && <ComplianceTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'developer' && <DeveloperTab tenantId={user.tenantId} />}
      {tab === 'settings' && <SettingsTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'fraud' && <FraudScoreModule tenantId={user.tenantId} />}
      {tab === 'policies' && <AccessPoliciesModule tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'webhooks' && <WebhookDeliveryModule tenantId={user.tenantId} />}
      {tab === 'branding' && <BrandingModule tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'embed' && <EmbedCodeModule tenantId={user.tenantId} />}
      {tab === 'status' && <StatusPage />}
      {tab === 'audit-stream' && <AuditStreamModule tenantId={user.tenantId} />}
      {tab === 'regions' && <MultiRegionModule tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'notifications' && <NotificationsModule tenantId={user.tenantId} />}
      {tab === 'rate-limits' && <RateLimitModule tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'telemetry' && <TelemetryModule tenantId={user.tenantId} />}
      {tab === 'experiments' && <ExperimentsModule tenantId={user.tenantId} userRole={user.role} />}
    </div>
  )
}

// Helper: fetch with session cookie
function useAdminApi(tenantId: string) {
  return useCallback(async (path: string, options?: RequestInit) => {
    return fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
        ...(options?.headers ?? {}),
      },
    })
  }, [tenantId])
}

// === DASHBOARD ===
function DashboardTab({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState({ auths: 0, enrollments: 0, failures: 0, rateLimits: 0 })
  const [recent, setRecent] = useState<any[]>([])
  const [usage, setUsage] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/api/audit?limit=10', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
      fetch('/api/admin/usage', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
    ]).then(([auditData, usageData]) => {
      if (auditData.success) {
        setRecent(auditData.entries)
        setStats({
          auths: auditData.entries.filter((e:any)=>e.eventType==='auth.success').length,
          enrollments: auditData.entries.filter((e:any)=>e.eventType==='enroll.success').length,
          failures: auditData.entries.filter((e:any)=>e.eventType==='auth.failure').length,
          rateLimits: auditData.entries.filter((e:any)=>e.eventType==='rate_limit.exceeded').length,
        })
      }
      if (usageData.success) setUsage(usageData.summary)
    }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Auth Success (30d)" value={usage?.authSuccess ?? 0} icon={<CheckCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Enrollments (30d)" value={usage?.enrollments ?? 0} icon={<UserPlusIcon className="w-4 h-4" />} />
        <GlassStatCard label="Auth Failures (30d)" value={usage?.authFailure ?? 0} icon={<XCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Est. Cost (30d)" value={`$${usage?.estimatedCost ?? 0}`} icon={<ZapIcon className="w-4 h-4" />} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <GlassStatCard label="Active API Keys" value={usage?.activeKeys ?? 0} icon={<KeyIcon className="w-4 h-4" />} />
        <GlassStatCard label="Enrolled Users" value={usage?.enrolledUsers ?? 0} icon={<FingerprintIcon className="w-4 h-4" />} />
        <GlassStatCard label="Injection Attempts" value={usage?.injections ?? 0} icon={<ShieldLockIcon className="w-4 h-4" />} />
      </div>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Recent Activity</h3>
        {recent.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No activity yet.</p> : (
          <div className="space-y-2">
            {recent.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <GlassBadge variant={e.eventType.includes('success')?'success':e.eventType.includes('failure')?'error':'default'}>{e.eventType}</GlassBadge>
                  <span className="text-slate-500 font-mono">#{e.chainIndex}</span>
                </div>
                <span className="text-slate-500">{new Date(e.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === USAGE & BILLING ===
function UsageTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [usage, setUsage] = useState<any>(null)
  const [plan, setPlan] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [spendingLimit, setSpendingLimit] = useState('')
  const [alertThreshold, setAlertThreshold] = useState('')
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  useEffect(() => {
    Promise.all([
      api('/api/admin/usage').then(r => r.json()),
      api('/api/admin/usage/plan').then(r => r.json()),
    ]).then(([u, p]) => {
      if (u.success) setUsage(u)
      if (p.success) {
        setPlan(p)
        setSpendingLimit(String(p.usage.spendingLimitUsd))
        setAlertThreshold(String(p.usage.alertThresholdPct))
      }
    }).finally(() => setLoading(false))
  }, [tenantId, api])

  const handleSavePlan = async () => {
    const res = await api('/api/admin/usage/plan', {
      method: 'PUT',
      body: JSON.stringify({
        spendingLimitUsd: parseFloat(spendingLimit),
        alertThresholdPct: parseFloat(alertThreshold),
      }),
    })
    const data = await res.json()
    if (data.success) toast.success('Plan settings saved')
    else toast.error('Failed to save', data.error)
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      {/* Plan overview */}
      {plan && (
        <GlassSurface blur="xl" opacity="heavy" glow className="rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium text-slate-200">Current Plan</h3>
              <p className="text-xs text-slate-500">{plan.plan.tierName} · ${plan.plan.pricePerAuth}/auth</p>
            </div>
            <GlassBadge variant="success">{plan.plan.tierName}</GlassBadge>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div><p className="text-[10px] text-slate-500">Auths This Month</p><p className="text-lg font-bold text-slate-100">{plan.usage.authsThisMonth}</p></div>
            <div><p className="text-[10px] text-slate-500">Est. Cost</p><p className="text-lg font-bold text-slate-100">${plan.usage.estimatedCost}</p></div>
            <div><p className="text-[10px] text-slate-500">Spending Limit</p><p className="text-lg font-bold text-slate-100">${plan.usage.spendingLimitUsd}</p></div>
            <div><p className="text-[10px] text-slate-500">Auths Remaining</p><p className="text-lg font-bold text-slate-100">{plan.usage.authsRemaining === -1 ? '∞' : plan.usage.authsRemaining}</p></div>
          </div>
          {/* Spending progress bar */}
          <div className="mb-2">
            <div className="flex justify-between text-[10px] text-slate-500 mb-1">
              <span>Spending: ${plan.usage.estimatedCost} / ${plan.usage.spendingLimitUsd}</span>
              <span>{plan.usage.spendingPct}%</span>
            </div>
            <div className="h-2 bg-white/[0.04] rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${
                plan.usage.overLimit ? 'bg-red-500' :
                plan.usage.alertTriggered ? 'bg-amber-500' : 'bg-emerald-500'
              }`} style={{ width: `${Math.min(100, plan.usage.spendingPct)}%` }} />
            </div>
          </div>
          {plan.usage.alertTriggered && !plan.usage.overLimit && (
            <PremiumAlert variant="warning">Spending alert threshold ({plan.usage.alertThresholdPct}%) reached.</PremiumAlert>
          )}
          {plan.usage.overLimit && (
            <PremiumAlert variant="error" title="Spending Limit Exceeded">Authentications may be blocked. Increase your limit or upgrade your plan.</PremiumAlert>
          )}
        </GlassSurface>
      )}

      {/* Plan config */}
      {userRole === 'admin' && plan && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Plan Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GlassInput label="Spending Limit (USD)" type="number" value={spendingLimit} onChange={(e) => setSpendingLimit(e.target.value)} />
            <GlassInput label="Alert Threshold (%)" type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)} />
          </div>
          <div className="mt-3">
            <PremiumButton onClick={handleSavePlan} icon={<CheckCircleIcon className="w-4 h-4" />}>Save Settings</PremiumButton>
          </div>
        </GlassSurface>
      )}

      {/* Daily chart */}
      {usage && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Daily Activity (14 days)</h3>
          <div className="flex items-end gap-1 h-32">
            {usage.daily.slice(-14).map((d:any, i:number) => {
              const max = Math.max(...usage.daily.map((x:any) => x.auths + x.enrollments + x.failures), 1)
              const total = d.auths + d.enrollments + d.failures
              const heightPct = (total / max) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1 group" title={`${d.date}: ${d.auths} auths, ${d.enrollments} enrollments, ${d.failures} failures`}>
                  <div className="w-full flex flex-col-reverse gap-0.5" style={{ height: `${heightPct}%` }}>
                    {d.auths > 0 && <div className="w-full bg-emerald-500/60 rounded-t" style={{ height: `${(d.auths/total)*100}%` }} />}
                    {d.enrollments > 0 && <div className="w-full bg-cyan-500/60" style={{ height: `${(d.enrollments/total)*100}%` }} />}
                    {d.failures > 0 && <div className="w-full bg-red-500/60 rounded-b" style={{ height: `${(d.failures/total)*100}%` }} />}
                  </div>
                  <span className="text-[8px] text-slate-600">{d.date.slice(5)}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><div className="w-2 h-2 bg-emerald-500/60 rounded" />Auth Success</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 bg-cyan-500/60 rounded" />Enrollment</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 bg-red-500/60 rounded" />Failure</span>
          </div>
        </GlassSurface>
      )}
    </div>
  )
}

// === SECURITY CENTER ===
function SecurityTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [data, setData] = useState<any>(null)
  const [blocklist, setBlocklist] = useState<string[]>([])
  const [newIp, setNewIp] = useState('')
  const [ipReason, setIpReason] = useState('')
  const [loading, setLoading] = useState(true)
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [secRes, blRes] = await Promise.all([
      api('/api/admin/security').then(r => r.json()),
      api('/api/admin/security/blocklist').then(r => r.json()),
    ])
    if (secRes.success) setData(secRes)
    if (blRes.success) setBlocklist(blRes.ips)
    setLoading(false)
  }, [api])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchData() }, [fetchData])

  const handleBlock = async () => {
    const res = await api('/api/admin/security/blocklist', {
      method: 'POST',
      body: JSON.stringify({ ip: newIp, reason: ipReason || undefined }),
    })
    const d = await res.json()
    if (d.success) {
      setBlocklist([...blocklist, newIp])
      setNewIp(''); setIpReason('')
      toast.success(`IP ${newIp} blocked`)
    } else toast.error('Failed to block IP', d.error)
  }

  const handleUnblock = async (ip: string) => {
    const res = await api('/api/admin/security/blocklist', {
      method: 'DELETE',
      body: JSON.stringify({ ip }),
    })
    const d = await res.json()
    if (d.success) {
      setBlocklist(blocklist.filter(i => i !== ip))
      toast.success(`IP ${ip} unblocked`)
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Injection Attempts (7d)" value={data.summary.injectionAttempts} icon={<ShieldLockIcon className="w-4 h-4" />} />
        <GlassStatCard label="Auth Failures (7d)" value={data.summary.authFailures} icon={<XCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Rate Limit Hits (7d)" value={data.summary.rateLimitHits} icon={<ZapIcon className="w-4 h-4" />} />
        <GlassStatCard label="Blocked IPs" value={blocklist.length} icon={<EyeIcon className="w-4 h-4" />} />
      </div>

      {/* IP Blocklist */}
      {userRole === 'admin' && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">IP Blocklist</h3>
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <GlassInput placeholder="IP address (e.g., 192.168.1.1)" value={newIp} onChange={(e) => setNewIp(e.target.value)} className="flex-1" />
            <GlassInput placeholder="Reason (optional)" value={ipReason} onChange={(e) => setIpReason(e.target.value)} className="flex-1" />
            <PremiumButton variant="danger" onClick={handleBlock} disabled={!newIp} icon={<ShieldLockIcon className="w-4 h-4" />}>Block</PremiumButton>
          </div>
          {blocklist.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No blocked IPs.</p> : (
            <div className="space-y-2">
              {blocklist.map(ip => (
                <div key={ip} className="flex items-center justify-between p-2 rounded-lg bg-red-500/5 border border-red-500/10">
                  <code className="font-mono text-xs text-red-300">{ip}</code>
                  <PremiumButton variant="ghost" size="sm" onClick={() => handleUnblock(ip)} icon={<XCircleIcon className="w-3 h-3" />}>Unblock</PremiumButton>
                </div>
              ))}
            </div>
          )}
        </GlassSurface>
      )}

      {/* Suspicious IPs */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Suspicious IPs (auto-detected)</h3>
        {data.suspiciousIps.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No suspicious activity detected.</p> : (
          <div className="space-y-2">
            {data.suspiciousIps.map((ip:any, i:number) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <code className="font-mono text-slate-300">{ip.ip}</code>
                <div className="flex items-center gap-2">
                  {ip.failures > 0 && <GlassBadge variant="error">{ip.failures} failures</GlassBadge>}
                  {ip.injections > 0 && <GlassBadge variant="error">{ip.injections} injections</GlassBadge>}
                  <span className="text-slate-500">{new Date(ip.lastSeen).toLocaleDateString()}</span>
                  {userRole === 'admin' && <PremiumButton variant="danger" size="sm" onClick={() => { setNewIp(ip.ip.includes('...') ? '' : ip.ip); toast.info('IP copied to blocklist field') }} icon={<ShieldLockIcon className="w-3 h-3" />}>Block</PremiumButton>}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>

      {/* Security event feed */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Security Event Feed</h3>
        <ScrollArea className="h-64 pr-3">
          {data.recentEvents.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No security events.</p> : (
            <div className="space-y-2">
              {data.recentEvents.map((e:any) => (
                <div key={e.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center justify-between mb-1">
                    <GlassBadge variant={e.eventType.includes('injection')||e.eventType.includes('failure')?'error':'default'}>{e.eventType}</GlassBadge>
                    <span className="text-[10px] text-slate-500">{new Date(e.timestamp).toLocaleString()}</span>
                  </div>
                  <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto">{JSON.stringify(e.payload, null, 2)}</pre>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </GlassSurface>
    </div>
  )
}

// === TEMPLATES ===
function TemplatesTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<any>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    const res = await api(`/api/admin/templates?search=${encodeURIComponent(search)}&limit=100`)
    const data = await res.json()
    if (data.success) setTemplates(data.templates)
    setLoading(false)
  }, [api, search])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchTemplates() }, [fetchTemplates])

  const viewDetail = async (id: string) => {
    const res = await api(`/api/admin/templates/${id}`)
    const data = await res.json()
    if (data.success) setDetail(data.template)
    else toast.error('Failed to load template', data.error)
  }

  const handlePurge = async () => {
    if (!detail) return
    const res = await api(`/api/admin/templates/${detail.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) {
      toast.success('Template purged', 'GDPR Art. 17 — crypto-erasure complete')
      setDetail(null)
      setShowDeleteDialog(false)
      fetchTemplates()
    } else toast.error('Purge failed', data.error)
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex gap-2 mb-3">
          <GlassInput placeholder="Search by user ID..." value={search} onChange={(e) => setSearch(e.target.value)} className="flex-1" />
          <PremiumButton variant="ghost" size="sm" onClick={fetchTemplates} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Search</PremiumButton>
        </div>
        {loading ? <div className="flex justify-center py-8"><PremiumSpinner /></div> : templates.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No templates found.</p>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {templates.map((t) => (
              <div key={t.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <FingerprintIcon className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-sm font-medium text-slate-200">{t.externalUserId}</span>
                    <GlassBadge variant="info">{t.modelVersion}</GlassBadge>
                    <GlassBadge variant="default">{t.variant}</GlassBadge>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                    <span>commitment: {t.commitment}</span>
                    <span>norm: {t.norm.toFixed(4)}</span>
                    <span>created: {new Date(t.createdAt).toLocaleDateString()}</span>
                    {t.lastUsedAt && <span>last used: {new Date(t.lastUsedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                <PremiumButton variant="ghost" size="sm" onClick={() => viewDetail(t.id)} icon={<EyeIcon className="w-3 h-3" />}>View</PremiumButton>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>

      {/* Detail dialog */}
      <PremiumDialog open={!!detail} onClose={() => setDetail(null)} title="Template Detail" size="md">
        {detail && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-slate-500">User:</span> <span className="text-slate-200">{detail.user.externalUserId}</span></div>
              <div><span className="text-slate-500">Model:</span> <span className="text-slate-200">{detail.modelVersion}</span></div>
              <div><span className="text-slate-500">Variant:</span> <span className="text-slate-200">{detail.variant}</span></div>
              <div><span className="text-slate-500">Norm:</span> <span className="text-slate-200 font-mono">{detail.norm.toFixed(6)}</span></div>
              <div><span className="text-slate-500">Created:</span> <span className="text-slate-200">{new Date(detail.createdAt).toLocaleString()}</span></div>
              <div><span className="text-slate-500">Last Used:</span> <span className="text-slate-200">{detail.lastUsedAt ? new Date(detail.lastUsedAt).toLocaleString() : 'Never'}</span></div>
            </div>
            <div>
              <span className="text-slate-500">Commitment (BLAKE3):</span>
              <pre className="mt-1 p-2 bg-slate-950/50 rounded text-[10px] font-mono text-emerald-300 break-all">{detail.commitment}</pre>
            </div>
            {userRole === 'admin' && (
              <PremiumButton variant="danger" onClick={() => setShowDeleteDialog(true)} icon={<TrashIcon className="w-4 h-4" />}>Purge Template (GDPR Art. 17)</PremiumButton>
            )}
          </div>
        )}
      </PremiumDialog>

      {/* Delete confirmation */}
      <PremiumDialog open={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} title="Confirm Purge" size="sm">
        <div className="space-y-3">
          <PremiumAlert variant="warning" title="Irreversible Action">
            This will permanently delete the biometric template and schedule KMS DEK destruction. The user will need to re-enroll.
          </PremiumAlert>
          <div className="flex gap-2 justify-end">
            <PremiumButton variant="ghost" onClick={() => setShowDeleteDialog(false)}>Cancel</PremiumButton>
            <PremiumButton variant="danger" onClick={handlePurge} icon={<TrashIcon className="w-4 h-4" />}>Confirm Purge</PremiumButton>
          </div>
        </div>
      </PremiumDialog>
    </div>
  )
}

// === ANALYTICS === (same as before, omitted for space — already working)
function AnalyticsTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/analytics', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setData(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load analytics.</p>

  const maxLiveness = Math.max(...Object.values(data.livenessDistribution) as number[], 1)

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Authentication Funnel (30 days)</h3>
        <div className="space-y-2">
          {[
            { label: 'Sessions Initiated', value: data.funnel.initiated, color: 'bg-slate-500' },
            { label: 'Auth Succeeded', value: data.funnel.succeeded, color: 'bg-emerald-500' },
            { label: 'Auth Failed', value: data.funnel.failed, color: 'bg-red-500' },
          ].map((step) => {
            const max = data.funnel.initiated || 1
            const pct = (step.value / max) * 100
            return (
              <div key={step.label} className="flex items-center gap-3">
                <span className="text-xs text-slate-400 w-32">{step.label}</span>
                <div className="flex-1 h-6 bg-white/[0.03] rounded-lg overflow-hidden">
                  <div className={`h-full ${step.color} rounded-lg flex items-center px-2`} style={{ width: `${Math.max(pct, 2)}%` }}>
                    <span className="text-[10px] text-white font-mono">{step.value}</span>
                  </div>
                </div>
              </div>
            )
          })}
          <div className="text-xs text-slate-500 mt-2">Conversion rate: <span className="text-emerald-400 font-mono">{data.funnel.conversionRate}%</span></div>
        </div>
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Liveness Score Distribution</h3>
        <div className="flex items-end gap-2 h-32">
          {Object.entries(data.livenessDistribution).map(([range, count]) => {
            const heightPct = ((count as number) / maxLiveness) * 100
            return (
              <div key={range} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[10px] text-slate-400 font-mono">{count as number}</span>
                <div className="w-full bg-gradient-to-t from-emerald-500/40 to-cyan-400/60 rounded-t" style={{ height: `${Math.max(heightPct, 2)}%` }} />
                <span className="text-[8px] text-slate-600">{range}</span>
              </div>
            )
          })}
        </div>
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Top IPs by Auth Count ({data.totalUniqueIps} unique)</h3>
        {data.topIps.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No auth data yet.</p> : (
          <div className="space-y-1">
            {data.topIps.map((ip:any, i:number) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded bg-white/[0.02]">
                <code className="font-mono text-slate-400">{ip.ip}</code>
                <GlassBadge variant="default">{ip.count} auths</GlassBadge>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === TEAM ===
function TeamTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    const res = await api('/api/admin/team')
    const data = await res.json()
    if (data.success) setMembers(data.members)
    setLoading(false)
  }, [api])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchMembers() }, [fetchMembers])

  const handleInvite = async () => {
    const res = await api('/api/admin/team', { method: 'POST', body: JSON.stringify({ email: inviteEmail, name: inviteName, role: 'user' }) })
    const data = await res.json()
    if (data.success) {
      setTempPassword(data.tempPassword); setInviteEmail(''); setInviteName('')
      toast.success('Team member invited'); fetchMembers()
    } else toast.error('Invite failed', data.error)
  }

  const handleRemove = async (id: string) => {
    const res = await api(`/api/admin/team/${id}`, { method: 'DELETE' })
    const data = await res.json()
    if (data.success) { toast.success('Member removed'); fetchMembers() }
    else toast.error('Failed to remove', data.error)
  }

  const handleRoleChange = async (id: string, role: string) => {
    const res = await api(`/api/admin/team/${id}`, { method: 'PUT', body: JSON.stringify({ role }) })
    const data = await res.json()
    if (data.success) { toast.success(`Role changed to ${role}`); fetchMembers() }
    else toast.error('Failed to change role', data.error)
  }

  return (
    <div className="space-y-4">
      {userRole === 'admin' && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Invite Team Member</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <GlassInput placeholder="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className="flex-1" />
            <GlassInput placeholder="Name (optional)" value={inviteName} onChange={(e) => setInviteName(e.target.value)} className="flex-1" />
            <PremiumButton onClick={handleInvite} disabled={!inviteEmail} icon={<UserPlusIcon className="w-4 h-4" />}>Invite</PremiumButton>
          </div>
          {tempPassword && (
            <PremiumAlert variant="success" title="Member Invited" dismissible onDismiss={() => setTempPassword(null)}>
              <p className="text-[10px] mb-1">Temporary password (communicate securely):</p>
              <code className="font-mono text-[10px] text-emerald-300 break-all">{tempPassword}</code>
            </PremiumAlert>
          )}
        </GlassSurface>
      )}

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">Team Members ({members.length})</h3>
          <PremiumButton variant="ghost" size="sm" onClick={fetchMembers} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Refresh</PremiumButton>
        </div>
        {loading ? <div className="flex justify-center py-8"><PremiumSpinner /></div> : (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 flex items-center justify-center text-xs font-medium text-emerald-300">
                    {m.email[0]?.toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-200">{m.name || m.email}</span>
                      <GlassBadge variant={m.role === 'admin' ? 'success' : 'default'}>{m.role}</GlassBadge>
                      {m.isCurrentUser && <GlassBadge variant="info">You</GlassBadge>}
                    </div>
                    <span className="text-[10px] text-slate-500">{m.email}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-slate-500 hidden sm:inline">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleDateString() : 'Never'}</span>
                  {userRole === 'admin' && !m.isCurrentUser && (
                    <>
                      {m.role === 'user' ? (
                        <PremiumButton variant="ghost" size="sm" onClick={() => handleRoleChange(m.id, 'admin')}>Promote</PremiumButton>
                      ) : (
                        <PremiumButton variant="ghost" size="sm" onClick={() => handleRoleChange(m.id, 'user')}>Demote</PremiumButton>
                      )}
                      <PremiumButton variant="danger" size="sm" onClick={() => handleRemove(m.id)} icon={<TrashIcon className="w-3 h-3" />}>Remove</PremiumButton>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === INTEGRATIONS === (same as before)
function IntegrationsTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">OIDC / OAuth 2.0</h3>
        <div className="space-y-2 text-xs">
          {[
            ['Discovery URL', '/.well-known/openid-configuration'],
            ['Authorize', '/oauth/authorize'],
            ['Token', '/oauth/token'],
            ['UserInfo', '/userinfo'],
          ].map(([label, path]) => (
            <div key={label} className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
              <span className="text-slate-400">{label}</span>
              <code className="font-mono text-slate-300 text-[10px]">{path}</code>
            </div>
          ))}
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Signing Algorithm</span>
            <GlassBadge variant="success">EdDSA</GlassBadge>
          </div>
        </div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">SDK Integration</h3>
        <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto">{`import { useFaceAuth } from '@veriface/edge-sdk'

const { authenticate, status } = useFaceAuth({
  tenantId: '${tenantId}',
  apiKey: 'vf_live_...',
})
await authenticate('user_123')`}</pre>
      </GlassSurface>

      {/* SAML SSO Configuration */}
      <SamlConfigModule tenantId={tenantId} userRole={userRole} />
    </div>
  )
}

// === COMPLIANCE ===
function ComplianceTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [dsrs, setDsrs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newDsrUser, setNewDsrUser] = useState('')
  const [newDsrType, setNewDsrType] = useState<'access'|'erasure'|'portability'|'objection'>('access')
  const [newDsrNotes, setNewDsrNotes] = useState('')
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  const fetchDsrs = useCallback(async () => {
    setLoading(true)
    const res = await api('/api/admin/compliance/dsr')
    const data = await res.json()
    if (data.success) setDsrs(data.dsrs)
    setLoading(false)
  }, [api])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchDsrs() }, [fetchDsrs])

  const handleCreateDsr = async () => {
    const res = await api('/api/admin/compliance/dsr', {
      method: 'POST',
      body: JSON.stringify({ externalUserId: newDsrUser, requestType: newDsrType, notes: newDsrNotes || undefined }),
    })
    const data = await res.json()
    if (data.success) {
      toast.success(data.message, data.receipt ? `Receipt: ${data.receipt.slice(0,24)}...` : undefined)
      setNewDsrUser(''); setNewDsrNotes('')
      fetchDsrs()
    } else toast.error('Failed to create DSR', data.error)
  }

  const handleResolveDsr = async (dsrId: string, status: 'resolved'|'rejected') => {
    const res = await api('/api/admin/compliance/dsr', {
      method: 'PUT',
      body: JSON.stringify({ dsrId, status }),
    })
    const data = await res.json()
    if (data.success) { toast.success(`DSR ${status}`); fetchDsrs() }
    else toast.error('Failed to resolve', data.error)
  }

  return (
    <div className="space-y-4">
      {/* GDPR Status */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">GDPR Compliance Status</h3>
        <div className="space-y-2">
          {[
            { article: 'Art. 7 — Consent', desc: 'Consent recording + enrollment enforcement' },
            { article: 'Art. 17 — Right to be Forgotten', desc: 'Crypto-erasure with KMS DEK destruction' },
            { article: 'Art. 20 — Data Portability', desc: 'JSON export of all user data' },
            { article: 'Art. 25 — Privacy by Design', desc: 'Edge-only computation, no raw images' },
            { article: 'Art. 32 — Security of Processing', desc: 'AES-256-GCM + per-tenant keys' },
          ].map((item) => (
            <div key={item.article} className="flex items-start gap-3 p-2 rounded-lg bg-white/[0.02]">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div><p className="text-xs font-medium text-slate-200">{item.article}</p><p className="text-[10px] text-slate-500">{item.desc}</p></div>
            </div>
          ))}
        </div>
      </GlassSurface>

      {/* Create DSR */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Create Data Subject Request</h3>
        <div className="space-y-2">
          <GlassInput placeholder="External User ID" value={newDsrUser} onChange={(e) => setNewDsrUser(e.target.value)} />
          <div className="flex gap-2">
            <select value={newDsrType} onChange={(e) => setNewDsrType(e.target.value as any)} className="px-3 py-2 rounded-lg bg-slate-950 border border-white/[0.08] text-xs text-slate-200">
              <option value="access">Access (Art. 15)</option>
              <option value="erasure">Erasure (Art. 17)</option>
              <option value="portability">Portability (Art. 20)</option>
              <option value="objection">Objection (Art. 21)</option>
            </select>
            <GlassInput placeholder="Notes (optional)" value={newDsrNotes} onChange={(e) => setNewDsrNotes(e.target.value)} className="flex-1" />
            <PremiumButton onClick={handleCreateDsr} disabled={!newDsrUser}>Submit</PremiumButton>
          </div>
        </div>
      </GlassSurface>

      {/* DSR Queue */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">DSR Queue ({dsrs.length})</h3>
          <PremiumButton variant="ghost" size="sm" onClick={fetchDsrs} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Refresh</PremiumButton>
        </div>
        {loading ? <div className="flex justify-center py-8"><PremiumSpinner /></div> : dsrs.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No data subject requests.</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {dsrs.map((dsr) => (
              <div key={dsr.id} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <GlassBadge variant={
                      dsr.requestType === 'erasure' ? 'error' :
                      dsr.requestType === 'access' ? 'info' : 'default'
                    }>{dsr.requestType}</GlassBadge>
                    <GlassBadge variant={
                      dsr.status === 'resolved' ? 'success' :
                      dsr.status === 'rejected' ? 'error' : 'warning'
                    }>{dsr.status}</GlassBadge>
                  </div>
                  <span className="text-[10px] text-slate-500">{new Date(dsr.createdAt).toLocaleString()}</span>
                </div>
                <div className="text-xs text-slate-300">User: <code className="font-mono">{dsr.externalUserId}</code></div>
                {dsr.notes && <div className="text-[10px] text-slate-500 mt-1">Notes: {dsr.notes}</div>}
                {dsr.resolution && <div className="text-[10px] text-emerald-400 mt-1">Resolution: {dsr.resolution}</div>}
                {userRole === 'admin' && dsr.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <PremiumButton variant="ghost" size="sm" onClick={() => handleResolveDsr(dsr.id, 'resolved')}>Resolve</PremiumButton>
                    <PremiumButton variant="ghost" size="sm" onClick={() => handleResolveDsr(dsr.id, 'rejected')}>Reject</PremiumButton>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === DEVELOPER CONSOLE ===
function DeveloperTab({ tenantId }: { tenantId: string }) {
  const [method, setMethod] = useState('GET')
  const [path, setPath] = useState('/api/health')
  const [reqBody, setReqBody] = useState('')
  const [response, setResponse] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const { toast } = usePremiumToast()

  const handleTest = async () => {
    setLoading(true); setResponse(null)
    try {
      const res = await fetch('/api/admin/test-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ method, path, body: method === 'POST' && reqBody ? JSON.parse(reqBody) : undefined }),
      })
      const data = await res.json()
      if (data.success) { setResponse(data.result); toast.success(`${data.result.status} (${data.result.durationMs}ms)`) }
      else { toast.error('Request failed', data.error); setResponse({ error: data.error }) }
    } catch { toast.error('Parse error in request body') }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">API Request Tester</h3>
        <div className="flex gap-2 mb-3">
          <select value={method} onChange={(e) => setMethod(e.target.value)} className="px-3 py-2 rounded-lg bg-slate-950 border border-white/[0.08] text-xs text-slate-200">
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <GlassInput placeholder="/api/..." value={path} onChange={(e) => setPath(e.target.value)} className="flex-1" />
          <PremiumButton onClick={handleTest} loading={loading} icon={<ZapIcon className="w-4 h-4" />}>Send</PremiumButton>
        </div>
        {method === 'POST' && (
          <GlassInput label="Request Body (JSON)" placeholder='{"flow":"authenticate"}' value={reqBody} onChange={(e) => setReqBody(e.target.value)} />
        )}
      </GlassSurface>

      {response && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-slate-200">Response</h3>
            <div className="flex items-center gap-2">
              <GlassBadge variant={response.status < 300 ? 'success' : 'error'}>{response.status} {response.statusText}</GlassBadge>
              <GlassBadge variant="default">{response.durationMs}ms</GlassBadge>
            </div>
          </div>
          <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">
            {JSON.stringify(response.body ?? response.error, null, 2)}
          </pre>
        </GlassSurface>
      )}

      {/* Quick links */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Quick Test Endpoints</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { label: 'Health Check', method: 'GET', path: '/api/health' },
            { label: 'List API Keys', method: 'GET', path: '/api/api-keys/list' },
            { label: 'Query Audit Log', method: 'GET', path: '/api/audit?limit=5' },
            { label: 'Verify Chain', method: 'GET', path: '/api/verify-audit' },
            { label: 'OIDC Discovery', method: 'GET', path: '/.well-known/openid-configuration' },
            { label: 'Usage Summary', method: 'GET', path: '/api/admin/usage' },
          ].map((ep) => (
            <button key={ep.label} onClick={() => { setMethod(ep.method); setPath(ep.path) }}
              className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] hover:bg-white/[0.05] text-left transition-colors">
              <GlassBadge variant={ep.method === 'GET' ? 'info' : 'success'}>{ep.method}</GlassBadge>
              <span className="text-xs text-slate-300">{ep.label}</span>
            </button>
          ))}
        </div>
      </GlassSurface>
    </div>
  )
}

// === SETTINGS ===
function SettingsTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [settings, setSettings] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [liveness, setLiveness] = useState('0.78')
  const [rateLimit, setRateLimit] = useState('60')
  const [sessionAge, setSessionAge] = useState('60')
  const [webhookUrl, setWebhookUrl] = useState('')
  const { toast } = usePremiumToast()
  const api = useAdminApi(tenantId)

  useEffect(() => {
    api('/api/admin/settings').then(r => r.json()).then(d => {
      if (d.success && d.settings) {
        setSettings(d.settings)
        setLiveness(String(d.settings.livenessThreshold ?? 0.78))
        setRateLimit(String(d.settings.rateLimitPerMin ?? 60))
        setSessionAge(String(d.settings.maxSessionAgeSec ?? 60))
        setWebhookUrl(d.settings.webhookUrl ?? '')
      }
    }).finally(() => setLoading(false))
  }, [tenantId, api])

  const handleSave = async () => {
    setSaving(true)
    try {
      const updates: any = {}
      if (parseFloat(liveness) !== settings?.livenessThreshold) updates.livenessThreshold = parseFloat(liveness)
      if (parseInt(rateLimit) !== settings?.rateLimitPerMin) updates.rateLimitPerMin = parseInt(rateLimit)
      if (parseInt(sessionAge) !== settings?.maxSessionAgeSec) updates.maxSessionAgeSec = parseInt(sessionAge)
      if (webhookUrl !== (settings?.webhookUrl ?? '')) updates.webhookUrl = webhookUrl || null

      if (Object.keys(updates).length === 0) { toast.info('No changes to save'); return }

      const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(updates) })
      const data = await res.json()
      if (data.success) { toast.success('Settings saved'); setSettings({ ...settings, ...data.settings }) }
      else toast.error('Failed to save', data.error)
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const res = await api('/api/tenant/rotate-signing-key', { method: 'POST', body: JSON.stringify({ confirm: true }) })
      const data = await res.json()
      if (data.success) toast.success('Signing key rotated', 'Old key is immediately invalid')
      else toast.error('Rotation failed', data.error)
    } catch { toast.error('Rotation failed') }
    finally { setRotating(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      {/* Tenant info */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Tenant Info</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Tenant ID</p><code className="text-[10px] font-mono text-slate-500">{tenantId}</code></div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Name</p><p className="text-[10px] text-slate-500">{settings?.name ?? '—'}</p></div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Signing Algorithm</p><p className="text-[10px] text-slate-500">Ed25519 (EdDSA)</p></div>
            <LockIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Signing Public Key</p><code className="text-[10px] font-mono text-slate-500 break-all">{settings?.signingPubKey?.slice(0, 32)}...</code></div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Encryption</p><p className="text-[10px] text-slate-500">AES-256-GCM + HKDF-SHA256</p></div>
            <LockIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">KMS Key ID</p><code className="text-[10px] font-mono text-slate-500">{settings?.kmsKeyId ?? '—'}</code></div>
          </div>
        </div>
      </GlassSurface>

      {/* Configurable settings */}
      {userRole === 'admin' && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-slate-200 mb-3">Configuration</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <GlassInput label="Liveness Threshold (0.1–1.0)" type="number" step="0.01" min="0.1" max="1.0" value={liveness} onChange={(e) => setLiveness(e.target.value)} />
            <GlassInput label="Rate Limit (auths/min)" type="number" min="1" max="1000" value={rateLimit} onChange={(e) => setRateLimit(e.target.value)} />
            <GlassInput label="Session Timeout (seconds)" type="number" min="10" max="3600" value={sessionAge} onChange={(e) => setSessionAge(e.target.value)} />
            <GlassInput label="Webhook URL (HTTPS)" type="url" placeholder="https://..." value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
          </div>
          <div className="mt-3">
            <PremiumButton onClick={handleSave} loading={saving} icon={<CheckCircleIcon className="w-4 h-4" />}>Save Settings</PremiumButton>
          </div>
        </GlassSurface>
      )}

      {/* Danger Zone */}
      {userRole === 'admin' && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h3 className="text-sm font-medium text-red-300 mb-3">Danger Zone</h3>
          <div className="flex items-center justify-between p-3 rounded-lg border border-red-500/20 bg-red-500/5">
            <div><p className="text-xs font-medium text-red-300">Rotate Signing Key</p><p className="text-[10px] text-red-400/70">All in-flight JWTs become invalid immediately.</p></div>
            <PremiumButton variant="danger" size="sm" onClick={handleRotateKey} loading={rotating} icon={<RefreshIcon className="w-3 h-3" />}>Rotate</PremiumButton>
          </div>
        </GlassSurface>
      )}
    </div>
  )
}
