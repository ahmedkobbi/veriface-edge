'use client'

/**
 * VeriFace Edge — Glassmorphism Card
 *
 * Frosted-glass card with backdrop-blur, subtle gradient border,
 * and hover glow effect. Premium aesthetic.
 */

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface GlassCardProps {
  children: ReactNode
  className?: string
  glow?: boolean
  hover?: boolean
}

export function GlassCard({ children, className, glow = false, hover = true }: GlassCardProps) {
  return (
    <div
      className={cn(
        'relative rounded-2xl border border-white/10',
        'bg-white/5 backdrop-blur-xl',
        'shadow-2xl shadow-black/20',
        'before:absolute before:inset-0 before:rounded-2xl before:bg-gradient-to-br before:from-white/5 before:to-transparent before:pointer-events-none',
        hover && 'transition-all duration-300 hover:border-white/20 hover:bg-white/10',
        glow && 'after:absolute after:inset-0 after:rounded-2xl after:bg-gradient-to-r after:from-emerald-500/10 after:via-cyan-500/10 after:to-blue-500/10 after:opacity-0 after:transition-opacity after:duration-500 hover:after:opacity-100 after:pointer-events-none',
        className,
      )}
    >
      <div className="relative z-10">{children}</div>
    </div>
  )
}
