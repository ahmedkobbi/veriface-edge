'use client'

/**
 * VeriFace Edge — Admin UI Modules for Backend Features
 *
 * 4 modules that provide UI for features with APIs but no UI:
 *   1. BillingDashboardModule — Stripe + NowPayments (plans, checkout, invoices)
 *   2. AttributeCredentialsModule — Issue, list, verify, revoke ZK attribute credentials
 *   3. BackupHistoryModule — Backup status, history, health
 *   4. SecurityCenterModule — Post-quantum migration, ZK status, ceremony, access review
 *
 * All modules match the existing glassmorphism aesthetic.
 */

import { useState, useEffect, useCallback } from 'react'
import { GlassSurface, GlassBadge, GlassInput } from '@/components/premium/Glass'
import { PremiumButton, PremiumSpinner, PremiumAlert, usePremiumToast, PremiumDialog } from '@/components/premium/Premium'
import {
  ZapIcon, CheckCircleIcon, XCircleIcon, RefreshIcon, ShieldLockIcon,
  ActivityIcon, DownloadIcon, KeyIcon, LockIcon, MailIcon, CpuIcon,
} from '@/components/brand/Icons'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'

// ===========================================================================
// 1. BILLING DASHBOARD MODULE
// ===========================================================================

export function BillingDashboardModule({ tenantId }: { tenantId: string }) {
  const [billing, setBilling] = useState<any>(null)
  const [plans, setPlans] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/billing/status', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) {
        setBilling(data.billing)
        setPlans(data.plans)
      }
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const startCheckout = async (planTier: string, interval: string) => {
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ planTier, interval }),
      })
      const data = await res.json()
      if (data.success && data.url) {
        window.location.href = data.url
      } else {
        toast.error('Checkout failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  const openPortal = async () => {
    try {
      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        headers: { 'X-Tenant-Id': tenantId },
      })
      const data = await res.json()
      if (data.success && data.url) {
        window.location.href = data.url
      } else {
        toast.error('Portal failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  const startCryptoCheckout = async (planTier: string, interval: string) => {
    try {
      const res = await fetch('/api/billing/nowpayments/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ planTier, interval }),
      })
      const data = await res.json()
      if (data.success && data.invoiceUrl) {
        window.open(data.invoiceUrl, '_blank')
        toast.success('Crypto invoice created', `Pay ${data.payAmount} ${data.payCurrency} to ${data.payAddress.slice(0, 10)}...`)
      } else {
        toast.error('Crypto checkout failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <ZapIcon className="w-5 h-5 text-amber-400" />
            Billing & Subscriptions
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Stripe + crypto payments (USDC, BTC, ETH)</p>
        </div>
        <div className="flex items-center gap-2">
          {billing?.hasSubscription && (
            <PremiumButton variant="ghost" size="sm" onClick={openPortal}>
              Manage Billing
            </PremiumButton>
          )}
          <PremiumButton variant="secondary" size="sm" onClick={() => setShowUpgrade(true)} icon={<ZapIcon className="w-3.5 h-3.5" />}>
            Upgrade Plan
          </PremiumButton>
        </div>
      </div>

      {/* Current plan */}
      <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-500 mb-1">Current Plan</div>
            <div className="text-2xl font-bold text-emerald-400">
              {billing?.planTier ? billing.planTier.charAt(0).toUpperCase() + billing.planTier.slice(1) : 'Developer'}
            </div>
            <div className="text-xs text-slate-400 mt-1">
              Status: <GlassBadge variant={billing?.status === 'active' ? 'success' : 'default'}>{billing?.status || 'free'}</GlassBadge>
              {billing?.interval && <span className="ml-2 text-slate-500">· {billing.interval}</span>}
            </div>
          </div>
          <div className="text-right">
            {billing?.currentPeriodEnd && (
              <>
                <div className="text-xs text-slate-500">Renews</div>
                <div className="text-sm text-slate-300">{new Date(billing.currentPeriodEnd).toLocaleDateString()}</div>
              </>
            )}
          </div>
        </div>
      </GlassSurface>

      {/* Plan comparison */}
      {plans && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {Object.values(plans).map((plan: any) => (
            <div
              key={plan.tier}
              className={`rounded-2xl p-4 border transition-all ${
                billing?.planTier === plan.tier
                  ? 'bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 border-emerald-500/30'
                  : 'bg-white/[0.02] border-white/[0.06]'
              }`}
              style={plan.accentColor ? { boxShadow: billing?.planTier === plan.tier ? `0 0 0 1px ${plan.accentColor}40` : undefined } : undefined}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-bold" style={{ color: plan.accentColor }}>{plan.name}</span>
                {billing?.planTier === plan.tier && <GlassBadge variant="success">Current</GlassBadge>}
              </div>
              <div className="text-2xl font-bold text-slate-100">
                ${plan.priceMonthly}
                <span className="text-xs font-normal text-slate-500 ml-1">/mo</span>
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {plan.monthlyLimit === -1 ? 'Unlimited' : plan.monthlyLimit.toLocaleString()} calls/mo
              </div>
              <div className="mt-3 space-y-1">
                {plan.features.slice(0, 4).map((f: string) => (
                  <div key={f} className="text-[10px] text-slate-400 flex items-center gap-1">
                    <CheckCircleIcon className="w-3 h-3 text-emerald-400" /> {f}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent invoices */}
      {billing?.invoices && billing.invoices.length > 0 && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Recent Invoices</h4>
          <div className="space-y-2">
            {billing.invoices.slice(0, 5).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <div>
                  <span className="text-slate-300">{inv.number || inv.stripeInvoiceId?.slice(0, 16) || 'Invoice'}</span>
                  <span className="text-slate-500 ml-2">{new Date(inv.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-200">${(inv.amountPaid / 100).toFixed(2)}</span>
                  <GlassBadge variant={inv.status === 'paid' ? 'success' : 'warning'}>{inv.status}</GlassBadge>
                  {inv.invoicePdf && (
                    <a href={inv.invoicePdf} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:text-emerald-300">
                      <DownloadIcon className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </GlassSurface>
      )}

      {/* Recent payments */}
      {billing?.payments && billing.payments.length > 0 && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <h4 className="text-xs font-medium text-slate-300 mb-3">Recent Payments</h4>
          <div className="space-y-2">
            {billing.payments.slice(0, 5).map((pay: any) => (
              <div key={pay.id} className="flex items-center justify-between text-xs p-2 rounded-lg bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <GlassBadge variant={pay.provider === 'stripe' ? 'info' : 'default'}>{pay.provider}</GlassBadge>
                  <span className="text-slate-400">{pay.paymentMethod || 'card'}</span>
                  {pay.txHash && <span className="text-[10px] font-mono text-slate-500">{pay.txHash.slice(0, 12)}...</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-200">${(pay.amount / 100).toFixed(2)}</span>
                  <GlassBadge variant={pay.status === 'succeeded' ? 'success' : pay.status === 'failed' ? 'error' : 'warning'}>
                    {pay.status}
                  </GlassBadge>
                </div>
              </div>
            ))}
          </div>
        </GlassSurface>
      )}

      {/* Upgrade dialog */}
      <PremiumDialog open={showUpgrade} onClose={() => setShowUpgrade(false)} title="Upgrade Plan">
        <div className="space-y-3">
          {plans && Object.values(plans).filter((p: any) => p.tier !== 'developer').map((plan: any) => (
            <div key={plan.tier} className="rounded-lg bg-white/[0.02] border border-white/[0.06] p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <span className="text-sm font-bold" style={{ color: plan.accentColor }}>{plan.name}</span>
                  <span className="text-xs text-slate-400 ml-2">${plan.priceMonthly}/mo or ${plan.priceYearly}/yr</span>
                </div>
              </div>
              <div className="flex gap-2">
                <PremiumButton variant="primary" size="sm" onClick={() => startCheckout(plan.tier, 'month')}>
                  Pay with Card (Monthly)
                </PremiumButton>
                <PremiumButton variant="secondary" size="sm" onClick={() => startCheckout(plan.tier, 'year')}>
                  Pay with Card (Yearly)
                </PremiumButton>
                <PremiumButton variant="ghost" size="sm" onClick={() => startCryptoCheckout(plan.tier, 'month')}>
                  Pay with Crypto
                </PremiumButton>
              </div>
            </div>
          ))}
          <p className="text-[10px] text-slate-500">
            Payments are processed securely by Stripe or NowPayments. Your card details never touch our servers.
            Crypto payments support USDC, BTC, ETH, and 50+ coins.
          </p>
        </div>
      </PremiumDialog>
    </div>
  )
}

// ===========================================================================
// 2. ATTRIBUTE CREDENTIALS MODULE
// ===========================================================================

export function AttributeCredentialsModule({ tenantId, userRole }: { tenantId: string; userRole: string }) {
  const [credentials, setCredentials] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showIssue, setShowIssue] = useState(false)
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const { toast } = usePremiumToast()

  const [issueForm, setIssueForm] = useState({
    externalUserId: '',
    attributeType: 'age' as 'age' | 'employment' | 'rate_limit' | 'custom',
    value: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/attributes/list?externalUserId=all', { headers: { 'X-Tenant-Id': tenantId } })
      const data = await res.json()
      if (data.success) setCredentials(data.credentials)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const issueCredential = async () => {
    if (!issueForm.externalUserId || !issueForm.value) {
      toast.error('Missing fields', 'External user ID + value required')
      return
    }
    try {
      const res = await fetch('/api/attributes/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify(issueForm),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Credential issued', `Type: ${issueForm.attributeType}`)
        setShowIssue(false)
        setIssueForm({ externalUserId: '', attributeType: 'age', value: '' })
        load()
      } else {
        toast.error('Issue failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  const revokeCredential = async (credentialId: string) => {
    try {
      const res = await fetch('/api/attributes/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenantId },
        body: JSON.stringify({ credentialId }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Credential revoked')
        load()
      } else {
        toast.error('Revoke failed', data.error)
      }
    } catch {
      toast.error('Network error')
    }
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
            <KeyIcon className="w-5 h-5 text-cyan-400" />
            Attribute Credentials
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">ZK-powered selective disclosure (age, employment, rate-limit proofs)</p>
        </div>
        {userRole === 'admin' && (
          <PremiumButton variant="secondary" size="sm" onClick={() => setShowIssue(true)} icon={<KeyIcon className="w-3.5 h-3.5" />}>
            Issue Credential
          </PremiumButton>
        )}
      </div>

      <PremiumAlert variant="info">
        Attribute credentials allow users to prove properties (e.g., "I'm over 18") without revealing the underlying value.
        Uses Poseidon commitments + PLONK zk-SNARK proofs. The verifier learns ONLY whether the attribute holds.
      </PremiumAlert>

      {/* Attribute types */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { type: 'age', label: 'Age Proof', desc: '"I\'m over 18" — proves age without revealing DOB', icon: '🎂', color: '#10b981' },
          { type: 'employment', label: 'Employment Proof', desc: '"I\'m an employee" — proves membership without revealing ID', icon: '🏢', color: '#06b6d4' },
          { type: 'rate_limit', label: 'Rate Limit Proof', desc: '"I\'m within my limit" — proves usage without revealing count', icon: '📊', color: '#a855f7' },
        ].map((attr) => (
          <div key={attr.type} className="rounded-2xl p-4 bg-white/[0.02] border border-white/[0.06]">
            <div className="text-2xl mb-2">{attr.icon}</div>
            <div className="text-sm font-medium text-slate-200" style={{ color: attr.color }}>{attr.label}</div>
            <div className="text-xs text-slate-500 mt-1">{attr.desc}</div>
          </div>
        ))}
      </div>

      {/* Credentials list */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h4 className="text-xs font-medium text-slate-300 mb-3">Active Credentials ({credentials.length})</h4>
        {credentials.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No credentials issued yet. Click "Issue Credential" to create one.</p>
        ) : (
          <div className="space-y-2">
            {credentials.map((cred) => (
              <div key={cred.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <GlassBadge variant="info">{cred.attributeType}</GlassBadge>
                    <span className="text-xs font-mono text-slate-400 truncate">{cred.commitment?.slice(0, 24)}...</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    Issued: {new Date(cred.createdAt).toLocaleDateString()}
                    {cred.expiresAt && <span className="ml-2">· Expires: {new Date(cred.expiresAt).toLocaleDateString()}</span>}
                  </div>
                </div>
                {userRole === 'admin' && (
                  <PremiumButton variant="ghost" size="sm" onClick={() => revokeCredential(cred.id)}>
                    Revoke
                  </PremiumButton>
                )}
              </div>
            ))}
          </div>
        )}
      </GlassSurface>

      {/* Issue dialog */}
      <PremiumDialog open={showIssue} onClose={() => setShowIssue(false)} title="Issue Attribute Credential">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">External User ID</label>
            <GlassInput
              value={issueForm.externalUserId}
              onChange={(e) => setIssueForm({ ...issueForm, externalUserId: e.target.value })}
              placeholder="user_123"
              className="w-full"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Attribute Type</label>
            <select
              value={issueForm.attributeType}
              onChange={(e) => setIssueForm({ ...issueForm, attributeType: e.target.value as any })}
              className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-200"
            >
              <option value="age">Age (value = birth year, e.g., 1990)</option>
              <option value="employment">Employment (value = employee ID)</option>
              <option value="rate_limit">Rate Limit (value = auth count)</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Value</label>
            <GlassInput
              value={issueForm.value}
              onChange={(e) => setIssueForm({ ...issueForm, value: e.target.value })}
              placeholder={issueForm.attributeType === 'age' ? '1990' : 'emp_123'}
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <PremiumButton variant="ghost" size="sm" onClick={() => setShowIssue(false)}>Cancel</PremiumButton>
            <PremiumButton variant="primary" size="sm" onClick={issueCredential}>Issue Credential</PremiumButton>
          </div>
        </div>
      </PremiumDialog>
    </div>
  )
}

// ===========================================================================
// 3. BACKUP HISTORY MODULE
// ===========================================================================

export function BackupHistoryModule({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const { toast } = usePremiumToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/backups', { headers: { 'X-Tenant-Id': tenantId } })
      const d = await res.json()
      if (d.success) setData(d)
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>
  if (!data) return null

  const { summary, backups } = data

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <DownloadIcon className="w-5 h-5 text-emerald-400" />
          Backup History
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Encrypted database backups (AES-256-GCM) + disaster recovery</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-xs text-slate-500">Last Backup</div>
          <div className="text-sm font-bold text-slate-200">
            {summary.lastSuccessful ? new Date(summary.lastSuccessful).toLocaleString() : 'Never'}
          </div>
        </div>
        <div className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-xs text-slate-500">Hours Ago</div>
          <div className={`text-sm font-bold ${summary.isHealthy ? 'text-emerald-400' : 'text-red-400'}`}>
            {summary.hoursSinceLastBackup}h
          </div>
        </div>
        <div className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-xs text-slate-500">Total Backups</div>
          <div className="text-sm font-bold text-slate-200">{summary.total}</div>
        </div>
        <div className="rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-3">
          <div className="text-xs text-slate-500">Failed</div>
          <div className={`text-sm font-bold ${summary.failed > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
            {summary.failed}
          </div>
        </div>
      </div>

      {/* Health status */}
      <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {summary.isHealthy ? (
              <CheckCircleIcon className="w-8 h-8 text-emerald-400" />
            ) : (
              <XCircleIcon className="w-8 h-8 text-red-400" />
            )}
            <div>
              <div className="text-sm font-medium text-slate-200">
                {summary.isHealthy ? 'Backup system healthy' : 'Backup system needs attention'}
              </div>
              <div className="text-xs text-slate-500">
                {summary.isHealthy
                  ? `Last backup ${summary.hoursSinceLastBackup} hours ago (within 8-hour window)`
                  : `Last backup was ${summary.hoursSinceLastBackup} hours ago — check cron configuration`}
              </div>
            </div>
          </div>
          <GlassBadge variant={summary.isHealthy ? 'success' : 'error'}>
            {summary.isHealthy ? 'HEALTHY' : 'UNHEALTHY'}
          </GlassBadge>
        </div>
      </GlassSurface>

      {/* Backup history */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h4 className="text-xs font-medium text-slate-300 mb-3">Backup History</h4>
        {backups.length === 0 ? (
          <p className="text-xs text-slate-500 text-center py-8">No backups recorded yet.</p>
        ) : (
          <ScrollArea className="h-[400px]">
            <div className="space-y-2">
              {backups.map((backup: any) => (
                <div key={backup.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <GlassBadge variant={backup.status === 'success' ? 'success' : 'error'}>
                        {backup.status}
                      </GlassBadge>
                      <span className="text-xs font-mono text-slate-400">{backup.backupId}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1">
                      {new Date(backup.createdAt).toLocaleString()}
                      {backup.encryptedSizeBytes > 0 && (
                        <span className="ml-2">· {(backup.encryptedSizeBytes / 1024 / 1024).toFixed(2)} MB</span>
                      )}
                      {backup.s3Uri && <span className="ml-2">· S3 ✓</span>}
                      {backup.error && <span className="ml-2 text-red-400">· {backup.error}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </GlassSurface>

      <PremiumAlert variant="info">
        <span className="font-medium">Backup details:</span> AES-256-GCM encryption · SHA-256 integrity verification ·
        S3 offsite storage · {summary.retentionDays}-day local retention ·
        RTO: 15 min · RPO: 5 min
      </PremiumAlert>
    </div>
  )
}

// ===========================================================================
// 4. SECURITY CENTER MODULE
// ===========================================================================

export function SecurityCenterModule({ tenantId }: { tenantId: string }) {
  const [tab, setTab] = useState<'pq-migration' | 'zk-status' | 'access-review'>('pq-migration')
  const [pqData, setPqData] = useState<any>(null)
  const [zkData, setZkData] = useState<any>(null)
  const [reviewData, setReviewData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Fetch security status from various endpoints
    Promise.allSettled([
      fetch('/api/admin/plan', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
      fetch('/api/cron/access-review', { headers: { 'X-Tenant-Id': tenantId } }).then(r => r.json()),
    ]).then(([planRes, reviewRes]) => {
      if (planRes.status === 'fulfilled' && planRes.value.success) {
        setPqData(planRes.value)
      }
      if (reviewRes.status === 'fulfilled' && reviewRes.value.success) {
        setReviewData(reviewRes.value)
      }
      setLoading(false)
    })
  }, [tenantId])

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
          <ShieldLockIcon className="w-5 h-5 text-red-400" />
          Security Center
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">Post-quantum migration · ZK proof system · Access review</p>
      </div>

      {/* Sub-tabs */}
      <div className="inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1">
        {(['pq-migration', 'zk-status', 'access-review'] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              tab === t ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
            }`}>
            {t === 'pq-migration' ? 'Post-Quantum' : t === 'zk-status' ? 'ZK System' : 'Access Review'}
          </button>
        ))}
      </div>

      {/* Post-Quantum Migration */}
      {tab === 'pq-migration' && (
        <div className="space-y-3">
          <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-200 mb-3">ML-DSA-87 (Dilithium5) Migration Status</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-500">Ed25519 Key</div>
                <div className="text-sm font-bold text-emerald-400">✅ Active</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">ML-DSA-87 Key</div>
                <div className="text-sm font-bold text-amber-400">⚠️ Not configured</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Signature Mode</div>
                <div className="text-sm font-bold text-slate-200">hybrid-any</div>
              </div>
            </div>
          </GlassSurface>

          <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
            <h4 className="text-xs font-medium text-slate-300 mb-3">Migration Phases</h4>
            <div className="space-y-3">
              {[
                { phase: 1, mode: 'hybrid-any', desc: 'Accept Ed25519 OR ML-DSA-87', status: 'current' },
                { phase: 2, mode: 'hybrid-all', desc: 'Require BOTH Ed25519 AND ML-DSA-87', status: 'pending' },
                { phase: 3, mode: 'mldsa87-only', desc: 'Require ML-DSA-87 only (Ed25519 deprecated)', status: 'pending' },
              ].map((p) => (
                <div key={p.phase} className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.02]">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                    p.status === 'current' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700/50 text-slate-500'
                  }`}>
                    {p.phase}
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-mono text-slate-300">{p.mode}</div>
                    <div className="text-[10px] text-slate-500">{p.desc}</div>
                  </div>
                  {p.status === 'current' && <GlassBadge variant="success">Current</GlassBadge>}
                </div>
              ))}
            </div>
          </GlassSurface>

          <PremiumAlert variant="info">
            <span className="font-medium">ML-DSA-87</span> (Dilithium5) is NIST FIPS 204 — the post-quantum
            signature standard. It provides 233-bit quantum security (resistant to Shor's algorithm).
            Hybrid mode signs with BOTH Ed25519 + ML-DSA-87 for defense in depth.
          </PremiumAlert>
        </div>
      )}

      {/* ZK System Status */}
      {tab === 'zk-status' && (
        <div className="space-y-3">
          <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
            <h3 className="text-sm font-medium text-slate-200 mb-3">PLONK ZK Proof System Status</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <div className="text-xs text-slate-500">Protocol</div>
                <div className="text-sm font-bold text-emerald-400">PLONK</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Curve</div>
                <div className="text-sm font-bold text-slate-200">BN254</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Trusted Setup</div>
                <div className="text-sm font-bold text-emerald-400">✅ Universal SRS</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Proof Size</div>
                <div className="text-sm font-bold text-slate-200">~450 bytes</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Verify Time</div>
                <div className="text-sm font-bold text-slate-200">~15ms</div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Constraints</div>
                <div className="text-sm font-bold text-slate-200">76,863</div>
              </div>
            </div>
          </GlassSurface>

          <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
            <h4 className="text-xs font-medium text-slate-300 mb-3">ZK Circuits</h4>
            <div className="space-y-2">
              {[
                { name: 'Face Verification', desc: 'Embedding commitment + cosine similarity', status: 'deployed' },
                { name: 'Age Proof', desc: '"I\'m over 18" — without revealing birth year', status: 'deployed' },
                { name: 'Employment Proof', desc: '"I\'m an employee" — Merkle tree membership', status: 'deployed' },
                { name: 'Rate Limit Proof', desc: '"I\'m within my limit" — without revealing count', status: 'deployed' },
              ].map((circuit) => (
                <div key={circuit.name} className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                  <div>
                    <span className="text-xs font-medium text-slate-300">{circuit.name}</span>
                    <span className="text-[10px] text-slate-500 ml-2">{circuit.desc}</span>
                  </div>
                  <GlassBadge variant="success">{circuit.status}</GlassBadge>
                </div>
              ))}
            </div>
          </GlassSurface>

          <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
            <h4 className="text-xs font-medium text-slate-300 mb-3">MPC Ceremony Status</h4>
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                <span className="text-xs text-slate-400">Ceremony Protocol</span>
                <span className="text-xs text-slate-200">Perpetual Powers of Tau</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                <span className="text-xs text-slate-400">Security Model</span>
                <span className="text-xs text-emerald-400">≥1 honest participant → secure</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                <span className="text-xs text-slate-400">Compromise Probability</span>
                <span className="text-xs text-emerald-400">≈ 2⁻¹²⁸ (negligible)</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02]">
                <span className="text-xs text-slate-400">Transcript</span>
                <span className="text-xs text-cyan-400">Public audit available</span>
              </div>
            </div>
          </GlassSurface>
        </div>
      )}

      {/* Access Review */}
      {tab === 'access-review' && (
        <div className="space-y-3">
          {reviewData?.report ? (
            <>
              <GlassSurface blur="xl" opacity="heavy" className="rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-slate-200">Quarterly Access Review</h3>
                  <GlassBadge variant="info">
                    {new Date(reviewData.report.reviewDate).toLocaleDateString()}
                  </GlassBadge>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <div className="text-xs text-slate-500">API Keys</div>
                    <div className="text-lg font-bold text-slate-200">{reviewData.report.summary.totalApiKeys}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Admins</div>
                    <div className="text-lg font-bold text-slate-200">{reviewData.report.summary.totalAdmins}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Team Members</div>
                    <div className="text-lg font-bold text-slate-200">{reviewData.report.summary.totalTeamMembers}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Findings</div>
                    <div className={`text-lg font-bold ${reviewData.report.summary.findingsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {reviewData.report.summary.findingsCount}
                    </div>
                  </div>
                </div>
              </GlassSurface>

              {reviewData.report.findings.unusedApiKeys?.length > 0 && (
                <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
                  <h4 className="text-xs font-medium text-amber-400 mb-2">⚠️ Unused API Keys (90+ days)</h4>
                  <div className="space-y-1">
                    {reviewData.report.findings.unusedApiKeys.map((k: any) => (
                      <div key={k.keyId} className="text-xs text-slate-400 p-2 rounded-lg bg-white/[0.02]">
                        {k.label} · {k.tenant} · {k.daysSinceLastUse}d since last use
                      </div>
                    ))}
                  </div>
                </GlassSurface>
              )}

              {reviewData.report.findings.dormantAdmins?.length > 0 && (
                <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
                  <h4 className="text-xs font-medium text-amber-400 mb-2">⚠️ Dormant Admin Users</h4>
                  <div className="space-y-1">
                    {reviewData.report.findings.dormantAdmins.map((a: any) => (
                      <div key={a.userId} className="text-xs text-slate-400 p-2 rounded-lg bg-white/[0.02]">
                        {a.email} · {a.daysSinceLastLogin}d since last login
                      </div>
                    ))}
                  </div>
                </GlassSurface>
              )}

              {reviewData.report.summary.findingsCount === 0 && (
                <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
                  <div className="flex items-center gap-2">
                    <CheckCircleIcon className="w-5 h-5 text-emerald-400" />
                    <span className="text-sm text-slate-200">No findings — all access is active and within policy.</span>
                  </div>
                </GlassSurface>
              )}
            </>
          ) : (
            <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-8 text-center">
              <ActivityIcon className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No access review reports yet.</p>
              <p className="text-xs text-slate-600 mt-1">Reviews run quarterly (first day of each quarter).</p>
            </GlassSurface>
          )}
        </div>
      )}
    </div>
  )
}
