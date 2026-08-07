'use client'

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassTabs, GlassStatCard, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import {
  ShieldLockIcon, KeyIcon, RadioIcon, ActivityIcon, UserPlusIcon, TrashIcon,
  RefreshIcon, CheckCircleIcon, XCircleIcon, DownloadIcon, SettingsIcon, LockIcon,
  CpuIcon, ZapIcon, FingerprintIcon, EyeIcon, PulseIcon,
} from '@/components/brand/Icons'
import { AuthPage } from '@/components/auth/AuthPage'
import { ScrollArea } from '@/components/ui/scroll-area'

type AdminTab = 'dashboard' | 'usage' | 'security' | 'templates' | 'analytics' | 'team' | 'integrations' | 'compliance' | 'developer' | 'settings'

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

  const tabs = [
    { id: 'dashboard' as AdminTab, label: 'Dashboard', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'usage' as AdminTab, label: 'Usage & Billing', icon: <ZapIcon className="w-3.5 h-3.5" /> },
    { id: 'security' as AdminTab, label: 'Security', icon: <ShieldLockIcon className="w-3.5 h-3.5" /> },
    { id: 'templates' as AdminTab, label: 'Templates', icon: <FingerprintIcon className="w-3.5 h-3.5" /> },
    { id: 'analytics' as AdminTab, label: 'Analytics', icon: <PulseIcon className="w-3.5 h-3.5" /> },
    { id: 'team' as AdminTab, label: 'Team', icon: <UserPlusIcon className="w-3.5 h-3.5" /> },
    { id: 'integrations' as AdminTab, label: 'Integrations', icon: <CpuIcon className="w-3.5 h-3.5" /> },
    { id: 'compliance' as AdminTab, label: 'Compliance', icon: <CheckCircleIcon className="w-3.5 h-3.5" /> },
    { id: 'developer' as AdminTab, label: 'Developer', icon: <KeyIcon className="w-3.5 h-3.5" /> },
    { id: 'settings' as AdminTab, label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Admin Panel</h1>
          <p className="text-xs text-slate-500 mt-0.5">Signed in as <span className="text-slate-400">{user.email}</span> · <GlassBadge variant={user.role === 'admin' ? 'success' : 'default'}>{user.role}</GlassBadge></p>
        </div>
        <div className="flex items-center gap-2">
          <PremiumButton variant="ghost" size="sm" onClick={handleLogout} icon={<LockIcon className="w-3.5 h-3.5" />}><span className="hidden sm:inline">Logout</span></PremiumButton>
        </div>
      </div>

      {/* Tab bar — scrollable on mobile */}
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

      {/* Content */}
      {tab === 'dashboard' && <DashboardTab tenantId={user.tenantId} />}
      {tab === 'usage' && <UsageTab tenantId={user.tenantId} />}
      {tab === 'security' && <SecurityTab tenantId={user.tenantId} />}
      {tab === 'templates' && <TemplatesTab tenantId={user.tenantId} />}
      {tab === 'analytics' && <AnalyticsTab tenantId={user.tenantId} />}
      {tab === 'team' && <TeamTab tenantId={user.tenantId} userRole={user.role} />}
      {tab === 'integrations' && <IntegrationsTab tenantId={user.tenantId} />}
      {tab === 'compliance' && <ComplianceTab tenantId={user.tenantId} />}
      {tab === 'developer' && <DeveloperTab tenantId={user.tenantId} />}
      {tab === 'settings' && <SettingsTab tenantId={user.tenantId} />}
    </div>
  )
}

