'use client'

import { useState, useCallback } from 'react'
import { PublicSite } from '@/components/site/PublicSite'
import { DemoConsole } from '@/components/veriface/DemoConsole'
import { AdminPanel } from '@/components/admin/AdminPanel'
import { GradientMesh } from '@/components/premium/GradientMesh'
import { CustomCursor } from '@/components/premium/CustomCursor'
import { GlassNav } from '@/components/premium/Glass'
import { GlassBadge } from '@/components/premium/Glass'
import { VeriFaceLogoFull } from '@/components/brand/Icons'
import { CommandIcon } from '@/components/brand/Icons'
import { RadioIcon } from '@/components/brand/Icons'
import { useWebSocketStatus } from '@/sdk/use-websocket'
import { CommandPalette } from '@/components/premium/CommandPalette'

export type AppView = 'public' | 'demo' | 'admin'

export default function Home() {
  const [view, setView] = useState<AppView>('public')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const wsStatus = useWebSocketStatus()

  const handleCommand = useCallback((actionId: string) => {
    if (actionId === 'open-palette') {
      setPaletteOpen(true)
      return
    }
    if (actionId === 'view-public') setView('public')
    if (actionId === 'view-demo') setView('demo')
    if (actionId === 'view-admin') setView('admin')
  }, [])

  return (
    <main className="min-h-screen flex flex-col bg-slate-950 text-slate-100 relative overflow-x-hidden">
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
          <button onClick={() => setView('public')} className="flex items-center gap-2">
            <VeriFaceLogoFull size={36} variant="color" />
          </button>

          {/* View switcher */}
          <div className="hidden md:flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1">
            {(['public', 'demo', 'admin'] as AppView[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  view === v
                    ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
              >
                {v === 'public' ? 'Home' : v === 'demo' ? 'Live Demo' : 'Admin'}
              </button>
            ))}
          </div>

          {/* Right side */}
          <div className="flex items-center gap-2">
            <GlassBadge variant={wsStatus === 'connected' ? 'success' : 'default'}>
              <RadioIcon className={`w-3 h-3 ${wsStatus === 'connected' ? 'animate-pulse' : ''}`} />
              <span className="hidden sm:inline">{wsStatus}</span>
            </GlassBadge>
            <button
              onClick={() => setPaletteOpen(true)}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border border-white/[0.08] backdrop-blur-md bg-white/[0.03] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200 transition-all"
              aria-label="Open command palette"
            >
              <CommandIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mobile view switcher */}
        <div className="md:hidden flex items-center gap-1 px-4 pb-2">
          {(['public', 'demo', 'admin'] as AppView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === v
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white'
                  : 'text-slate-400 bg-white/[0.03]'
              }`}
            >
              {v === 'public' ? 'Home' : v === 'demo' ? 'Demo' : 'Admin'}
            </button>
          ))}
        </div>
      </GlassNav>

      {/* Content */}
      <div className="flex-1">
        {view === 'public' && <PublicSite onTryDemo={() => setView('demo')} />}
        {view === 'demo' && (
          <section className="py-8">
            <div className="container mx-auto px-4">
              <DemoConsole />
            </div>
          </section>
        )}
        {view === 'admin' && <AdminPanel />}
      </div>
    </main>
  )
}
