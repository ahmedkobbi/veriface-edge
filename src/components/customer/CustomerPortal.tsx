'use client'

/**
 * VeriFace Edge — Customer Portal
 * 6 modules: Dashboard, Security, Biometric Profile, Privacy, Account, Notifications
 */

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassStatCard, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, PremiumDialog, usePremiumToast } from '@/components/premium/Premium'
import {
  ShieldLockIcon, FingerprintIcon, ActivityIcon, LockIcon, KeyIcon,
  CheckCircleIcon, XCircleIcon, DownloadIcon, TrashIcon, RefreshIcon,
  ZapIcon, EyeIcon, RadioIcon, CpuIcon, SettingsIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'

type CustomerTab = 'dashboard' | 'security' | 'profile' | 'privacy' | 'account' | 'notifications'

export function CustomerPortal({ tenantId, userEmail }: { tenantId: string; userEmail: string }) {
  const [tab, setTab] = useState<CustomerTab>('dashboard')
  const tabs: Array<{id: CustomerTab; label: string; icon: React.ReactNode}> = [
    { id: 'dashboard', label: 'Dashboard', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'security', label: 'Security', icon: <ShieldLockIcon className="w-3.5 h-3.5" /> },
    { id: 'profile', label: 'Biometric Profile', icon: <FingerprintIcon className="w-3.5 h-3.5" /> },
    { id: 'privacy', label: 'Privacy & Data', icon: <LockIcon className="w-3.5 h-3.5" /> },
    { id: 'account', label: 'Account', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
    { id: 'notifications', label: 'Notifications', icon: <RadioIcon className="w-3.5 h-3.5" /> },
  ]
  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      <div><h1 className="text-xl font-bold text-slate-100">My Account</h1><p className="text-xs text-slate-500 mt-0.5">Manage your biometric data, privacy, and security.</p></div>
      <div className="overflow-x-auto -mx-4 px-4 pb-2">
        <div className="inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1 min-w-max">
          {tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${tab === t.id ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}>{t.icon}{t.label}</button>)}
        </div>
      </div>
      {tab === 'dashboard' && <Dashboard tenantId={tenantId} />}
      {tab === 'security' && <Security tenantId={tenantId} />}
      {tab === 'profile' && <Profile tenantId={tenantId} />}
      {tab === 'privacy' && <Privacy tenantId={tenantId} />}
      {tab === 'account' && <Account tenantId={tenantId} userEmail={userEmail} />}
      {tab === 'notifications' && <Notifications tenantId={tenantId} />}
    </div>
  )
}

