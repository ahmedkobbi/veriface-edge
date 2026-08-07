'use client'

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassTabs, GlassStatCard, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert } from '@/components/premium/Premium'
import {
  ShieldLockIcon,
  KeyIcon,
  RadioIcon,
  ActivityIcon,
  UserPlusIcon,
  TrashIcon,
  RefreshIcon,
  CheckCircleIcon,
  XCircleIcon,
  DownloadIcon,
  SettingsIcon,
  LockIcon,
} from '@/components/brand/Icons'
import { usePremiumToast } from '@/components/premium/Premium'
import { AuthPage } from '@/components/auth/AuthPage'

type AdminTab = 'dashboard' | 'apikeys' | 'webhooks' | 'audit' | 'users' | 'settings'

interface PlatformUser {
  id: string
  email: string
  name: string | null
  role: string
  tenantId: string | null
  emailVerified: boolean
  createdAt: Date
  lastLoginAt: Date | null
}

export function AdminPanel() {
  const [user, setUser] = useState<PlatformUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<AdminTab>('dashboard')
  const { toast } = usePremiumToast()

  // Check for existing session
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.user) {
          setUser(data.user)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setUser(null)
    toast.info('Signed out')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="flex flex-col items-center gap-3">
          <PremiumSpinner size="xl" variant="pulse" />
          <span className="text-xs text-slate-400">Loading...</span>
        </div>
      </div>
    )
  }

  // Not authenticated — show login/signup
  if (!user) {
    return <AuthPage onSuccess={(u) => {
      if (u) setUser(u)
      else {
        // After signup with API key display, re-fetch the session
        fetch('/api/auth/me').then((r) => r.json()).then((data) => {
          if (data.success) setUser(data.user)
        })
      }
    }} />
  }

  const tenantId = user.tenantId

  const tabs = [
    { id: 'dashboard' as AdminTab, label: 'Dashboard', icon: <ActivityIcon className="w-3.5 h-3.5" /> },
    { id: 'apikeys' as AdminTab, label: 'API Keys', icon: <KeyIcon className="w-3.5 h-3.5" /> },
    { id: 'webhooks' as AdminTab, label: 'Webhooks', icon: <RadioIcon className="w-3.5 h-3.5" /> },
    { id: 'audit' as AdminTab, label: 'Audit Log', icon: <ShieldLockIcon className="w-3.5 h-3.5" /> },
    { id: 'users' as AdminTab, label: 'Users', icon: <UserPlusIcon className="w-3.5 h-3.5" /> },
    { id: 'settings' as AdminTab, label: 'Settings', icon: <SettingsIcon className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="container mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-100">Admin Panel</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Signed in as <span className="text-slate-400">{user.email}</span>
            {tenantId && <> · Tenant: <code className="font-mono text-slate-400">{tenantId.slice(0, 16)}...</code></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <GlassTabs tabs={tabs} activeTab={tab} onTabChange={(t) => setTab(t as AdminTab)} />
          <PremiumButton variant="ghost" size="sm" onClick={handleLogout} icon={<LockIcon className="w-3.5 h-3.5" />}>
            <span className="hidden sm:inline">Logout</span>
          </PremiumButton>
        </div>
      </div>

      {/* Tab content */}
      {tab === 'dashboard' && tenantId && <DashboardTab tenantId={tenantId} />}
      {tab === 'apikeys' && tenantId && <ApiKeysTab tenantId={tenantId} />}
      {tab === 'webhooks' && tenantId && <WebhooksTab tenantId={tenantId} />}
      {tab === 'audit' && tenantId && <AuditTab tenantId={tenantId} />}
      {tab === 'users' && tenantId && <UsersTab tenantId={tenantId} />}
      {tab === 'settings' && tenantId && <SettingsTab tenantId={tenantId} />}
      {!tenantId && (
        <PremiumAlert variant="error" title="No tenant associated">
          Your account is not linked to a tenant. Please contact support.
        </PremiumAlert>
      )}
    </div>
  )
}

// Helper: get API key for the logged-in user's tenant
function useTenantApiKey(tenantId: string) {
  const [apiKey, setApiKey] = useState<string | null>(null)

  useEffect(() => {
    // The admin panel uses the session cookie to authenticate
    // API key endpoints also accept the session cookie
    // For simplicity, we list keys and use the most recent active one
    fetch('/api/api-keys/list', {
      headers: { 'X-Tenant-Id': tenantId },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.apiKeys?.length > 0) {
          // We don't have the plaintext — admin uses cookie auth
          setApiKey('session')
        }
      })
      .catch(() => {})
  }, [tenantId])

  return apiKey
}

