'use client'

/**
 * VeriFace Edge — SAML SSO Configuration Module
 *
 * Admin UI for configuring SAML 2.0 SSO:
 *   - Enter IdP details (entity ID, SSO URL, certificate)
 *   - View SP metadata URL (for IdP import)
 *   - Configure attribute mappings
 *   - Enable/disable + auto-provision toggle
 *   - Test SSO button
 */

import { useState, useEffect } from 'react'
import { GlassSurface, GlassInput, GlassBadge } from '@/components/premium/Glass'
import { PremiumButton, PremiumAlert, PremiumSpinner, usePremiumToast } from '@/components/premium/Premium'
import { CheckCircleIcon, CopyIcon, ShieldLockIcon, CpuIcon, KeyIcon } from '@/components/brand/Icons'

interface SamlConfigModuleProps {
  tenantId: string
  userRole: string
}

export function SamlConfigModule({ tenantId, userRole }: SamlConfigModuleProps) {
  const [config, setConfig] = useState<any>(null)
  const [defaults, setDefaults] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const { toast } = usePremiumToast()
  const H = { 'X-Tenant-Id': tenantId }

  // Form fields
  const [idpEntityId, setIdpEntityId] = useState('')
  const [idpSsoUrl, setIdpSsoUrl] = useState('')
  const [idpCert, setIdpCert] = useState('')
  const [emailAttr, setEmailAttr] = useState('email')
  const [nameAttr, setNameAttr] = useState('name')
  const [enabled, setEnabled] = useState(false)
  const [autoProvision, setAutoProvision] = useState(true)

  useEffect(() => {
    fetch('/api/admin/saml-config', { headers: H })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setConfig(d.config)
          setDefaults(d.defaults)
          if (d.config) {
            setIdpEntityId(d.config.idpEntityId ?? '')
            setIdpSsoUrl(d.config.idpSsoUrl ?? '')
            setIdpCert(d.config.idpCertificate ?? '')
            setEmailAttr(d.config.emailAttribute ?? 'email')
            setNameAttr(d.config.nameAttribute ?? 'name')
            setEnabled(d.config.enabled ?? false)
            setAutoProvision(d.config.autoProvision ?? true)
          }
        }
      })
      .finally(() => setLoading(false))
  }, [tenantId])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/saml-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...H },
        body: JSON.stringify({
          idpEntityId,
          idpSsoUrl,
          idpCertificate: idpCert,
          emailAttribute: emailAttr,
          nameAttribute: nameAttr,
          enabled,
          autoProvision,
        }),
      })
      const data = await res.json()
      if (data.success) {
        setConfig(data.config)
        toast.success('SAML configuration saved')
      } else toast.error('Failed to save', data.error)
    } catch { toast.error('Failed to save') }
    finally { setSaving(false) }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast.success('Copied to clipboard')
  }

  if (loading) return <div className="flex justify-center py-8"><PremiumSpinner size="lg" /></div>

  return (
    <div className="space-y-4">
      {/* SP Metadata (read-only) */}
      {defaults && (
        <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CpuIcon className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-medium text-slate-200">Service Provider (SP) Metadata</h3>
          </div>
          <p className="text-xs text-slate-500 mb-3">Import this URL into your IdP (Okta, Azure AD, etc.) to configure VeriFace as a trusted Service Provider.</p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500">Metadata URL (give this to your IdP admin)</p>
                <code className="text-[10px] font-mono text-cyan-300 break-all">{defaults.metadataUrl}</code>
              </div>
              <PremiumButton variant="ghost" size="sm" onClick={() => copyToClipboard(defaults.metadataUrl)} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500">ACS URL (Assertion Consumer Service)</p>
                <code className="text-[10px] font-mono text-slate-400 break-all">{defaults.acsUrl}</code>
              </div>
              <PremiumButton variant="ghost" size="sm" onClick={() => copyToClipboard(defaults.acsUrl)} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-slate-500">SP Entity ID</p>
                <code className="text-[10px] font-mono text-slate-400 break-all">{defaults.spEntityId}</code>
              </div>
              <PremiumButton variant="ghost" size="sm" onClick={() => copyToClipboard(defaults.spEntityId)} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
            </div>
          </div>
        </GlassSurface>
      )}

      {/* IdP Configuration */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <ShieldLockIcon className="w-4 h-4 text-emerald-400" />
          <h3 className="text-sm font-medium text-slate-200">Identity Provider (IdP) Configuration</h3>
          {config?.enabled && <GlassBadge variant="success">Enabled</GlassBadge>}
        </div>

        {userRole !== 'admin' ? (
          <PremiumAlert variant="info">Only admins can modify SAML settings. Contact your tenant admin.</PremiumAlert>
        ) : (
          <div className="space-y-3">
            <GlassInput label="IdP Entity ID" placeholder="https://yourorg.okta.com/saml/metadata" value={idpEntityId} onChange={e => setIdpEntityId(e.target.value)} />
            <GlassInput label="IdP SSO URL" type="url" placeholder="https://yourorg.okta.com/app/veriface/sso/saml" value={idpSsoUrl} onChange={e => setIdpSsoUrl(e.target.value)} />

            <div>
              <label className="text-xs text-slate-400 mb-1 block">IdP x509 Certificate (PEM format)</label>
              <textarea
                placeholder={"-----BEGIN CERTIFICATE-----\nMIIDezCCAN...\n-----END CERTIFICATE-----"}
                value={idpCert}
                onChange={e => setIdpCert(e.target.value)}
                rows={5}
                className="w-full px-3.5 py-2.5 rounded-xl border border-white/[0.08] backdrop-blur-xl bg-white/[0.03] text-xs text-slate-100 font-mono placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 resize-none"
              />
            </div>

            {/* Attribute mappings */}
            <div className="grid grid-cols-2 gap-3">
              <GlassInput label="Email Attribute" placeholder="email" value={emailAttr} onChange={e => setEmailAttr(e.target.value)} />
              <GlassInput label="Name Attribute" placeholder="name" value={nameAttr} onChange={e => setNameAttr(e.target.value)} />
            </div>

            {/* Toggles */}
            <div className="space-y-2">
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div>
                  <p className="text-xs font-medium text-slate-200">Enable SAML SSO</p>
                  <p className="text-[10px] text-slate-500">Allow users to sign in via your IdP</p>
                </div>
                <button onClick={() => setEnabled(!enabled)} disabled={saving}
                  className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                <div>
                  <p className="text-xs font-medium text-slate-200">Auto-Provision Users</p>
                  <p className="text-[10px] text-slate-500">Create accounts for new SAML users on first login</p>
                </div>
                <button onClick={() => setAutoProvision(!autoProvision)} disabled={saving}
                  className={`relative w-11 h-6 rounded-full transition-colors ${autoProvision ? 'bg-emerald-500' : 'bg-slate-700'}`}>
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${autoProvision ? 'translate-x-5' : ''}`} />
                </button>
              </div>
            </div>

            {/* Save */}
            <PremiumButton onClick={handleSave} loading={saving} disabled={!idpEntityId || !idpSsoUrl || !idpCert}
              icon={<CheckCircleIcon className="w-4 h-4" />}>
              Save SAML Configuration
            </PremiumButton>

            {/* Test SSO */}
            {enabled && (
              <div className="pt-3 border-t border-white/[0.06]">
                <p className="text-[10px] text-slate-500 mb-2">Test SAML SSO by opening this URL in a private window:</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-2 py-1.5 bg-slate-950 rounded font-mono text-[10px] text-cyan-300 break-all">
                    /api/saml/login?tenant={tenantId}
                  </code>
                  <PremiumButton variant="ghost" size="sm" onClick={() => copyToClipboard(`${window.location.origin}/api/saml/login?tenant=${tenantId}`)} icon={<CopyIcon className="w-3 h-3" />}>Copy</PremiumButton>
                </div>
              </div>
            )}
          </div>
        )}
      </GlassSurface>

      {/* Supported IdPs */}
      <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-4">
        <h3 className="text-sm font-medium text-slate-200 mb-3">Supported Identity Providers</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {['Okta', 'Azure AD (Entra ID)', 'Google Workspace', 'OneLogin', 'ADFS', 'Auth0', 'Keycloak', 'PingFederate', 'Shibboleth'].map(idp => (
            <div key={idp} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
              <CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-xs text-slate-300">{idp}</span>
            </div>
          ))}
        </div>
      </GlassSurface>
    </div>
  )
}