function Dashboard({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/customer/auth-history', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()).then(d => { if (d.success) setData(d) }).finally(() => setLoading(false)) }, [tenantId])
  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>
  return (
    <div className="space-y-4">
      {!data.enrolled && <PremiumAlert variant="info" title="No biometric template enrolled">Use the Live Demo tab to enroll.</PremiumAlert>}
      {data.enrolled && data.template && <PremiumAlert variant="success" title="Template Active">Enrolled: {new Date(data.template.enrolledAt).toLocaleDateString()} · Last used: {data.template.lastUsedAt ? new Date(data.template.lastUsedAt).toLocaleDateString() : 'Never'}</PremiumAlert>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassStatCard label="Security Score" value={`${data.summary.securityScore}/100`} icon={<ShieldLockIcon className="w-4 h-4" />} />
        <GlassStatCard label="Auths (30d)" value={data.summary.totalAuths} icon={<ActivityIcon className="w-4 h-4" />} />
        <GlassStatCard label="Success Rate" value={`${data.summary.successRate}%`} icon={<CheckCircleIcon className="w-4 h-4" />} />
        <GlassStatCard label="Failures" value={data.summary.failureCount} icon={<XCircleIcon className="w-4 h-4" />} />
      </div>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Recent Activity</h3>
        {data.history.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No activity in 30 days.</p> : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {data.history.slice(0, 20).map((h: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-2">{h.eventType === 'auth.success' ? <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> : <XCircleIcon className="w-3.5 h-3.5 text-red-400" />}<GlassBadge variant={h.eventType.includes('success') ? 'success' : 'error'}>{h.eventType.replace('auth.', '')}</GlassBadge>{h.livenessScore && <span className="text-[10px] text-slate-500">{(h.livenessScore * 100).toFixed(0)}%</span>}</div>
                <div className="flex items-center gap-2 text-slate-500">{h.ip && <code className="font-mono text-[10px]">{h.ip.slice(0, 8)}...</code>}<span>{new Date(h.timestamp).toLocaleString()}</span></div>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

function Security({ tenantId }: { tenantId: string }) {
  const [sessions, setSessions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => { fetch('/api/customer/sessions', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()).then(d => { if (d.success) setSessions(d.sessions) }).finally(() => setLoading(false)) }, [tenantId])
  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Active Sessions (7 days)</h3>
        {sessions.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No recent sessions.</p> : (
          <div className="space-y-2">{sessions.map((s, i) => (
            <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex items-center gap-3"><div className="w-8 h-8 rounded-lg bg-cyan-500/10 flex items-center justify-center"><CpuIcon className="w-4 h-4 text-cyan-400" /></div><div><code className="font-mono text-xs text-slate-300">{s.ip}</code><p className="text-[10px] text-slate-500">Last: {new Date(s.lastSeen).toLocaleString()}</p></div></div>
              <div className="flex items-center gap-2">{s.authCount > 0 && <GlassBadge variant="success">{s.authCount} auths</GlassBadge>}{s.failures > 0 && <GlassBadge variant="error">{s.failures} fails</GlassBadge>}</div>
            </div>
          ))}</div>
        )}
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Security Tips</h3>
        <div className="space-y-2 text-xs text-slate-400">
          <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02]"><ShieldLockIcon className="w-3.5 h-3.5 text-emerald-400 mt-0.5" /><span>Your biometric data never leaves your browser.</span></div>
          <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02]"><LockIcon className="w-3.5 h-3.5 text-cyan-400 mt-0.5" /><span>All API calls are AES-256-GCM encrypted.</span></div>
          <div className="flex items-start gap-2 p-2 rounded bg-white/[0.02]"><EyeIcon className="w-3.5 h-3.5 text-amber-400 mt-0.5" /><span>See unfamiliar IPs? Change your password immediately.</span></div>
        </div>
      </GlassSurface>
    </div>
  )
}

function Profile({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { toast } = usePremiumToast()
  const fetchProfile = useCallback(async () => { setLoading(true); const res = await fetch('/api/customer/profile', { headers: { 'X-Tenant-Id': tenantId } }); const d = await res.json(); if (d.success) setData(d); setLoading(false) }, [tenantId])
  useEffect(() => { fetchProfile() }, [fetchProfile])
  const handleDelete = async () => { setDeleting(true); try { const res = await fetch('/api/customer/profile', { method: 'DELETE', headers: { 'X-Tenant-Id': tenantId } }); const d = await res.json(); if (d.success) { toast.success('Template deleted'); setShowDelete(false); fetchProfile() } else toast.error('Failed', d.error) } catch { toast.error('Failed') } finally { setDeleting(false) } }
  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Biometric Profile</h3>
        {!data?.enrolled ? (
          <div className="text-center py-8"><FingerprintIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" /><p className="text-sm text-slate-400">Not enrolled</p><p className="text-xs text-slate-500 mt-1">Use Live Demo to enroll.</p></div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10"><CheckCircleIcon className="w-5 h-5 text-emerald-400" /><div><p className="text-sm font-medium text-emerald-300">Active</p><p className="text-[10px] text-slate-500">Enrolled: {new Date(data.profile.enrolledAt).toLocaleString()}</p></div></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-2 rounded bg-white/[0.02]"><p className="text-[10px] text-slate-500">Model</p><p className="text-xs text-slate-200 font-mono">{data.profile.modelVersion}</p></div>
              <div className="p-2 rounded bg-white/[0.02]"><p className="text-[10px] text-slate-500">Last Used</p><p className="text-xs text-slate-200">{data.profile.lastUsedAt ? new Date(data.profile.lastUsedAt).toLocaleString() : 'Never'}</p></div>
            </div>
            {data.consentHistory?.length > 0 && (<div><p className="text-[10px] text-slate-500 mb-1">Consent History</p><div className="space-y-1">{data.consentHistory.map((c: any, i: number) => (<div key={i} className="flex items-center justify-between text-[10px] p-1.5 rounded bg-white/[0.02]"><span className="text-slate-400">{c.purpose}</span><div className="flex items-center gap-2"><GlassBadge variant={c.granted ? 'success' : 'error'}>{c.granted ? 'Granted' : 'Withdrawn'}</GlassBadge><span className="text-slate-500">{new Date(c.timestamp).toLocaleDateString()}</span></div></div>))}</div></div>)}
            <div className="border-t border-white/[0.06] pt-3"><PremiumButton variant="danger" onClick={() => setShowDelete(true)} icon={<TrashIcon className="w-4 h-4" />}>Delete Template</PremiumButton></div>
          </div>
        )}
      </GlassSurface>
      <PremiumDialog open={showDelete} onClose={() => setShowDelete(false)} title="Delete Biometric Data" size="sm">
        <div className="space-y-3"><PremiumAlert variant="warning" title="Irreversible">Permanently deletes your template. Re-enrollment required to use face auth again.</PremiumAlert>
        <div className="flex gap-2 justify-end"><PremiumButton variant="ghost" onClick={() => setShowDelete(false)}>Cancel</PremiumButton><PremiumButton variant="danger" onClick={handleDelete} loading={deleting} icon={<TrashIcon className="w-4 h-4" />}>Confirm</PremiumButton></div></div>
      </PremiumDialog>
    </div>
  )
}

function Privacy({ tenantId }: { tenantId: string }) {
  const [exporting, setExporting] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { toast } = usePremiumToast()
  const handleExport = async () => { setExporting(true); try { const res = await fetch('/api/customer/privacy', { headers: { 'X-Tenant-Id': tenantId } }); const data = await res.json(); if (data.success) { const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `my-data-${Date.now()}.json`; a.click(); URL.revokeObjectURL(url); toast.success('Data exported') } } catch { toast.error('Export failed') } finally { setExporting(false) } }
  const handleDeleteAll = async () => { setDeleting(true); try { const res = await fetch('/api/customer/privacy', { method: 'DELETE', headers: { 'X-Tenant-Id': tenantId } }); const data = await res.json(); if (data.success) { toast.success('All data deleted'); setShowDelete(false) } else toast.error('Failed', data.error) } catch { toast.error('Failed') } finally { setDeleting(false) } }
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Your Data Rights (GDPR)</h3>
        <div className="space-y-2">
          {[{a:'Art. 15 — Access',d:'View all data we hold',act:'Export',fn:handleExport,ic:<DownloadIcon className="w-4 h-4" />,ld:exporting},{a:'Art. 17 — Erasure',d:'Delete all biometric data',act:'Delete All',fn:()=>setShowDelete(true),ic:<TrashIcon className="w-4 h-4" />,dn:true},{a:'Art. 20 — Portability',d:'Download as JSON',act:'Export',fn:handleExport,ic:<DownloadIcon className="w-4 h-4" />,ld:exporting},{a:'Art. 21 — Object',d:'Object to processing',act:'Object',fn:()=>setShowDelete(true),ic:<XCircleIcon className="w-4 h-4" />,dn:true}].map(r => (
            <div key={r.a} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex-1"><p className="text-xs font-medium text-slate-200">{r.a}</p><p className="text-[10px] text-slate-500">{r.d}</p></div>
              <PremiumButton variant={r.dn?'danger':'outline'} size="sm" onClick={r.fn} loading={r.ld} icon={r.ic}>{r.act}</PremiumButton>
            </div>
          ))}
        </div>
      </GlassSurface>
      <PremiumDialog open={showDelete} onClose={() => setShowDelete(false)} title="Delete All Data" size="sm">
        <div className="space-y-3"><PremiumAlert variant="error" title="Irreversible">Deletes: biometric template, WebAuthn credentials, consent records. Audit log retained (anonymized) for 7 years.</PremiumAlert>
        <div className="flex gap-2 justify-end"><PremiumButton variant="ghost" onClick={() => setShowDelete(false)}>Cancel</PremiumButton><PremiumButton variant="danger" onClick={handleDeleteAll} loading={deleting} icon={<TrashIcon className="w-4 h-4" />}>Delete Everything</PremiumButton></div></div>
      </PremiumDialog>
    </div>
  )
}

function Account({ tenantId, userEmail }: { tenantId: string; userEmail: string }) {
  const [curPw, setCurPw] = useState(''); const [newPw, setNewPw] = useState(''); const [name, setName] = useState('')
  const [savePw, setSavePw] = useState(false); const [saveName, setSaveName] = useState(false)
  const [showDel, setShowDel] = useState(false); const [deleting, setDeleting] = useState(false)
  const { toast } = usePremiumToast(); const H = { 'X-Tenant-Id': tenantId }
  const handlePw = async () => { setSavePw(true); try { const r = await fetch('/api/customer/account', { method:'PUT', headers:{'Content-Type':'application/json',...H}, body: JSON.stringify({action:'change_password',currentPassword:curPw,newPassword:newPw}) }); const d = await r.json(); if (d.success) { toast.success('Password updated'); setCurPw(''); setNewPw('') } else toast.error('Failed', d.error) } catch { toast.error('Failed') } finally { setSavePw(false) } }
  const handleName = async () => { setSaveName(true); try { const r = await fetch('/api/customer/account', { method:'PUT', headers:{'Content-Type':'application/json',...H}, body: JSON.stringify({action:'update_name',name}) }); const d = await r.json(); if (d.success) { toast.success('Name updated') } else { toast.error('Failed') } } catch { toast.error('Failed') } finally { setSaveName(false) } }
  const handleDel = async () => { setDeleting(true); try { const r = await fetch('/api/customer/account', { method:'DELETE', headers:H }); const d = await r.json(); if (d.success) { toast.success('Account deleted'); window.location.reload() } else toast.error('Failed') } catch { toast.error('Failed') } finally { setDeleting(false) } }
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Account Info</h3>
        <div className="space-y-2"><div className="flex items-center justify-between p-2 rounded bg-white/[0.02]"><span className="text-xs text-slate-400">Email</span><code className="text-xs font-mono text-slate-200">{userEmail}</code></div></div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Change Password</h3>
        <div className="space-y-3"><GlassInput label="Current Password" type="password" value={curPw} onChange={e=>setCurPw(e.target.value)} /><GlassInput label="New Password (8+, Aa1)" type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} /><PremiumButton onClick={handlePw} loading={savePw} disabled={!curPw||!newPw} icon={<LockIcon className="w-4 h-4" />}>Update</PremiumButton></div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Display Name</h3>
        <div className="flex gap-2"><GlassInput placeholder="Name" value={name} onChange={e=>setName(e.target.value)} className="flex-1" /><PremiumButton onClick={handleName} loading={saveName} disabled={!name}>Save</PremiumButton></div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-red-300 mb-3">Danger Zone</h3>
        <div className="flex items-center justify-between p-3 rounded-lg border border-red-500/20 bg-red-500/5"><div><p className="text-xs font-medium text-red-300">Delete Account</p><p className="text-[10px] text-red-400/70">Permanently delete everything.</p></div><PremiumButton variant="danger" size="sm" onClick={()=>setShowDel(true)} icon={<TrashIcon className="w-3 h-3" />}>Delete</PremiumButton></div>
      </GlassSurface>
      <PremiumDialog open={showDel} onClose={()=>setShowDel(false)} title="Delete Account" size="sm">
        <div className="space-y-3"><PremiumAlert variant="error" title="Cannot be undone">Account, biometric data, consent, WebAuthn — all deleted.</PremiumAlert>
        <div className="flex gap-2 justify-end"><PremiumButton variant="ghost" onClick={()=>setShowDel(false)}>Cancel</PremiumButton><PremiumButton variant="danger" onClick={handleDel} loading={deleting} icon={<TrashIcon className="w-4 h-4" />}>Delete Account</PremiumButton></div></div>
      </PremiumDialog>
    </div>
  )
}

function Notifications({ tenantId }: { tenantId: string }) {
  const [prefs, setPrefs] = useState<any>(null); const [notifs, setNotifs] = useState<any[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast(); const H = { 'X-Tenant-Id': tenantId }
  const fetchN = useCallback(async () => { setLoading(true); const r = await fetch('/api/customer/notifications', { headers: H }); const d = await r.json(); if (d.success) { setPrefs(d.preferences); setNotifs(d.notifications) } setLoading(false) }, [tenantId])
  useEffect(() => { fetchN() }, [fetchN])
  const toggle = async (k: string, v: boolean) => { setSaving(true); try { const r = await fetch('/api/customer/notifications', { method:'PUT', headers:{'Content-Type':'application/json',...H}, body: JSON.stringify({[k]:v}) }); const d = await r.json(); if (d.success) setPrefs(d.preferences) } catch { toast.error('Failed') } finally { setSaving(false) } }
  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!prefs) return <p className="text-xs text-slate-500 text-center py-8">Failed to load.</p>
  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Preferences</h3>
        <div className="space-y-2">{[{k:'authAlerts',l:'Auth Alerts',d:'Success/failure notifications'},{k:'securityAlerts',l:'Security Alerts',d:'Injections, rate limits, suspicious IPs'},{k:'billingAlerts',l:'Billing Alerts',d:'Spending thresholds'},{k:'productUpdates',l:'Product Updates',d:'New features'}].map(p => (
          <div key={p.k} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
            <div><p className="text-xs font-medium text-slate-200">{p.l}</p><p className="text-[10px] text-slate-500">{p.d}</p></div>
            <button onClick={()=>toggle(p.k, !prefs[p.k])} disabled={saving} className={`relative w-11 h-6 rounded-full transition-colors ${prefs[p.k]?'bg-emerald-500':'bg-slate-700'}`}><div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${prefs[p.k]?'translate-x-5':''}`} /></button>
          </div>
        ))}</div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-medium text-slate-200">Recent</h3><GlassBadge variant="default">{notifs.length}</GlassBadge></div>
        {notifs.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No notifications.</p> : (
          <ScrollArea className="h-64 pr-3"><div className="space-y-2">{notifs.map(n => (
            <div key={n.id} className="flex items-start gap-2 p-2 rounded-lg bg-white/[0.02]">
              {n.type==='security'?<ShieldLockIcon className="w-3.5 h-3.5 text-red-400 mt-0.5" />:n.type==='billing'?<ZapIcon className="w-3.5 h-3.5 text-amber-400 mt-0.5" />:<CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400 mt-0.5" />}
              <div className="flex-1"><p className="text-xs text-slate-300">{n.message}</p><p className="text-[10px] text-slate-500">{new Date(n.timestamp).toLocaleString()}</p></div>
            </div>
          ))}</div></ScrollArea>
        )}
      </GlassSurface>
    </div>
  )
}