// ===========================================================================
// Dashboard Tab
// ===========================================================================
function DashboardTab({ tenantId }: { tenantId: string }) {
  const [stats, setStats] = useState({ auths: 0, enrollments: 0, failures: 0, rateLimits: 0 })
  const [recentAudit, setRecentAudit] = useState<any[]>([])

  useEffect(() => {
    fetch('/api/audit?limit=5', {
      headers: { 'X-Tenant-Id': tenantId },
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setRecentAudit(data.entries)
          const auths = data.entries.filter((e: any) => e.eventType === 'auth.success').length
          const enrollments = data.entries.filter((e: any) => e.eventType === 'enroll.success').length
          const failures = data.entries.filter((e: any) => e.eventType === 'auth.failure').length
          const rateLimits = data.entries.filter((e: any) => e.eventType === 'rate_limit.exceeded').length
          setStats({ auths, enrollments, failures, rateLimits })
        }
      })
      .catch(() => {})
  }, [tenantId])

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
        {recentAudit.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No activity yet.</p>
        ) : (
          <div className="space-y-2">
            {recentAudit.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <GlassBadge variant={
                    entry.eventType.includes('success') ? 'success' :
                    entry.eventType.includes('failure') ? 'error' : 'default'
                  }>
                    {entry.eventType}
                  </GlassBadge>
                  <span className="text-slate-500 font-mono">#{entry.chainIndex}</span>
                </div>
                <span className="text-slate-500">{new Date(entry.createdAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// ===========================================================================
// API Keys Tab — uses session cookie auth
// ===========================================================================
function ApiKeysTab({ tenantId }: { tenantId: string }) {
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  const authHeaders = { 'X-Tenant-Id': tenantId }

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/api-keys/list', { headers: authHeaders })
      const data = await res.json()
      if (data.success) setKeys(data.apiKeys)
    } catch {
      toast.error('Failed to fetch API keys')
    } finally {
      setLoading(false)
    }
  }, [tenantId, toast])

  useEffect(() => { fetchKeys() }, [fetchKeys])

  const handleCreate = async () => {
    if (!newKeyLabel) return
    try {
      const res = await fetch('/api/api-keys/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ label: newKeyLabel, scopes: '*' }),
      })
      const data = await res.json()
      if (data.success) {
        setCreatedKey(data.apiKey.plaintext)
        setNewKeyLabel('')
        toast.success('API key created', 'Copy it now — it won\'t be shown again')
        fetchKeys()
      }
    } catch {
      toast.error('Failed to create API key')
    }
  }

  const handleRevoke = async (keyId: string) => {
    try {
      const res = await fetch('/api/api-keys/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ apiKeyId: keyId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('API key revoked')
        fetchKeys()
      }
    } catch {
      toast.error('Failed to revoke key')
    }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Create New API Key</h3>
        <div className="flex gap-2">
          <GlassInput placeholder="Key label (e.g., Production, Staging)" value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} className="flex-1" />
          <PremiumButton onClick={handleCreate} disabled={!newKeyLabel} icon={<KeyIcon className="w-4 h-4" />}>Create</PremiumButton>
        </div>
        {createdKey && (
          <PremiumAlert variant="success" title="API Key Created" dismissible onDismiss={() => setCreatedKey(null)}>
            <code className="font-mono text-[10px] break-all">{createdKey}</code>
          </PremiumAlert>
        )}
      </GlassSurface>

      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-slate-200">API Keys</h3>
          <PremiumButton variant="ghost" size="sm" onClick={fetchKeys} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Refresh</PremiumButton>
        </div>
        {loading ? (
          <div className="flex justify-center py-8"><PremiumSpinner /></div>
        ) : keys.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No API keys yet.</p>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div key={key.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium text-slate-200">{key.label}</span>
                    <GlassBadge variant={key.active ? 'success' : 'error'}>{key.active ? 'Active' : 'Revoked'}</GlassBadge>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-slate-500 font-mono">
                    <span>{key.keyPrefix}...{key.lastFour}</span>
                    <span>scopes: {key.scopes}</span>
                    {key.lastUsedAt && <span>last used: {new Date(key.lastUsedAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                {key.active && (
                  <PremiumButton variant="danger" size="sm" onClick={() => handleRevoke(key.id)} icon={<TrashIcon className="w-3 h-3" />}>Revoke</PremiumButton>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// ===========================================================================
// Webhooks Tab
// ===========================================================================
function WebhooksTab({ tenantId }: { tenantId: string }) {
  const [webhookUrl, setWebhookUrl] = useState('')
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const { toast } = usePremiumToast()
  const authHeaders = { 'X-Tenant-Id': tenantId }

  useEffect(() => {
    fetch('/api/tenant/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({}) })
      .then((r) => r.json())
      .then((data) => { if (data.success && data.webhookUrl) { setCurrentUrl(data.webhookUrl); setWebhookUrl(data.webhookUrl) } })
      .catch(() => {})
  }, [tenantId])

  const handleSave = async () => {
    try {
      const res = await fetch('/api/tenant/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ webhookUrl: webhookUrl || null }),
      })
      const data = await res.json()
      if (data.success) { setCurrentUrl(data.webhookUrl); toast.success('Webhook URL updated') }
      else { toast.error('Failed to update webhook', data.error) }
    } catch { toast.error('Failed to update webhook') }
  }

  const handleRotateSecret = async () => {
    try {
      const res = await fetch('/api/tenant/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ webhookSecret: 'rotate' }),
      })
      const data = await res.json()
      if (data.success && data.webhookSecret) { toast.success('Webhook secret rotated', 'Update your receiver') }
    } catch { toast.error('Failed to rotate secret') }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-slate-200">Webhook Configuration</h3>
        <GlassInput label="Webhook URL (HTTPS required)" placeholder="https://your-app.com/webhooks/veriface" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} />
        {currentUrl && <div className="text-[10px] text-slate-500">Current: <code className="font-mono">{currentUrl}</code></div>}
        <div className="flex gap-2">
          <PremiumButton onClick={handleSave} icon={<CheckCircleIcon className="w-4 h-4" />}>Save URL</PremiumButton>
          <PremiumButton variant="outline" onClick={handleRotateSecret} icon={<RefreshIcon className="w-4 h-4" />}>Rotate Secret</PremiumButton>
        </div>
      </GlassSurface>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-2">Webhook Events</h3>
        <div className="space-y-1 text-xs text-slate-400">
          {['enroll.success — User enrolled', 'auth.success — Authentication succeeded', 'auth.failure — Authentication failed', 'template.revoked — Template deleted (GDPR)', 'key.rotated — Signing key rotated', 'webhook.dead_lettered — Delivery failed'].map((e) => (
            <div key={e} className="flex items-center gap-2 p-1.5 rounded bg-white/[0.02]">
              <RadioIcon className="w-3 h-3 text-cyan-400" /><code className="font-mono">{e}</code>
            </div>
          ))}
        </div>
      </GlassSurface>
    </div>
  )
}

// ===========================================================================
// Audit Tab
// ===========================================================================
function AuditTab({ tenantId }: { tenantId: string }) {
  const [entries, setEntries] = useState<any[]>([])
  const [chainValid, setChainValid] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = usePremiumToast()
  const authHeaders = { 'X-Tenant-Id': tenantId }

  const fetchAudit = useCallback(async () => {
    setLoading(true)
    try {
      const [auditRes, verifyRes] = await Promise.all([
        fetch('/api/audit?limit=50', { headers: authHeaders }).then((r) => r.json()),
        fetch('/api/verify-audit', { headers: authHeaders }).then((r) => r.json()),
      ])
      if (auditRes.success) setEntries(auditRes.entries)
      if (verifyRes.success) setChainValid(verifyRes.valid)
    } catch { toast.error('Failed to fetch audit log') }
    finally { setLoading(false) }
  }, [tenantId, toast])

  useEffect(() => { fetchAudit() }, [fetchAudit])

  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const res = await fetch(`/api/audit/export?format=${format}`, { headers: authHeaders })
      if (format === 'csv') {
        const text = await res.text()
        const blob = new Blob([text], { type: 'text/csv' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `audit-${Date.now()}.csv`; a.click()
        URL.revokeObjectURL(url)
      } else {
        const data = await res.json()
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `audit-${Date.now()}.json`; a.click()
        URL.revokeObjectURL(url)
      }
      toast.success(`Exported as ${format.toUpperCase()}`)
    } catch { toast.error('Export failed') }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <GlassBadge variant={chainValid === true ? 'success' : chainValid === false ? 'error' : 'default'}>
          {chainValid === true ? 'CHAIN INTACT' : chainValid === false ? 'CHAIN BROKEN' : 'VERIFYING...'}
        </GlassBadge>
        <div className="flex gap-2">
          <PremiumButton variant="ghost" size="sm" onClick={() => handleExport('csv')} icon={<DownloadIcon className="w-3 h-3" />}>CSV</PremiumButton>
          <PremiumButton variant="ghost" size="sm" onClick={() => handleExport('json')} icon={<DownloadIcon className="w-3 h-3" />}>JSON</PremiumButton>
          <PremiumButton variant="ghost" size="sm" onClick={fetchAudit} loading={loading} icon={<RefreshIcon className="w-3 h-3" />}>Refresh</PremiumButton>
        </div>
      </div>
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        {loading ? <div className="flex justify-center py-8"><PremiumSpinner /></div>
        : entries.length === 0 ? <p className="text-xs text-slate-500 text-center py-8">No audit entries yet.</p>
        : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {entries.map((entry) => (
              <div key={entry.id} className="p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-slate-500">#{entry.chainIndex}</span>
                    <GlassBadge variant={entry.eventType.includes('success') ? 'success' : entry.eventType.includes('failure') ? 'error' : 'default'}>{entry.eventType}</GlassBadge>
                  </div>
                  <span className="text-[10px] text-slate-500">{new Date(entry.createdAt).toLocaleString()}</span>
                </div>
                <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(entry.payload, null, 2)}</pre>
                <div className="mt-1"><span className="text-[9px] text-slate-600 font-mono">hash: {entry.thisHash?.slice(0, 16)}...</span></div>
              </div>
            ))}
          </div>
        )}
      </GlassSurface>
    </div>
  )
}

// ===========================================================================
// Users Tab (GDPR)
// ===========================================================================
function UsersTab({ tenantId }: { tenantId: string }) {
  const [externalUserId, setExternalUserId] = useState('')
  const [deleteResult, setDeleteResult] = useState<any>(null)
  const { toast } = usePremiumToast()
  const authHeaders = { 'X-Tenant-Id': tenantId }

  const handleDelete = async () => {
    if (!externalUserId) return
    try {
      const res = await fetch('/api/templates/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ externalUserId }) })
      const data = await res.json()
      setDeleteResult(data)
      if (data.success) toast.success('Template deleted', 'GDPR Art. 17')
      else toast.error('Deletion failed', data.error)
    } catch { toast.error('Deletion failed') }
  }

  const handleExport = async () => {
    if (!externalUserId) return
    try {
      const res = await fetch(`/api/templates/export?externalUserId=${encodeURIComponent(externalUserId)}`, { headers: authHeaders })
      const data = await res.json()
      if (data.success) {
        const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a'); a.href = url; a.download = `user-data-${externalUserId}.json`; a.click()
        URL.revokeObjectURL(url)
        toast.success('Data exported', 'GDPR Art. 20')
      } else toast.error('Export failed', data.error)
    } catch { toast.error('Export failed') }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-slate-200">User Data Management (GDPR)</h3>
        <GlassInput label="External User ID" placeholder="user_123" value={externalUserId} onChange={(e) => setExternalUserId(e.target.value)} />
        <div className="flex gap-2 flex-wrap">
          <PremiumButton variant="danger" onClick={handleDelete} disabled={!externalUserId} icon={<TrashIcon className="w-4 h-4" />}>Delete (Art. 17)</PremiumButton>
          <PremiumButton variant="outline" onClick={handleExport} disabled={!externalUserId} icon={<DownloadIcon className="w-4 h-4" />}>Export (Art. 20)</PremiumButton>
        </div>
        {deleteResult && (
          <PremiumAlert variant={deleteResult.success ? 'success' : 'error'} dismissible onDismiss={() => setDeleteResult(null)}>
            {deleteResult.success ? `Deleted: ${deleteResult.deleted}, Receipt: ${deleteResult.revocationReceipt?.slice(0, 24)}...` : deleteResult.error}
          </PremiumAlert>
        )}
      </GlassSurface>
    </div>
  )
}

// ===========================================================================
// Settings Tab
// ===========================================================================
function SettingsTab({ tenantId }: { tenantId: string }) {
  const [rotating, setRotating] = useState(false)
  const { toast } = usePremiumToast()
  const authHeaders = { 'X-Tenant-Id': tenantId }

  const handleRotateKey = async () => {
    setRotating(true)
    try {
      const res = await fetch('/api/tenant/rotate-signing-key', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ confirm: true }) })
      const data = await res.json()
      if (data.success) toast.success('Signing key rotated', 'Old key is immediately invalid')
      else toast.error('Key rotation failed', data.error)
    } catch { toast.error('Key rotation failed') }
    finally { setRotating(false) }
  }

  return (
    <div className="space-y-4">
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4 space-y-4">
        <h3 className="text-sm font-medium text-slate-200">Tenant Settings</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Tenant ID</p><code className="text-[10px] font-mono text-slate-500">{tenantId}</code></div>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Signing Algorithm</p><p className="text-[10px] text-slate-500">Ed25519 (EdDSA)</p></div>
            <LockIcon className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
            <div><p className="text-xs font-medium text-slate-300">Encryption</p><p className="text-[10px] text-slate-500">AES-256-GCM + HKDF-SHA256</p></div>
            <LockIcon className="w-4 h-4 text-emerald-400" />
          </div>
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
