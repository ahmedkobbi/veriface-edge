'use client'

import { useEffect, useState, useCallback } from 'react'
import { DemoConsole } from '@/components/veriface/DemoConsole'
import { Badge } from '@/components/ui/badge'
import { Shield, Cpu, Lock, Fingerprint, Zap, Eye, Command, Sparkles } from 'lucide-react'
import { MagneticButton } from '@/components/premium/MagneticButton'
import { GlassCard } from '@/components/premium/GlassCard'
import { GradientMesh } from '@/components/premium/GradientMesh'
import { CustomCursor } from '@/components/premium/CustomCursor'
import { CommandPalette } from '@/components/premium/CommandPalette'
import { GsapHero } from '@/components/premium/GsapHero'

export default function Home() {
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Keyboard shortcut for command palette
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
    // Scroll to relevant section or trigger action
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

      {/* Hero Header */}
      <header className="border-b border-white/5 backdrop-blur-md sticky top-0 z-40 bg-slate-950/50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-emerald-500/30">
              <Fingerprint className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-100 leading-none">VeriFace Edge</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">Privacy-First Facial Authentication</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-300">
              <Cpu className="w-3 h-3 mr-1" />
              Edge-AI
            </Badge>
            <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-300">
              <Lock className="w-3 h-3 mr-1" />
              ZK Proofs
            </Badge>
            <Badge variant="outline" className="bg-white/5 border-white/10 text-slate-300">
              <Shield className="w-3 h-3 mr-1" />
              ISO 30107-3
            </Badge>
            <button
              onClick={() => setPaletteOpen(true)}
              className="ml-2 inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-400 hover:bg-white/10 transition-colors"
            >
              <Command className="w-3 h-3" />
              <kbd className="font-mono">K</kbd>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Banner with GSAP */}
      <section className="border-b border-white/5 py-20 relative">
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
                <Sparkles className="w-4 h-4" />
                Try Live Demo
              </MagneticButton>
              <div className="flex flex-wrap gap-4 text-xs ml-2">
                <div className="flex items-center gap-2 text-slate-400">
                  <Zap className="w-4 h-4 text-amber-400" />
                  <span>rPPG passive liveness</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Eye className="w-4 h-4 text-cyan-400" />
                  <span>6-layer anti-injection</span>
                </div>
                <div className="flex items-center gap-2 text-slate-400">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Cryptographic commitment</span>
                </div>
              </div>
            </div>
          </GsapHero>
        </div>
      </section>

      {/* Feature cards with glassmorphism */}
      <section className="py-12 border-b border-white/5">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <GlassCard glow className="p-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center mb-3">
                <Lock className="w-5 h-5 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">Zero-Knowledge</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Backend verifies Pedersen commitments without seeing the embedding.
                Forward-secret ECDH sessions. AES-256-GCM encryption at every layer.
              </p>
            </GlassCard>
            <GlassCard glow className="p-6">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 flex items-center justify-center mb-3">
                <Cpu className="w-5 h-5 text-cyan-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">Edge Compute</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Real ONNX neural embedding via WebGPU. MediaPipe 478-point face detection.
                CHROM-based rPPG blood-flow analysis. All in-browser.
              </p>
            </GlassCard>
            <GlassCard glow className="p-6">
              <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center mb-3">
                <Shield className="w-5 h-5 text-purple-400" />
              </div>
              <h3 className="text-lg font-semibold text-slate-100 mb-2">Military-Grade</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                SSRF protection, circuit breakers, idempotency keys, replay defense,
                constant-time crypto, hash-chained audit log, GDPR Art. 7/17/20 compliance.
              </p>
            </GlassCard>
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
      <footer className="mt-auto border-t border-white/5 bg-slate-950/50 backdrop-blur-sm">
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
            <span>webgpu</span>
          </div>
        </div>
      </footer>
    </main>
  )
}