// === DASHBOARD ===
function DashboardTab({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState({ auths: 0, enrollments: 0, failures: 0, rateLimits: 0 })
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/audit?limit=10', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => {
        if (d.success) {
          setRecent(d.entries)
          setStats({
            auths: d.entries.filter((e:any)=>e.eventType==='auth.success').length,
            enrollments: d.entries.filter((e:any)=>e.eventType==='enroll.success').length,
            failures: d.entries.filter((e:any)=>e.eventType==='auth.failure').length,
            rateLimits: d.entries.filter((e:any)=>e.eventType==='rate_limit.exceeded').length,
          })
        }
      }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Auth Success" value={stats.auths} icon={<CheckCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Enrollments" value={stats.enrollments} icon={<UserPlusIcon className="w-4 h-4" />} />
        <GlassStatCard label="Auth Failures" value={stats.failures} icon={<XCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Rate Limited" value={stats.rateLimits} icon={<ShieldLockIcon className="w-4 h-4" />} />
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
function UsageTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/usage', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setData(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load usage data.</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Billable Auths (30d)" value={data.summary.authSuccess + data.summary.enrollments} icon={<ZapIcon className="w-4 h-4" />} />
        <GlassStatCard label="Est. Cost (30d)" value={`$${data.summary.estimatedCost}`} icon={<ZapIcon className="w-4 h-4" />} />
        <GlassStatCard label="Price/Auth" value={`$${data.summary.pricePerAuth}`} />
        <GlassStatCard label="Enrolled Users" value={data.summary.enrolledUsers} icon={<UserPlusIcon className="w-4 h-4" />} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <GlassStatCard label="Active API Keys" value={data.summary.activeKeys} icon={<KeyIcon className="w-4 h-4" />} />
        <GlassStatCard label="Injection Attempts (30d)" value={data.summary.injections} icon={<ShieldLockIcon className="w-4 h-4" />} />
      </div>

      {/* Daily chart */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Daily Activity (14 days)</h3>
        <div className="flex items-end gap-1 h-32">
          {data.daily.slice(-14).map((d:any, i:number) => {
            const max = Math.max(...data.daily.map((x:any) => x.auths + x.enrollments + x.failures), 1)
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
    </div>
  )
}

// === SECURITY CENTER ===
function SecurityTab({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/security', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setData(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load security data.</p>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Injection Attempts (7d)" value={data.summary.injectionAttempts} icon={<ShieldLockIcon className="w-4 h-4" />} />
        <GlassStatCard label="Auth Failures (7d)" value={data.summary.authFailures} icon={<XCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Rate Limit Hits (7d)" value={data.summary.rateLimitHits} icon={<ZapIcon className="w-4 h-4" />} />
        <GlassStatCard label="Suspicious IPs" value={data.summary.suspiciousIpCount} icon={<EyeIcon className="w-4 h-4" />} />
      </div>

      {/* Suspicious IPs */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Suspicious IPs</h3>
        {data.suspiciousIps.length === 0 ? <p className="text-xs text-slate-500 text-center py-4">No suspicious activity detected.</p> : (
          <div className="space-y-2">
            {data.suspiciousIps.map((ip:any, i:number) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <code className="font-mono text-slate-300">{ip.ip}</code>
                <div className="flex items-center gap-3">
                  {ip.failures > 0 && <GlassBadge variant="error">{ip.failures} failures</GlassBadge>}
                  {ip.injections > 0 && <GlassBadge variant="error">{ip.injections} injections</GlassBadge>}
                  <span className="text-slate-500">{new Date(ip.lastSeen).toLocaleDateString()}</span>
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
function TemplatesTab({ tenantId }: { tenantId: string }) {
  const [templates, setTemplates] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const { toast } = usePremiumToast()

  const fetchTemplates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/templates?search=${encodeURIComponent(search)}&limit=100`, { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setTemplates(data.templates)
    } catch { toast.error('Failed to fetch templates') }
    finally { setLoading(false) }
  }, [tenantId, search, toast])

  useEffect(() => { fetchTemplates() }, [fetchTemplates])

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
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === ANALYTICS ===
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
      {/* Auth funnel */}
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

      {/* Liveness distribution */}
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

      {/* Top IPs */}
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

// === TEAM & ACCESS CONTROL ===
function TeamTab({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [members, setMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [tempPassword, setTempPassword] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  const fetchMembers = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/team', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setMembers(data.members)
    } catch { toast.error('Failed to fetch team') }
    finally { setLoading(false) }
  }, [tenantId, toast])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  const handleInvite = async () => {
    if (!inviteEmail) return
    try {
      const res = await fetch('/api/admin/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ email: inviteEmail, name: inviteName, role: 'user' }),
      })
      const data = await res.json()
      if (data.success) {
        setTempPassword(data.tempPassword)
        setInviteEmail(''); setInviteName('')
        toast.success('Team member invited')
        fetchMembers()
      } else { toast.error('Invite failed', data.error) }
    } catch { toast.error('Invite failed') }
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
          <h3 className="text-sm font-medium text-slate-200">Team Members</h3>
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
                <div className="text-[10px] text-slate-500">
                  {m.lastLoginAt ? `Last seen: ${new Date(m.lastLoginAt).toLocaleDateString()}` : 'Never logged in'}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// === INTEGRATIONS ===
function IntegrationsTab({ tenantId }: { tenantId: string }) {
  return (
    <div className="space-y-4">
      {/* OIDC */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">OIDC / OAuth 2.0</h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Discovery URL</span>
            <code className="font-mono text-slate-300 text-[10px]">/.well-known/openid-configuration</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Authorize</span>
            <code className="font-mono text-slate-300 text-[10px]">/oauth/authorize</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Token</span>
            <code className="font-mono text-slate-300 text-[10px]">/oauth/token</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">UserInfo</span>
            <code className="font-mono text-slate-300 text-[10px]">/userinfo</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Signing Algorithm</span>
            <GlassBadge variant="success">EdDSA</GlassBadge>
          </div>
        </div>
      </GlassSurface>

      {/* WebAuthn */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">FIDO2 / WebAuthn</h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Register Begin</span>
            <code className="font-mono text-slate-300 text-[10px]">/api/webauthn/register/begin</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">Auth Begin</span>
            <code className="font-mono text-slate-300 text-[10px]">/api/webauthn/auth/begin</code>
          </div>
          <div className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
            <span className="text-slate-400">User Verification</span>
            <GlassBadge variant="success">Required</GlassBadge>
          </div>
        </div>
      </GlassSurface>

      {/* Webhooks */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Webhooks</h3>
        <p className="text-xs text-slate-500 mb-2">Configure in the Webhooks tab. All events are HMAC-SHA256 signed.</p>
        <div className="space-y-1">
          {['enroll.success', 'auth.success', 'auth.failure', 'template.revoked', 'key.rotated'].map(e => (
            <div key={e} className="flex items-center gap-2 p-1.5 rounded bg-white/[0.02]">
              <RadioIcon className="w-3 h-3 text-cyan-400" /><code className="font-mono text-[10px] text-slate-400">{e}</code>
            </div>
          ))}
        </div>
      </GlassSurface>

      {/* SDK */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">SDK Integration</h3>
        <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto">{`import { useFaceAuth } from '@veriface/edge-sdk'

const { authenticate, status } = useFaceAuth({
  tenantId: '${tenantId}',
  apiKey: 'vf_live_...',
})
await authenticate('user_123')`}</pre>
      </GlassSurface>
    </div>
  )
}

// === COMPLIANCE ===
function ComplianceTab({ tenantId }: { tenantId: string }) {
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">GDPR Compliance Status</h3>
        <div className="space-y-2">
          {[
            { article: 'Art. 7 — Consent', status: 'Active', desc: 'Consent recording endpoint + enrollment enforcement' },
            { article: 'Art. 17 — Right to be Forgotten', status: 'Active', desc: 'Crypto-erasure with KMS DEK destruction' },
            { article: 'Art. 20 — Data Portability', status: 'Active', desc: 'JSON export of all user data' },
            { article: 'Art. 25 — Privacy by Design', status: 'Active', desc: 'Edge-only computation, no raw images on server' },
            { article: 'Art. 32 — Security of Processing', status: 'Active', desc: 'AES-256-GCM + per-tenant keys + Ed25519' },
          ].map((item) => (
            <div key={item.article} className="flex items-start gap-3 p-2 rounded-lg bg-white/[0.02]">
              <CheckCircleIcon className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-xs font-medium text-slate-200">{item.article}</p>
                <p className="text-[10px] text-slate-500">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Certifications & Standards</h3>
        <div className="space-y-2">
          {[
            { name: 'ISO/IEC 30107-3 (PAD)', status: 'Architecture Ready' },
            { name: 'BIPA Compliance', status: 'No face geometry stored' },
            { name: 'EU AI Act (Annex III)', status: 'Conformity assessment ready' },
            { name: 'SOC 2 Type II', status: 'In progress' },
            { name: 'PSD2 SCA', status: 'amr: [face], acr: eidas:substantial' },
          ].map((item) => (
            <div key={item.name} className="flex items-center justify-between p-2 rounded bg-white/[0.02]">
              <span className="text-xs text-slate-300">{item.name}</span>
              <GlassBadge variant="info">{item.status}</GlassBadge>
            </div>
          ))}
        </div>
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
        body: JSON.stringify({
          method, path,
          body: method === 'POST' && reqBody ? JSON.parse(reqBody) : undefined,
        }),
      })
      const data = await res.json()
      if (data.success) { setResponse(data.result); toast.success(`Response: ${data.result.status} (${data.result.durationMs}ms)`) }
      else { toast.error('Request failed', data.error); setResponse({ error: data.error }) }
    } catch (e) { toast.error('Parse error in request body') }
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
          <GlassInput label="Request Body (JSON)" placeholder='{"flow":"authenticate"}' value={reqBody} onChange={(e) => setReqBody(e.target.value)} className="font-mono" />
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
    </div>
  )
}

// === SETTINGS ===
function SettingsTab({ tenantId }: { tenantId: string }) {
  const [rotating, setRotating] = useState(false)
  const { toast } = usePremiumToast()

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const res = await fetch('/api/tenant/rotate-signing-key', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId }, body: JSON.stringify({ confirm: true }) })
      const data = await res.json()
      if (data.success) toast.success('Signing key rotated')
      else toast.error('Rotation failed', data.error)
    } catch { toast.error('Rotation failed') }
    finally { setRotating(false) }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-slate-200">Tenant Settings</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]"><div><p className="text-xs font-medium text-slate-300">Tenant ID</p><code className="text-[10px] font-mono text-slate-500">{tenantId}</code></div></div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]"><div><p className="text-xs font-medium text-slate-300">Signing Algorithm</p><p className="text-[10px] text-slate-500">Ed25519 (EdDSA)</p></div><LockIcon className="w-4 h-4 text-emerald-400" /></div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]"><div><p className="text-xs font-medium text-slate-300">Encryption</p><p className="text-[10px] text-slate-500">AES-256-GCM + HKDF-SHA256</p></div><LockIcon className="w-4 h-4 text-emerald-400" /></div>
        </div>
        <div className="border-t border-white/[0.06] pt-4">
          <h4 className="text-xs font-medium text-slate-300 mb-2">Danger Zone</h4>
          <div className="flex items-center justify-between p-3 rounded-lg border border-red-500/20 bg-red-500/5">
            <div><p className="text-xs font-medium text-red-300">Rotate Signing Key</p><p className="text-[10px] text-red-400/70">All in-flight JWTs become invalid immediately.</p></div>
            <PremiumButton variant="danger" size="sm" onClick={handleRotateKey} loading={rotating} icon={<RefreshIcon className="w-3 h-3" />}>Rotate</PremiumButton>
          </div>
        </div>
      </GlassSurface>
    </div>
  )
}
