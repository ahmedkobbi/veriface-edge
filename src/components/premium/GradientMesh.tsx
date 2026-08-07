'use client'

/**
 * VeriFace Edge — Animated Gradient Mesh Background
 *
 * Premium animated background with floating gradient orbs.
 * Uses CSS animations for performance (no JS re-renders).
 */

import { useSyncExternalStore } from 'react'

// useSyncExternalStore avoids the set-state-in-effect lint rule
// and is the React-recommended pattern for client-only rendering.
const emptySubscribe = () => () => {}
const getClientSnapshot = () => true

export function GradientMesh() {
  const mounted = useSyncExternalStore(emptySubscribe, getClientSnapshot, () => false)

  if (!mounted) return null

  return (
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Base gradient */}
      <div className="absolute inset-0 bg-slate-950" />

      {/* Floating gradient orbs */}
      <div
        className="absolute -top-40 -left-40 w-[40rem] h-[40rem] rounded-full opacity-30 blur-[120px]"
        style={{
          background: 'radial-gradient(circle, #10b981 0%, transparent 70%)',
          animation: 'float-orb-1 20s ease-in-out infinite',
        }}
      />
      <div
        className="absolute top-1/2 -right-40 w-[35rem] h-[35rem] rounded-full opacity-25 blur-[100px]"
        style={{
          background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)',
          animation: 'float-orb-2 25s ease-in-out infinite',
        }}
      />
      <div
        className="absolute -bottom-40 left-1/3 w-[30rem] h-[30rem] rounded-full opacity-20 blur-[100px]"
        style={{
          background: 'radial-gradient(circle, #8b5cf6 0%, transparent 70%)',
          animation: 'float-orb-3 30s ease-in-out infinite',
        }}
      />

      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `
            linear-gradient(to right, white 1px, transparent 1px),
            linear-gradient(to bottom, white 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px',
        }}
      />

      {/* Noise texture overlay for premium feel */}
      <div
        className="absolute inset-0 opacity-[0.015] mix-blend-overlay"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />

      <style jsx>{`
        @keyframes float-orb-1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(100px, 50px) scale(1.1); }
          66% { transform: translate(-50px, 100px) scale(0.9); }
        }
        @keyframes float-orb-2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(-100px, -50px) scale(1.15); }
        }
        @keyframes float-orb-3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          40% { transform: translate(80px, -80px) scale(1.1); }
          80% { transform: translate(-40px, 40px) scale(0.95); }
        }
      `}</style>
    </div>
  )
}
