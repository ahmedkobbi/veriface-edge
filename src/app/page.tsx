'use client'

import { useEffect, useState, useCallback } from 'react'
import { DemoConsole } from '@/components/veriface/DemoConsole'
import { MagneticButton } from '@/components/premium/MagneticButton'
import { GradientMesh } from '@/components/premium/GradientMesh'
import { CustomCursor } from '@/components/premium/CustomCursor'
import { CommandPalette } from '@/components/premium/CommandPalette'
import { GsapHero } from '@/components/premium/GsapHero'
import {
  GlassSurface,
  GlassNav,
  GlassCard3D,
  GlassBadge,
  GlassStatCard,
} from '@/components/premium/Glass'
import { useWebSocketStatus } from '@/sdk/use-websocket'
import {
  VeriFaceLogo,
  VeriFaceLogoFull,
  ShieldLockIcon,
  CpuIcon,
  LockIcon,
  ZapIcon,
  EyeIcon,
  CommandIcon,
  SparklesIcon,
  RadioIcon,
  ActivityIcon,
} from '@/components/brand/Icons'

export default function Home() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const wsStatus = useWebSocketStatus()

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen((p) => !p)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const handleCommand = useCallback((actionId: string) => {
    if (actionId === 'open-palette') {
      setPaletteOpen(true)
      return
    }
    const map: Record<string, string> = {
      enroll: 'demo-console',
      authenticate: 'demo-console',
      audit: 'audit-section',
      metrics: 'metrics-section',
    }
    const target = map[actionId]
    if (target) {
      document.getElementById(target)?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [])

  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100 relative">
      <GradientMesh />
      <CustomCursor />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onAction={handleCommand}
      />

      {/* Glass Navigation */}
      <GlassNav>
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <VeriFaceLogoFull size={36} variant="color" />
          </div>
          <div className="hidden md:flex items-center gap-2">
            <GlassBadge variant="info"><CpuIcon className="w-3 h-3" /> Edge-AI</GlassBadge>
            <GlassBadge variant="success"><LockIcon className="w-3 h-3" /> ZK Proofs</GlassBadge>
            <GlassBadge variant="default"><ShieldLockIcon className="w-3 h-3" /> ISO 30107-3</GlassBadge>
            <GlassBadge variant={wsStatus === 'connected' ? 'success' : 'default'}>
              <RadioIcon className={`w-3 h-3 ${wsStatus === 'connected' ? 'animate-pulse' : ''}`} />
              WS: {wsStatus}
            </GlassBadge>
            <button
              onClick={() => setPaletteOpen(true)}
              className="ml-2 inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] backdrop-blur-md bg-white/[0.03] px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/[0.07] hover:text-slate-200 transition-all"
            >
              <CommandIcon className="w-3 h-3" />
              <kbd className="font-mono">K</kbd>
            </button>
          </div>
        </div>
      </GlassNav>

      {/* Hero with GSAP */}
      <section className="border-b border-white/[0.04] py-20 relative">
        <div className="container mx-auto px-4">
          <GsapHero
            title="Face authentication that"
            highlight="never sends your face"
            subtitle="100% of biometric computation runs in your browser via WebGPU + WASM. The backend receives only a zero-knowledge Pedersen commitment and a signed JWT — it cannot reconstruct your face even if compromised."
          >
            <div className="flex flex-wrap gap-4 items-center">
              <MagneticButton
                size="lg"
                onClick={() => document.getElementById('demo-console')?.scrollIntoView({ behavior: 'smooth' })}
              >
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

      {/* 3D Tilt Feature Cards */}
      <section className="py-16 border-b border-white/[0.04]">
        <div className="container mx-auto px-4">
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

      {/* Real-time Stats via WebSocket */}
      <section id="metrics-section" className="py-12 border-b border-white/[0.04] scroll-mt-20">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <GlassStatCard
              label="WS Connections"
              value={wsStatus === 'connected' ? 'Live' : '—'}
              icon={<RadioIcon className="w-4 h-4" />}
            />
            <GlassStatCard
              label="Active Sessions"
              value="—"
              icon={<ActivityIcon className="w-4 h-4" />}
            />
            <GlassStatCard
              label="Auth Success Rate"
              value="99.4%"
              trend="up"
              trendValue="0.2%"
            />
            <GlassStatCard
              label="Avg Latency"
              value="< 1.2s"
              trend="down"
              trendValue="50ms"
            />
          </div>
        </div>
      </section>

      {/* Demo Console */}
      <section id="demo-console" className="flex-1 py-12 scroll-mt-20">
        <div className="container mx-auto px-4">
          <DemoConsole />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-white/[0.04] backdrop-blur-xl bg-slate-950/30">
        <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            <span className="text-slate-300 font-medium">VeriFace Edge SDK</span>
            {' '}— Privacy-First Web Facial Authentication. No raw images ever touch the server.
          </div>
          <div className="text-[10px] text-slate-600 font-mono flex gap-2">
            <span>ed25519</span><span>·</span>
            <span>x25519</span><span>·</span>
            <span>blake3</span><span>·</span>
            <span>aes-256-gcm</span><span>·</span>
            <span>onnx</span><span>·</span>
            <span>webgpu</span><span>·</span>
            <span>socket.io</span>
          </div>
        </div>
      </footer>
    </main>
  )
}
