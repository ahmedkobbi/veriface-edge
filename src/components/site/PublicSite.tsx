'use client'

import { GlassSurface, GlassCard3D, GlassBadge, GlassStatCard } from '@/components/premium/Glass'
import { MagneticButton } from '@/components/premium/MagneticButton'
import { GsapHero } from '@/components/premium/GsapHero'
import {
  ShieldLockIcon,
  CpuIcon,
  LockIcon,
  ZapIcon,
  EyeIcon,
  FingerprintIcon,
  CheckCircleIcon,
  SparklesIcon,
} from '@/components/brand/Icons'

interface PublicSiteProps {
  onTryDemo: () => void
}

export function PublicSite({ onTryDemo }: PublicSiteProps) {
  return (
    <div className="space-y-0">
      {/* Hero */}
      <section className="border-b border-white/[0.04] py-12 md:py-20 relative">
        <div className="container mx-auto px-4">
          <GsapHero
            title="Face authentication that"
            highlight="never sends your face"
            subtitle="100% of biometric computation runs in your browser via WebGPU + WASM. The backend receives only a zero-knowledge Pedersen commitment and a signed JWT — it cannot reconstruct your face even if compromised."
          >
            <div className="flex flex-wrap gap-4 items-center">
              <MagneticButton size="lg" onClick={onTryDemo}>
                <SparklesIcon className="w-4 h-4" />
                Try Live Demo
              </MagneticButton>
              <div className="flex flex-wrap gap-4 text-xs ml-2">
                <div className="flex items-center gap-2 text-slate-400">
                  <ZapIcon className="w-4 h-4 text-amber-400" />
                  <span>rPPG passive liveness</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <EyeIcon className="w-4 h-4 text-cyan-400" />
                  <span>6-layer anti-injection</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <ShieldLockIcon className="w-4 h-4 text-emerald-400" />
                  <span>Cryptographic commitment</span>
                </div>
              </div>
            </div>
          </GsapHero>
        </div>
      </section>

      {/* Stats */}
      <section className="py-12 border-b border-white/[0.04]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <GlassStatCard label="Auth Success Rate" value="99.4%" trend="up" trendValue="0.2%" />
            <GlassStatCard label="Avg Latency" value="< 1.2s" trend="down" trendValue="50ms" />
            <GlassStatCard label="False Accept Rate" value="0.01%" icon={<ShieldLockIcon className="w-4 h-4" />} />
            <GlassStatCard label="Compliance" value="GDPR + BIPA" icon={<CheckCircleIcon className="w-4 h-4" />} />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 border-b border-white/[0.04]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <GlassBadge variant="info">Core Features</GlassBadge>
            <h2 className="text-2xl md:text-4xl font-bold text-slate-100 mt-3 mb-2">
              Military-grade security,{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                privacy by architecture
              </span>
            </h2>
            <p className="text-sm text-slate-400 max-w-xl mx-auto">
              Every layer is designed to prevent data exfiltration, deepfake injection, and unauthorized access.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <GlassCard3D className="h-full">
              <div className="p-6">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3">
                  <LockIcon className="w-5 h-5 text-emerald-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">Zero-Knowledge</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Backend verifies Pedersen commitments without seeing the embedding.
                  Forward-secret ECDH sessions. AES-256-GCM encryption at every layer.
                </p>
              </div>
            </GlassCard3D>
            <GlassCard3D className="h-full">
              <div className="p-6">
                <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-3">
                  <CpuIcon className="w-5 h-5 text-cyan-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">Edge Compute</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  Real ONNX neural embedding via WebGPU. MediaPipe 478-point face detection.
                  CHROM-based rPPG blood-flow analysis. All in-browser.
                </p>
              </div>
            </GlassCard3D>
            <GlassCard3D className="h-full">
              <div className="p-6">
                <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-3">
                  <ShieldLockIcon className="w-5 h-5 text-purple-400" />
                </div>
                <h3 className="text-lg font-semibold text-slate-100 mb-2">Military-Grade</h3>
                <p className="text-sm text-slate-400 leading-relaxed">
                  SSRF protection, circuit breakers, idempotency keys, replay defense,
                  constant-time crypto, hash-chained audit log, GDPR Art. 7/17/20 compliance.
                </p>
              </div>
            </GlassCard3D>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 border-b border-white/[0.04]">
        <div className="container mx-auto px-4">
          <div className="text-center mb-10">
            <GlassBadge variant="success">Pricing</GlassBadge>
            <h2 className="text-2xl md:text-4xl font-bold text-slate-100 mt-3 mb-2">
              Pay only for successful auths
            </h2>
            <p className="text-sm text-slate-400">No setup fees, no per-user charges, no surprise bills.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {/* Developer */}
            <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-slate-100 mb-1">Developer</h3>
              <p className="text-xs text-slate-500 mb-4">For testing and prototyping</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-slate-100">Free</span>
                <span className="text-sm text-slate-500">/month</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-400 mb-6">
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> 1,000 auths/month</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Single tenant</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Community support</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> WebGPU only</li>
              </ul>
              <MagneticButton variant="secondary" size="md" className="w-full" onClick={onTryDemo}>
                Start Free
              </MagneticButton>
            </GlassSurface>
            {/* Growth */}
            <GlassSurface blur="xl" opacity="heavy" glow className="rounded-2xl p-6 border-emerald-500/20">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-semibold text-slate-100">Growth</h3>
                <GlassBadge variant="success">Popular</GlassBadge>
              </div>
              <p className="text-xs text-slate-500 mb-4">For production apps</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-slate-100">$0.08</span>
                <span className="text-sm text-slate-500">/successful auth</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-400 mb-6">
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> 100K auths/month</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Multi-region</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Webhooks + OIDC</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> 99.9% SLA</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Volume tiers to $0.04</li>
              </ul>
              <MagneticButton variant="primary" size="md" className="w-full" onClick={onTryDemo}>
                Get Started
              </MagneticButton>
            </GlassSurface>
            {/* Enterprise */}
            <GlassSurface blur="xl" opacity="medium" className="rounded-2xl p-6">
              <h3 className="text-lg font-semibold text-slate-100 mb-1">Enterprise</h3>
              <p className="text-xs text-slate-500 mb-4">For banks, defense, healthcare</p>
              <div className="mb-4">
                <span className="text-3xl font-bold text-slate-100">Custom</span>
              </div>
              <ul className="space-y-2 text-xs text-slate-400 mb-6">
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Unlimited auths</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> SAML + FIDO2 hybrid</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Nitro Enclave matching</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> 99.99% SLA</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> On-prem option</li>
                <li className="flex items-center gap-2"><CheckCircleIcon className="w-3.5 h-3.5 text-emerald-400" /> Custom model training</li>
              </ul>
              <MagneticButton variant="outline" size="md" className="w-full" onClick={onTryDemo}>
                Contact Sales
              </MagneticButton>
            </GlassSurface>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 border-b border-white/[0.04]">
        <div className="container mx-auto px-4 max-w-3xl">
          <div className="text-center mb-8">
            <GlassBadge variant="default">FAQ</GlassBadge>
            <h2 className="text-2xl md:text-3xl font-bold text-slate-100 mt-3">Common questions</h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'Does VeriFace store my face image?', a: 'No. Raw images never leave your browser. Only a Pedersen commitment (a one-way cryptographic hash) is sent to the server. Even if the database is compromised, your face cannot be reconstructed.' },
              { q: 'How does liveness detection work?', a: 'We use passive rPPG (Remote Photoplethysmography) to detect blood-flow pulse from skin color variations. This signal is physically impossible for current deepfakes to synthesize. We also use micro-texture analysis and geometric depth heuristics.' },
              { q: 'What about deepfake injection attacks?', a: 'Six independent defense layers: virtual camera detection, frame-timing jitter analysis, BLAKE3 replay filtering, sub-perceptible strobe probe, browser extension tamper check, and hardware attestation.' },
              { q: 'Is it GDPR compliant?', a: 'Yes. Privacy by Design (Art. 25), Right to be Forgotten with crypto-erasure (Art. 17), Data Portability (Art. 20), Consent recording (Art. 7), and storage limitation (Art. 5). No face geometry is stored — only an irreversible embedding.' },
              { q: 'What browsers are supported?', a: 'Chrome 113+, Edge 113+, Safari 17+, Firefox 121+. WebGPU is preferred; WASM SIMD fallback for older browsers. iOS requires Safari 17+ or a native WKWebView wrapper.' },
              { q: 'Can I use my own face recognition model?', a: 'Enterprise tier supports custom model training. The SDK is model-agnostic — any ONNX-compatible model that produces a 512-dim L2-normalized embedding can be dropped in.' },
            ].map((item, i) => (
              <GlassSurface key={i} blur="md" opacity="light" className="rounded-xl p-4">
                <h3 className="text-sm font-medium text-slate-200 mb-1">{item.q}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.a}</p>
              </GlassSurface>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <GlassSurface blur="2xl" opacity="heavy" glow className="rounded-2xl p-8 md:p-12 max-w-2xl mx-auto">
            <FingerprintIcon className="w-10 h-10 text-emerald-400 mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-bold text-slate-100 mb-2">
              Ready to authenticate without compromise?
            </h2>
            <p className="text-sm text-slate-400 mb-6">
              Set up in 5 minutes. No credit card required.
            </p>
            <MagneticButton size="lg" onClick={onTryDemo}>
              <SparklesIcon className="w-4 h-4" />
              Launch Live Demo
            </MagneticButton>
          </GlassSurface>
        </div>
      </section>
    </div>
  )
}
