'use client'

/**
 * VeriFace Edge — 2FA Management Component
 *
 * Used in Account Settings tab. Handles:
 *   - Setup: generate QR code → scan → verify code → enable
 *   - Disable: require current TOTP/backup code
 *   - Status display
 *   - Backup codes display (after enable)
 */

import { useState } from 'react'
import { GlassSurface, GlassInput, GlassBadge } from '@/components/premium/Glass'
import { PremiumButton, PremiumAlert, PremiumSpinner, usePremiumToast } from '@/components/premium/Premium'
import { CheckCircleIcon, XCircleIcon, ShieldLockIcon, KeyIcon, CopyIcon, LockIcon } from '@/components/brand/Icons'

interface TwoFactorManagerProps {
  tenantId: string
  twoFactorEnabled: boolean
  onStatusChange: (enabled: boolean) => void
}

type SetupStep = 'idle' | 'qr' | 'verify' | 'backup-codes' | 'disabled'

export function TwoFactorManager({ tenantId, twoFactorEnabled, onStatusChange }: TwoFactorManagerProps) {
  const [step, setStep] = useState<SetupStep>('idle')
  const [qrCodeUrl, setQrCodeUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [verifyCode, setVerifyCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const { toast } = usePremiumToast()
  const H = { 'X-Tenant-Id': tenantId }

  const handleSetup = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/2fa/setup', { method: 'POST', headers: H })
      const data = await res.json()
      if (data.success) {
        setQrCodeUrl(data.qrCodeUrl)
        setSecret(data.secret)
        setStep('qr')
      } else toast.error('Setup failed', data.error)
    } catch { toast.error('Setup failed') }
    finally { setLoading(false) }
  }

  const handleEnable = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/2fa/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...H },
        body: JSON.stringify({ secret, code: verifyCode }),
      })
      const data = await res.json()
      if (data.success) {
        setBackupCodes(data.backupCodes)
        setStep('backup-codes')
        onStatusChange(true)
        toast.success('2FA enabled!')
      } else toast.error('Invalid code', data.error)
    } catch { toast.error('Failed') }
    finally { setLoading(false) }
  }

  const handleDisable = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...H },
        body: JSON.stringify({ code: disableCode }),
      })
      const data = await res.json()
      if (data.success) {
        setStep('idle')
        setDisableCode('')
        onStatusChange(false)
        toast.success('2FA disabled')
      } else toast.error('Invalid code', data.error)
    } catch { toast.error('Failed') }
    finally { setLoading(false) }
  }

  return (
    <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <ShieldLockIcon className="w-4 h-4 text-emerald-400" />
        <h3 className="text-sm font-medium text-slate-200">Two-Factor Authentication (TOTP)</h3>
        <GlassBadge variant={twoFactorEnabled ? 'success' : 'default'}>
          {twoFactorEnabled ? 'Enabled' : 'Disabled'}
        </GlassBadge>
      </div>

      {/* Status: Disabled → Show enable button */}
      {!twoFactorEnabled && step === 'idle' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Add an extra layer of security. Requires an authenticator app (Google Authenticator, Authy, 1Password).</p>
          <PremiumButton onClick={handleSetup} loading={loading} icon={<KeyIcon className="w-4 h-4" />}>Enable 2FA</PremiumButton>
        </div>
      )}

      {/* Step: QR Code */}
      {step === 'qr' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-400">1. Scan this QR code with your authenticator app:</p>
          <div className="flex justify-center">
            {qrCodeUrl && <img src={qrCodeUrl} alt="2FA QR Code" className="rounded-lg" width={200} height={200} />}
          </div>
          <div>
            <p className="text-[10px] text-slate-500 mb-1">Or enter manually:</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-2 py-1.5 bg-slate-950 rounded font-mono text-[10px] text-emerald-300 break-all">{secret}</code>
              <button onClick={() => navigator.clipboard.writeText(secret)} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400">
                <CopyIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-400">2. Enter the 6-digit code from your app:</p>
          <GlassInput placeholder="123456" value={verifyCode} onChange={e => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center text-lg tracking-widest font-mono" />
          <div className="flex gap-2">
            <PremiumButton variant="ghost" onClick={() => setStep('idle')}>Cancel</PremiumButton>
            <PremiumButton onClick={handleEnable} loading={loading} disabled={verifyCode.length !== 6}>Verify & Enable</PremiumButton>
          </div>
        </div>
      )}

      {/* Step: Backup Codes */}
      {step === 'backup-codes' && (
        <div className="space-y-4">
          <PremiumAlert variant="success" title="2FA Enabled!">
            Save these backup codes. Each can be used once if you lose your authenticator device.
          </PremiumAlert>
          <div className="grid grid-cols-2 gap-2">
            {backupCodes.map((code, i) => (
              <div key={i} className="flex items-center gap-2 p-2 rounded bg-slate-950/50 border border-white/[0.04]">
                <code className="font-mono text-xs text-amber-300">{code}</code>
                <button onClick={() => navigator.clipboard.writeText(code)} className="text-slate-600 hover:text-slate-400">
                  <CopyIcon className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <PremiumButton variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(backupCodes.join('\n'))} icon={<CopyIcon className="w-3 h-3" />}>Copy All</PremiumButton>
            <PremiumButton size="sm" onClick={() => { setStep('idle'); setBackupCodes([]) }}>I&apos;ve Saved Them</PremiumButton>
          </div>
        </div>
      )}

      {/* Status: Enabled → Show disable section */}
      {twoFactorEnabled && step === 'idle' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
            <CheckCircleIcon className="w-4 h-4 text-emerald-400" />
            <p className="text-xs text-emerald-300">2FA is active. You&apos;ll need a code from your authenticator app to log in.</p>
          </div>
          <details className="group">
            <summary className="cursor-pointer text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
              <XCircleIcon className="w-3.5 h-3.5" /> Disable 2FA
            </summary>
            <div className="mt-3 space-y-2">
              <p className="text-[10px] text-slate-500">Enter a TOTP code or backup code to disable:</p>
              <GlassInput placeholder="123456 or ABCD-1234" value={disableCode} onChange={e => setDisableCode(e.target.value)} />
              <PremiumButton variant="danger" size="sm" onClick={handleDisable} loading={loading} disabled={!disableCode} icon={<LockIcon className="w-3 h-3" />}>Confirm Disable</PremiumButton>
            </div>
          </details>
        </div>
      )}

      {loading && step === 'idle' && <div className="flex justify-center py-4"><PremiumSpinner /></div>}
    </GlassSurface>
  )
}

