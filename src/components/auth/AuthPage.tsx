'use client'

/**
 * VeriFace Edge — Authentication Page
 *
 * Modes:
 *   - login: email + password
 *   - signup: name + email + password
 *   - forgot: email only (sends reset link)
 *   - reset: new password (triggered by ?reset_password=TOKEN URL param)
 *   - verify: handled automatically via ?verify_email=TOKEN URL param
 *
 * Features:
 *   - Email verification banner (resend button)
 *   - Password strength indicator
 *   - API key display after signup
 *   - Toast notifications
 */

import { useState, useCallback, useEffect } from 'react'
import { GlassSurface, GlassInput, GlassBadge } from '@/components/premium/Glass'
import { PremiumButton, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import { VeriFaceLogo } from '@/components/brand/Icons'
import { CheckCircleIcon, XCircleIcon, LockIcon, KeyIcon, CopyIcon } from '@/components/brand/Icons'
import { TwoFactorChallenge } from '@/components/auth/TwoFactorManager'

interface AuthPageProps {
  onSuccess: (user: any) => void
}

type AuthMode = 'login' | 'signup' | 'forgot' | 'reset'

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState<string | null>(null)
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; message: string } | null>(null)
  const [twoFactorPending, setTwoFactorPending] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  // Check URL for verify_email or reset_password params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verifyToken = params.get('verify_email')
    const resetTokenParam = params.get('reset_password')

    if (verifyToken) {
      // Auto-verify email
      fetch(`/api/auth/verify-email?token=${verifyToken}`)
        .then(r => r.json())
        .then(data => {
          setVerificationResult({ success: data.success, message: data.message ?? data.error })
          if (data.success) toast.success('Email verified!', data.message)
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname)
        })
        .catch(() => setVerificationResult({ success: false, message: 'Verification failed' }))
    }

    if (resetTokenParam) {
      setResetToken(resetTokenParam)
      setMode('reset')
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [toast])

  const passwordChecks = [
    { label: '8+ characters', pass: password.length >= 8 },
    { label: 'Uppercase', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase', pass: /[a-z]/.test(password) },
    { label: 'Number', pass: /[0-9]/.test(password) },
  ]
  const passwordValid = passwordChecks.every(c => c.pass)

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCreatedApiKey(null)

    try {
      if (mode === 'forgot') {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        })
        const data = await res.json()
        if (data.success) {
          toast.success('Reset link sent', data.message)
          setMode('login')
        } else {
          setError(data.error || 'Failed to send reset link')
        }
        return
      }

      if (mode === 'reset') {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken, newPassword: password }),
        })
        const data = await res.json()
        if (data.success) {
          toast.success('Password reset!', 'Please log in with your new password')
          setMode('login')
          setPassword('')
          setResetToken(null)
        } else {
          setError(data.error || 'Reset failed')
        }
        return
      }

      // Login or signup
      const endpoint = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login'
      const body = mode === 'signup'
        ? { email, password, name: name || undefined }
        : { email, password }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (!data.success) {
        // Check if 2FA is required
        if (data.requiresTwoFactor && data.pendingToken) {
          setTwoFactorPending(data.pendingToken)
          setError(null)
          return
        }
        setError(data.error || 'Authentication failed')
        return
      }

      if (mode === 'signup') {
        toast.success('Account created!', 'Check your email to verify your address')
        if (data.apiKey) setCreatedApiKey(data.apiKey)
      } else {
        toast.success('Welcome back!', `Logged in as ${data.user.email}`)
        setTimeout(() => onSuccess(data.user), 500)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [mode, email, password, name, resetToken, onSuccess, toast])

  const handleResendVerification = async () => {
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (data.success) toast.success('Verification email sent')
      else toast.error('Failed to resend', data.error)
    } catch {
      toast.error('Failed to resend')
    }
  }

  // 2FA challenge
  if (twoFactorPending) {
    return (
      <TwoFactorChallenge
        pendingToken={twoFactorPending}
        onSuccess={(user) => {
          setTwoFactorPending(null)
          onSuccess(user)
        }}
        onCancel={() => {
          setTwoFactorPending(null)
          setMode('login')
        }}
      />
    )
  }

  // Email verification result
  if (verificationResult) {
    return (
      <div className="flex items-center justify-center py-12 px-4">
        <div className="w-full max-w-md">
          <div className="flex justify-center mb-6">
            <VeriFaceLogo size={48} variant="color" />
          </div>
          <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-6 text-center">
            {verificationResult.success ? (
              <CheckCircleIcon className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            ) : (
              <XCircleIcon className="w-12 h-12 text-red-400 mx-auto mb-3" />
            )}
            <h2 className="text-lg font-bold text-slate-100 mb-2">
              {verificationResult.success ? 'Email Verified!' : 'Verification Failed'}
            </h2>
            <p className="text-xs text-slate-400 mb-4">{verificationResult.message}</p>
            <PremiumButton onClick={() => { setVerificationResult(null); setMode('login') }}>
              Continue to Sign In
            </PremiumButton>
          </GlassSurface>
        </div>
      </div>
    )
  }

  const titles: Record<AuthMode, { title: string; subtitle: string }> = {
    login: { title: 'Welcome back', subtitle: 'Sign in to access your VeriFace dashboard' },
    signup: { title: 'Create your account', subtitle: 'Get a tenant, API key, and access to all features' },
    forgot: { title: 'Reset password', subtitle: 'Enter your email to receive a reset link' },
    reset: { title: 'New password', subtitle: 'Choose a new password for your account' },
  }

  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <VeriFaceLogo size={48} variant="color" />
        </div>

        <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-6">
          {/* Mode tabs (login / signup only) */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="flex gap-1 mb-6 rounded-xl bg-white/[0.03] p-1">
              <button onClick={() => { setMode('login'); setError(null); setCreatedApiKey(null) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${mode === 'login' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                Sign In
              </button>
              <button onClick={() => { setMode('signup'); setError(null); setCreatedApiKey(null) }}
                className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${mode === 'signup' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
                Create Account
              </button>
            </div>
          )}

          <h2 className="text-lg font-bold text-slate-100 mb-1">{titles[mode].title}</h2>
          <p className="text-xs text-slate-500 mb-4">{titles[mode].subtitle}</p>

          <div className="space-y-3">
            {/* Name (signup only) */}
            {mode === 'signup' && (
              <GlassInput label="Name (optional)" type="text" placeholder="John Doe" value={name} onChange={e => setName(e.target.value)} />
            )}

            {/* Email (all modes except reset) */}
            {mode !== 'reset' && (
              <GlassInput label="Email" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} required />
            )}

            {/* Password (login, signup, reset) */}
            {mode !== 'forgot' && (
              <GlassInput
                label={mode === 'reset' ? 'New Password' : 'Password'}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
            )}

            {/* Password strength (signup + reset) */}
            {(mode === 'signup' || mode === 'reset') && password.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {passwordChecks.map(check => (
                  <div key={check.label} className="flex items-center gap-1 text-[10px]">
                    {check.pass ? <CheckCircleIcon className="w-3 h-3 text-emerald-400" /> : <XCircleIcon className="w-3 h-3 text-slate-600" />}
                    <span className={check.pass ? 'text-emerald-400' : 'text-slate-500'}>{check.label}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Forgot password link (login only) */}
            {mode === 'login' && (
              <div className="text-right">
                <button onClick={() => { setMode('forgot'); setError(null) }} className="text-[10px] text-emerald-400 hover:text-emerald-300">
                  Forgot password?
                </button>
              </div>
            )}

            {/* Error */}
            {error && <PremiumAlert variant="error" dismissible onDismiss={() => setError(null)}>{error}</PremiumAlert>}

            {/* API key display (after signup) */}
            {createdApiKey && (
              <PremiumAlert variant="success" title="API Key Created" dismissible onDismiss={() => setCreatedApiKey(null)}>
                <div className="space-y-2">
                  <p className="text-[10px]">Copy this key — it won&apos;t be shown again:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 px-2 py-1.5 bg-slate-950 rounded font-mono text-[10px] text-emerald-300 break-all">{createdApiKey}</code>
                    <button onClick={() => navigator.clipboard.writeText(createdApiKey)} className="flex-shrink-0 p-2 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200">
                      <CopyIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <svg className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7 L12 13 L21 7"/></svg>
                    <p className="text-[10px] text-amber-300">We sent a verification link to your email. Verify to unlock all features.</p>
                  </div>
                  <PremiumButton size="sm" className="w-full" onClick={() => onSuccess(null)}>Continue to Dashboard</PremiumButton>
                </div>
              </PremiumAlert>
            )}

            {/* Submit */}
            {!createdApiKey && (
              <PremiumButton
                onClick={handleSubmit}
                loading={loading}
                disabled={
                  (mode === 'signup' && (!email || !passwordValid)) ||
                  (mode === 'login' && (!email || !password)) ||
                  (mode === 'forgot' && !email) ||
                  (mode === 'reset' && !passwordValid)
                }
                className="w-full"
                icon={mode === 'login' ? <LockIcon className="w-4 h-4" /> : mode === 'signup' ? <KeyIcon className="w-4 h-4" /> : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7 L12 13 L21 7"/></svg>}
              >
                {mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Send Reset Link' : 'Reset Password'}
              </PremiumButton>
            )}

            {/* Back to login (forgot/reset modes) */}
            {(mode === 'forgot' || mode === 'reset') && (
              <button onClick={() => { setMode('login'); setError(null); setResetToken(null); setPassword('') }} className="w-full text-center text-[10px] text-slate-500 hover:text-slate-300">
                ← Back to sign in
              </button>
            )}
          </div>

          {/* Footer (login/signup only) */}
          {(mode === 'login' || mode === 'signup') && (
            <div className="mt-4 pt-4 border-t border-white/[0.06]">
              {/* SSO divider + button (login only) */}
              {mode === 'login' && (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="flex-1 h-px bg-white/[0.06]" />
                    <span className="text-[10px] text-slate-600">or</span>
                    <div className="flex-1 h-px bg-white/[0.06]" />
                  </div>
                  <PremiumButton
                    variant="outline"
                    className="w-full mb-3"
                    onClick={() => {
                      const tenantId = new URLSearchParams(window.location.search).get('tenant')
                      if (tenantId) {
                        window.location.href = `/api/saml/login?tenant=${tenantId}&redirect=/admin`
                      } else {
                        toast.info('SSO requires a tenant ID', 'Ask your admin for the SSO login URL')
                      }
                    }}
                    icon={<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2 L20 6 L20 13 C20 17 16 21 12 22 C8 21 4 17 4 13 L4 6 Z" strokeLinejoin="round"/><path d="M9 12 L11 14 L15 10" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                  >
                    Sign in with SSO (SAML)
                  </PremiumButton>
                </>
              )}
              <p className="text-[10px] text-slate-500 text-center">
                {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
                <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setCreatedApiKey(null) }} className="text-emerald-400 hover:text-emerald-300">
                  {mode === 'login' ? 'Sign up' : 'Sign in'}
                </button>
              </p>
            </div>
          )}
        </GlassSurface>

        <div className="flex justify-center gap-2 mt-4">
          <GlassBadge variant="default"><LockIcon className="w-2.5 h-2.5" /> bcrypt</GlassBadge>
          <GlassBadge variant="default"><KeyIcon className="w-2.5 h-2.5" /> Ed25519 JWT</GlassBadge>
          <GlassBadge variant="default">httpOnly Cookie</GlassBadge>
        </div>
      </div>
    </div>
  )
}
