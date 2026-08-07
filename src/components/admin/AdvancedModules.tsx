'use client'

/**
 * VeriFace Edge — Advanced Admin Modules
 *
 * 5 new modules beyond the basic 10:
 *   1. Fraud Score Engine — composite risk score with per-signal breakdown
 *   2. Access Policies — geo/time restrictions, velocity limits
 *   3. Webhook Delivery Log — delivery history with retry details
 *   4. Branding — custom SDK theming per tenant
 *   5. Embed Code Generator — copy-paste SDK integration snippet
 *
 * Plus a public Status Page component.
 */

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import {
  ShieldLockIcon, ZapIcon, RadioIcon, CheckCircleIcon, XCircleIcon,
  RefreshIcon, CopyIcon, EyeIcon, ActivityIcon, LockIcon,
  CpuIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'

// === FRAUD SCORE ===
export function FraudScoreModule({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/fraud-score', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setData(d) }).finally(() => setLoading(false))
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>

  const scoreColor = data.fraudScore >= 80 ? 'text-emerald-400' : data.fraudScore >= 60 ? 'text-amber-400' : data.fraudScore >= 40 ? 'text-orange-400' : 'text-red-400'
  const ringColor = data.fraudScore >= 80 ? '#10b981' : data.fraudScore >= 60 ? '#f59e0b' : data.fraudScore >= 40 ? '#f97316' : '#ef4444'

  return (
    <div className="space-y-4">
      {/* Score gauge */}
      <GlassSurface blur="xl" opacity="heavy" glow className="rounded-2xl p-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h3 className="text-sm font-medium text-slate-200 mb-1">Fraud Risk Score</h3>
            <div className={`text-5xl font-bold ${scoreColor}`}>{data.fraudScore}</div>
            <div className="text-xs text-slate-500 mt-1">Risk Level: <span className={`font-medium ${scoreColor}`}>{data.riskLevel}</span></div>
          </div>
          <div className="relative w-24 h-24">
            <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="8" />
              <circle cx="50" cy="50" r="40" fill="none" stroke={ringColor} strokeWidth="8"
                strokeDasharray={`${(data.fraudScore / 100) * 251.2} 251.2`} strokeLinecap="round" />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className={`text-lg font-bold ${scoreColor}`}>{data.fraudScore}</span>
            </div>
          </div>
        </div>
        <PremiumAlert variant={data.riskLevel === 'critical' || data.riskLevel === 'high' ? 'warning' : 'info'}>
          {data.recommendation}
        </PremiumAlert>
      </GlassSurface>

      {/* Signal breakdown */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Signal Breakdown</h3>
        <div className="space-y-3">
          {data.signals.map((signal: any) => (
            <div key={signal.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">{signal.name}</span>
                  <span className="text-[10px] text-slate-600">weight: {signal.weight}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`font-mono ${signal.score >= 80 ? 'text-emerald-400' : signal.score >= 60 ? 'text-amber-400' : signal.score >= 40 ? 'text-orange-400' : 'text-red-400'}`}>
                    {signal.score.toFixed(0)}
                  </span>
                  <span className="text-slate-500 text-[10px]">{signal.detail}</span>
                </div>
              </div>
              <div className="h-1.5 bg-white/[0.03] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${signal.score >= 80 ? 'bg-emerald-500' : signal.score >= 60 ? 'bg-amber-500' : signal.score >= 40 ? 'bg-orange-500' : 'bg-red-500'}`}
                  style={{ width: `${signal.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </GlassSurface>
    </div>
  )
}

// === ACCESS POLICIES ===
export function AccessPoliciesModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [policy, setPolicy] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  useEffect(() => {
    fetch('/api/admin/access-policies', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setPolicy(d.policy) }).finally(() => setLoading(false))
  }, [tenantId])

  const update = async (field: string, value: any) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/access-policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await res.json()
      if (data.success) { setPolicy(data.policy); toast.success('Policy updated') }
    } catch { toast.error('Failed to update') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!policy) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>

  return (
    <div className="space-y-4">
      {/* Time window */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <svg className="w-4 h-4 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7 V12 L15 14" strokeLinecap="round"/></svg>
          <h3 className="text-sm font-medium text-slate-200">Time-Based Access Window</h3>
        </div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-slate-400">Restrict authentication to specific hours</span>
          <button
            onClick={() => update('timeWindowEnabled', !policy.timeWindowEnabled)}
            disabled={userRole !== 'admin' || saving}
            className={`relative w-11 h-6 rounded-full transition-colors ${policy.timeWindowEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${policy.timeWindowEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {policy.timeWindowEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <GlassInput label="Start (HH:MM)" type="time" value={policy.timeWindowStart} onChange={(e) => update('timeWindowStart', e.target.value)} disabled={userRole !== 'admin'} />
            <GlassInput label="End (HH:MM)" type="time" value={policy.timeWindowEnd} onChange={(e) => update('timeWindowEnd', e.target.value)} disabled={userRole !== 'admin'} />
          </div>
        )}
      </GlassSurface>

      {/* Velocity limits */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ZapIcon className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-medium text-slate-200">Velocity Limits</h3>
        </div>
        <GlassInput
          label="Max auths per user per day (0 = unlimited)"
          type="number"
          min="0"
          value={String(policy.maxAuthsPerUserPerDay)}
          onChange={(e) => update('maxAuthsPerUserPerDay', parseInt(e.target.value) || 0)}
          disabled={userRole !== 'admin'}
        />
      </GlassSurface>

      {/* Security toggles */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldLockIcon className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-medium text-slate-200">Security Requirements</h3>
        </div>
        <div className="space-y-2">
          {[
            { key: 'requireHardwareAttestation', label: 'Require Hardware Attestation', desc: 'Block browsers without WebAuthn platform authenticator' },
            { key: 'blockVpn', label: 'Block VPN/Proxy IPs', desc: 'Reject requests from known VPN and proxy services' },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div>
                <p className="text-xs font-medium text-slate-200">{item.label}</p>
                <p className="text-[10px] text-slate-500">{item.desc}</p>
              </div>
              <button
                onClick={() => update(item.key, !policy[item.key])}
                disabled={userRole !== 'admin' || saving}
                className={`relative w-11 h-6 rounded-full transition-colors ${policy[item.key] ? 'bg-emerald-500' : 'bg-slate-700'}`}
              >
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${policy[item.key] ? 'translate-x-5' : ''}`} />
              </button>
            </div>
          ))}
        </div>
      </GlassSurface>

      {/* Geo policies */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <GlobeIcon className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-medium text-slate-200">Geographic Policies</h3>
        </div>
        <p className="text-xs text-slate-500 mb-3">Block or allow authentication by country (requires GeoIP database in production).</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-slate-500 mb-1">Allowed Countries (empty = all)</p>
            <div className="flex flex-wrap gap-1 min-h-[32px] p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              {policy.geoAllowlist.length === 0 ? <span className="text-[10px] text-slate-600">All countries</span> :
                policy.geoAllowlist.map((c: string) => <GlassBadge key={c} variant="success">{c}</GlassBadge>)}
            </div>
          </div>
          <div>
            <p className="text-[10px] text-slate-500 mb-1">Blocked Countries</p>
            <div className="flex flex-wrap gap-1 min-h-[32px] p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              {policy.geoDenylist.length === 0 ? <span className="text-[10px] text-slate-600">None</span> :
                policy.geoDenylist.map((c: string) => <GlassBadge key={c} variant="error">{c}</GlassBadge>)}
            </div>
          </div>
        </div>
      </GlassSurface>
    </div>
  )
}

// === WEBHOOK DELIVERY LOG ===
export function WebhookDeliveryModule({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')

  const fetchDeliveries = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/admin/webhook-deliveries?limit=100${filter ? `&state=${filter}` : ''}`, { headers: { 'X-Tenant-Id': tenantId } })
    const d = await res.json()
    if (d.success) setData(d)
    setLoading(false)
  }, [tenantId, filter])
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchDeliveries() }, [fetchDeliveries])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Delivered', value: data.stats.delivered, color: 'text-emerald-400' },
          { label: 'Pending', value: data.stats.pending, color: 'text-amber-400' },
          { label: 'Failed', value: data.stats.failed, color: 'text-orange-400' },
          { label: 'Dead Lettered', value: data.stats.deadLettered, color: 'text-red-400' },
        ].map(s => (
          <GlassSurface key={s.label} blur="md" opacity="light" className="rounded-xl p-3 text-center">
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-slate-500">{s.label}</p>
          </GlassSurface>
        ))}
      </div>

      {/* Filter + refresh */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {['', 'delivered', 'pending', 'failed', 'dead_letter'].map(s => (
            <button key={s || 'all'} onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-lg text-xs transition-all ${filter === s ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-500 hover:text-slate-300'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <PremiumButton variant="ghost" size="sm" onClick={fetchDeliveries} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Refresh</PremiumButton>
      </div>

      {/* Delivery log */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <ScrollArea className="h-80 pr-3">
          {data.deliveries.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No deliveries yet.</p> : (
            <div className="space-y-2">
              {data.deliveries.map((d: any) => (
                <div key={d.id} className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <GlassBadge variant={
                        d.state === 'delivered' ? 'success' :
                        d.state === 'pending' ? 'warning' :
                        d.state === 'dead_letter' ? 'error' : 'default'
                      }>{d.state}</GlassBadge>
                      <code className="text-[10px] font-mono text-slate-400">{d.eventType}</code>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      {d.lastResponseCode && <span>HTTP {d.lastResponseCode}</span>}
                      <span>{d.attempts} attempts</span>
                      <span>{d.age}s ago</span>
                    </div>
                  </div>
                  {d.lastError && <p className="text-[10px] text-red-400/70">{d.lastError}</p>}
                  {d.nextRetryAt && d.state === 'pending' && <p className="text-[10px] text-amber-400/70">Next retry: {new Date(d.nextRetryAt).toLocaleString()}</p>}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </GlassSurface>
    </div>
  )
}

// === BRANDING ===
export function BrandingModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [branding, setBranding] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()

  useEffect(() => {
    fetch('/api/admin/branding', { headers: { 'X-Tenant-Id': tenantId } })
      .then(r => r.json()).then(d => { if (d.success) setBranding(d.branding) }).finally(() => setLoading(false))
  }, [tenantId])

  const update = async (field: string, value: any) => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ [field]: value }),
      })
      const data = await res.json()
      if (data.success) { setBranding(data.branding); toast.success('Branding updated') }
    } catch { toast.error('Failed') }
    finally { setSaving(false) }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!branding) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">SDK Branding</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GlassInput label="Company Name" value={branding.companyName} onChange={(e) => update('companyName', e.target.value)} disabled={userRole !== 'admin' || saving} />
          <GlassInput label="Logo URL (HTTPS)" type="url" placeholder="https://..." value={branding.logoUrl ?? ''} onChange={(e) => update('logoUrl', e.target.value || null)} disabled={userRole !== 'admin' || saving} />
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Primary Color</label>
            <div className="flex gap-2">
              <input type="color" value={branding.primaryColor} onChange={(e) => update('primaryColor', e.target.value)} disabled={userRole !== 'admin' || saving}
                className="w-12 h-10 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer" />
              <input type="text" value={branding.primaryColor} onChange={(e) => update('primaryColor', e.target.value)} disabled={userRole !== 'admin' || saving}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/[0.08] text-xs text-slate-200 font-mono" />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Accent Color</label>
            <div className="flex gap-2">
              <input type="color" value={branding.accentColor} onChange={(e) => update('accentColor', e.target.value)} disabled={userRole !== 'admin' || saving}
                className="w-12 h-10 rounded-lg border border-white/[0.08] bg-transparent cursor-pointer" />
              <input type="text" value={branding.accentColor} onChange={(e) => update('accentColor', e.target.value)} disabled={userRole !== 'admin' || saving}
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-white/[0.08] text-xs text-slate-200 font-mono" />
            </div>
          </div>
          <GlassInput label="Privacy Policy URL" type="url" placeholder="https://..." value={branding.privacyPolicyUrl ?? ''} onChange={(e) => update('privacyPolicyUrl', e.target.value || null)} disabled={userRole !== 'admin' || saving} />
          <GlassInput label="Terms of Service URL" type="url" placeholder="https://..." value={branding.termsUrl ?? ''} onChange={(e) => update('termsUrl', e.target.value || null)} disabled={userRole !== 'admin' || saving} />
        </div>
      </GlassSurface>

      {/* Live preview */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Live Preview</h3>
        <div className="rounded-xl p-4 bg-slate-950/50 border border-white/[0.04]" style={{ '--vf-primary': branding.primaryColor, '--vf-accent': branding.accentColor } as any}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})` }}>
              <LockIcon className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-100">{branding.companyName}</span>
          </div>
          <div className="space-y-2">
            <div className="h-2 rounded-full" style={{ background: `linear-gradient(90deg, ${branding.primaryColor}, ${branding.accentColor})`, width: '60%' }} />
            <div className="h-2 rounded-full bg-white/5" style={{ width: '40%' }} />
            <div className="h-2 rounded-full bg-white/5" style={{ width: '80%' }} />
          </div>
          <div className="mt-3">
            <button className="px-4 py-2 rounded-lg text-xs font-medium text-white" style={{ background: `linear-gradient(135deg, ${branding.primaryColor}, ${branding.accentColor})` }}>
              Authenticate with Face
            </button>
          </div>
        </div>
      </GlassSurface>
    </div>
  )
}

// === EMBED CODE GENERATOR ===
export function EmbedCodeModule({ tenantId }: { tenantId: string }) {
  const [copied, setCopied] = useState(false)
  const { toast } = usePremiumToast()

  const embedCode = `<!-- VeriFace Edge SDK -->
<script type="module" src="https://cdn.veriface.io/v1/veriface.js"></script>

<face-auth
  tenant-id="${tenantId}"
  api-key="vf_live_YOUR_API_KEY"
  flow="authenticate"
  theme="auto"
></face-auth>

<script>
  const el = document.querySelector('face-auth');
  el.addEventListener('veriface:success', (e) => {
    console.log('Auth token:', e.detail.token);
    // Send token to your backend for verification
    fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: e.detail.token }),
    });
  });
  el.addEventListener('veriface:failure', (e) => {
    console.warn('Auth failed:', e.detail.code);
  });
</script>`

  const reactCode = `import { useFaceAuth } from '@veriface/edge-sdk'

function LoginPage() {
  const { authenticate, status, liveness, error } = useFaceAuth({
    tenantId: '${tenantId}',
    apiKey: 'vf_live_YOUR_API_KEY',
    livenessThreshold: 0.78,
    captureDurationMs: 1800,
  })

  return (
    <button onClick={() => authenticate('user_123')}>
      {status === 'capturing' ? 'Scanning...' : 'Sign in with Face'}
    </button>
  )
}`

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success(`${label} copied to clipboard`)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">HTML Web Component</h3>
          <PremiumButton variant="ghost" size="sm" onClick={() => copy(embedCode, 'HTML code')} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
        </div>
        <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">{embedCode}</pre>
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">React Hook</h3>
          <PremiumButton variant="ghost" size="sm" onClick={() => copy(reactCode, 'React code')} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
        </div>
        <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto max-h-64 overflow-y-auto">{reactCode}</pre>
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Backend Verification (Node.js)</h3>
        <pre className="text-[10px] font-mono text-slate-300 bg-slate-950/50 p-3 rounded-lg overflow-x-auto">{`// Verify the token issued by VeriFace
const res = await fetch('https://api.veriface.io/api/token/verify', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer vf_live_YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ token: tokenFromClient }),
});
const { valid, claims } = await res.json();
if (valid) {
  // claims.sub = user ID
  // claims.amr = ['face']
  // claims.acr = 'eidas:substantial'
  // claims.liveness_score = 0.94
  console.log('Authenticated user:', claims.sub);
}`}</pre>
      </GlassSurface>
    </div>
  )
}

// === STATUS PAGE ===
export function StatusPage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/status').then(r => r.json()).then(d => setData(d)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load status.</p>

  return (
    <div className="space-y-4">
      {/* Overall status */}
      <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-6 text-center">
        <div className={`w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center ${
          data.status === 'operational' ? 'bg-emerald-500/20' : data.status === 'degraded' ? 'bg-amber-500/20' : 'bg-red-500/20'
        }`}>
          {data.status === 'operational' ? <CheckCircleIcon className="w-8 h-8 text-emerald-400" /> : <XCircleIcon className="w-8 h-8 text-amber-400" />}
        </div>
        <h2 className={`text-xl font-bold ${data.status === 'operational' ? 'text-emerald-400' : 'text-amber-400'}`}>
          {data.status === 'operational' ? 'All Systems Operational' : data.status === 'degraded' ? 'Partial Service Degradation' : 'Service Outage'}
        </h2>
        <p className="text-xs text-slate-500 mt-1">Uptime: {Math.floor(data.uptime / 3600)}h {Math.floor((data.uptime % 3600) / 60)}m</p>
      </GlassSurface>

      {/* Component status */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Component Status</h3>
        <div className="space-y-2">
          {data.components.map((c: any) => (
            <div key={c.name} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${c.status === 'operational' ? 'bg-emerald-400' : c.status === 'degraded' ? 'bg-amber-400' : 'bg-red-400'}`} />
                <span className="text-xs text-slate-300">{c.name}</span>
                {c.latencyMs && <span className="text-[10px] text-slate-600">{c.latencyMs}ms</span>}
              </div>
              <span className={`text-[10px] ${c.status === 'operational' ? 'text-emerald-400' : 'text-amber-400'}`}>{c.status}</span>
            </div>
          ))}
        </div>
      </GlassSurface>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassSurface blur="md" opacity="light" className="rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-slate-100">{data.metrics.totalTenants}</p>
          <p className="text-[10px] text-slate-500">Tenants</p>
        </GlassSurface>
        <GlassSurface blur="md" opacity="light" className="rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-slate-100">{data.metrics.totalAuths}</p>
          <p className="text-[10px] text-slate-500">Total Auths</p>
        </GlassSurface>
        <GlassSurface blur="md" opacity="light" className="rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-slate-100">{data.metrics.totalEnrollments}</p>
          <p className="text-[10px] text-slate-500">Enrollments</p>
        </GlassSurface>
        <GlassSurface blur="md" opacity="light" className="rounded-xl p-3 text-center">
          <p className="text-lg font-bold text-slate-100">{data.metrics.avgResponseTimeMs}</p>
          <p className="text-[10px] text-slate-500">Avg Response</p>
        </GlassSurface>
      </div>

      {/* SLA */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Service Level Agreement</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="p-2 rounded bg-white/[0.02]"><p className="text-[10px] text-slate-500">Uptime SLA</p><p className="text-sm text-emerald-400 font-medium">{data.sla.uptime}</p></div>
          <div className="p-2 rounded bg-white/[0.02]"><p className="text-[10px] text-slate-500">Response Time</p><p className="text-sm text-cyan-400 font-medium">{data.sla.responseTime}</p></div>
          <div className="p-2 rounded bg-white/[0.02]"><p className="text-[10px] text-slate-500">Support Response</p><p className="text-sm text-amber-400 font-medium">{data.sla.supportResponse}</p></div>
        </div>
      </GlassSurface>
    </div>
  )
}

// Globe icon (not in Icons.tsx yet)
function GlobeIcon(props: any) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12 H21" />
      <path d="M12 3 Q16 12 12 21 Q8 12 12 3" />
    </svg>
  )
}
