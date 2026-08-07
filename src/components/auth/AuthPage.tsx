'use client'

/**
 * VeriFace Edge — Authentication Page (Login + Signup)
 *
 * Premium glassmorphism auth form with toggle, validation, and API key display.
 */

import { useState, useCallback } from 'react'
import { GlassSurface, GlassInput, GlassBadge } from '@/components/premium/Glass'
import { PremiumButton, PremiumAlert, usePremiumToast } from '@/components/premium/Premium'
import { VeriFaceLogo } from '@/components/brand/Icons'
import { CheckCircleIcon, XCircleIcon, LockIcon, KeyIcon, CopyIcon } from '@/components/brand/Icons'

interface AuthPageProps {
  onSuccess: (user: any) => void
}

type AuthMode = 'login' | 'signup'

export function AuthPage({ onSuccess }: AuthPageProps) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)
  const { toast } = usePremiumToast()

  const passwordChecks = [
    { label: '8+ characters', pass: password.length >= 8 },
    { label: 'Uppercase', pass: /[A-Z]/.test(password) },
    { label: 'Lowercase', pass: /[a-z]/.test(password) },
    { label: 'Number', pass: /[0-9]/.test(password) },
  ]
  const passwordValid = passwordChecks.every((c) => c.pass)

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)
    setCreatedApiKey(null)

    try {
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
        setError(data.error || 'Authentication failed')
        return
      }

      if (mode === 'signup') {
        toast.success('Account created!', 'Welcome to VeriFace Edge')
        if (data.apiKey) {
          setCreatedApiKey(data.apiKey)
        }
      } else {
        toast.success('Welcome back!', `Logged in as ${data.user.email}`)
        setTimeout(() => onSuccess(data.user), 500)
      }
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }, [mode, email, password, name, onSuccess, toast])

  const handleContinue = () => onSuccess(null)

  return (
    <div className="flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <VeriFaceLogo size={48} variant="color" />
        </div>

        <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-6">
          <div className="flex gap-1 mb-6 rounded-xl bg-white/[0.03] p-1">
            <button
              onClick={() => { setMode('login'); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                mode === 'login' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              onClick={() => { setMode('signup'); setError(null) }}
              className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                mode === 'signup' ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>

          <h2 className="text-lg font-bold text-slate-100 mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h2>
          <p className="text-xs text-slate-500 mb-4">
            {mode === 'login' ? 'Sign in to access your VeriFace dashboard' : 'Get a tenant, API key, and access to all features'}
          </p>

          <div className="space-y-3">
            {mode === 'signup' && (
              <GlassInput label="Name (optional)" type="text" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} />
            )}
            <GlassInput label="Email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <GlassInput label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required />

            {mode === 'signup' && password.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {passwordChecks.map((check) => (
                  <div key={check.label} className="flex items-center gap-1 text-[10px]">
                    {check.pass ? <CheckCircleIcon className="w-3 h-3 text-emerald-400" /> : <XCircleIcon className="w-3 h-3 text-slate-600" />}
                    <span className={check.pass ? 'text-emerald-400' : 'text-slate-500'}>{check.label}</span>
                  </div>
                ))}
              </div>
            )}

            {error && <PremiumAlert variant="error" dismissible onDismiss={() => setError(null)}>{error}</PremiumAlert>}

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
                  <PremiumButton size="sm" className="w-full" onClick={handleContinue}>Continue to Dashboard</PremiumButton>
                </div>
              </PremiumAlert>
            )}

            {!createdApiKey && (
              <PremiumButton
                onClick={handleSubmit}
                loading={loading}
                disabled={mode === 'signup' && (!email || !passwordValid)}
                className="w-full"
                icon={mode === 'login' ? <LockIcon className="w-4 h-4" /> : <KeyIcon className="w-4 h-4" />}
              >
                {mode === 'login' ? 'Sign In' : 'Create Account'}
              </PremiumButton>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-white/[0.06]">
            <p className="text-[10px] text-slate-500 text-center">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(null); setCreatedApiKey(null) }} className="text-emerald-400 hover:text-emerald-300">
                {mode === 'login' ? 'Sign up' : 'Sign in'}
              </button>
            </p>
          </div>
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
