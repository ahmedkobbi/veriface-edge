'use client'

import { DemoConsole } from '@/components/veriface/DemoConsole'
import { Badge } from '@/components/ui/badge'
import { Shield, Cpu, Lock, Fingerprint, Zap, Eye } from 'lucide-react'

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100">
      {/* Hero Header */}
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center">
              <Fingerprint className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-semibold text-slate-100 leading-none">VeriFace Edge</h1>
              <p className="text-[10px] text-slate-500 mt-0.5">Privacy-First Facial Authentication</p>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-2">
            <Badge variant="outline" className="bg-slate-900 border-slate-800 text-slate-400">
              <Cpu className="w-3 h-3 mr-1" />
              Edge-AI
            </Badge>
            <Badge variant="outline" className="bg-slate-900 border-slate-800 text-slate-400">
              <Lock className="w-3 h-3 mr-1" />
              ZK Proofs
            </Badge>
            <Badge variant="outline" className="bg-slate-900 border-slate-800 text-slate-400">
              <Shield className="w-3 h-3 mr-1" />
              ISO 30107-3 Ready
            </Badge>
            <Badge variant="outline" className="bg-slate-900 border-slate-800 text-slate-400">
              GDPR / BIPA
            </Badge>
          </div>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="border-b border-slate-800 bg-gradient-to-b from-slate-950 via-slate-900/50 to-slate-950">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-4xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-px w-8 bg-emerald-500" />
              <span className="text-xs uppercase tracking-widest text-emerald-400 font-medium">
                Production-Grade Demo
              </span>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-slate-100 mb-4">
              Face authentication that{' '}
              <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
                never sends your face
              </span>{' '}
              to a server.
            </h2>
            <p className="text-base md:text-lg text-slate-400 max-w-2xl mb-6">
              100% of biometric computation runs in your browser via WebGPU + WASM.
              The backend receives only a zero-knowledge Pedersen commitment and
              a signed JWT — it cannot reconstruct your face even if compromised.
            </p>
            <div className="flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-2 text-slate-400">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>rPPG passive liveness (blood-flow detection)</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Eye className="w-4 h-4 text-cyan-400" />
                <span>6-layer anti-injection defense</span>
              </div>
              <div className="flex items-center gap-2 text-slate-400">
                <Shield className="w-4 h-4 text-emerald-400" />
                <span>Cryptographic template commitment</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Demo Console */}
      <section className="flex-1 py-8">
        <div className="container mx-auto px-4">
          <DemoConsole />
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800 bg-slate-950">
        <div className="container mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            <span className="text-slate-400 font-medium">VeriFace Edge SDK</span>
            {' '}— Privacy-First Web Facial Authentication. No raw images ever touch the server.
          </div>
          <div className="text-[10px] text-slate-600 font-mono">
            ed25519 · x25519 · blake3 · aes-256-gcm · mediapipe · webgpu
          </div>
        </div>
      </footer>
    </main>
  )
}