/**
 * 2FA Login Challenge — shown when login returns requiresTwoFactor: true.
 */
export function TwoFactorChallenge({
  pendingToken,
  onSuccess,
  onCancel,
}: {
  pendingToken: string
  onSuccess: (user: any) => void
  onCancel: () => void
}) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  const handleSubmit = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/2fa/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken, code }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success('Welcome back!')
        if (data.backupUsed) {
          toast.warning('Backup code used', `${data.remainingBackupCodes} remaining — generate new ones in settings`)
        }
        onSuccess(data.user)
      } else {
        setError(data.error || 'Invalid code')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-6">
          <div className="text-center mb-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3">
              <ShieldLockIcon className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold text-slate-100">Two-Factor Authentication</h2>
            <p className="text-xs text-slate-500 mt-1">Enter the 6-digit code from your authenticator app.</p>
          </div>

          <div className="space-y-3">
            <input
              type="text"
              placeholder="123456"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && code.length === 6 && handleSubmit()}
              className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-white/[0.08] text-center text-2xl tracking-[0.5em] font-mono text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
              autoFocus
              inputMode="numeric"
              pattern="\d{6}"
            />
            {error && <PremiumAlert variant="error" dismissible onDismiss={() => setError(null)}>{error}</PremiumAlert>}
            <div className="flex gap-2">
              <PremiumButton variant="ghost" onClick={onCancel}>Back</PremiumButton>
              <PremiumButton onClick={handleSubmit} loading={loading} disabled={code.length !== 6} className="flex-1">Verify</PremiumButton>
            </div>
            <p className="text-[10px] text-slate-500 text-center">
              Lost your device? Use a backup code (format: ABCD-1234).
            </p>
          </div>
        </GlassSurface>
      </div>
    </div>
  )
}
