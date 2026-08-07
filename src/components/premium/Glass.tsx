'use client'

/**
 * VeriFace Edge — Full Glassmorphism Design System
 *
 * True frosted-glass effect with:
 *   - Layered backdrop blur (multiple blur layers for depth)
 *   - Subtle gradient borders (light refraction on edges)
 *   - Noise texture overlay (realistic glass surface)
 *   - Inner glow (ambient light)
 *   - 3D tilt on hover (mouse-tracking perspective)
 */

import { type ReactNode, type HTMLAttributes, useRef, type MouseEvent, useState, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { animated, useSpring } from '@react-spring/web'
import { cn } from '@/lib/utils'
import { useEffect } from 'react'

// ---------------------------------------------------------------------------
// Glass surface — the base component
// ---------------------------------------------------------------------------

interface GlassSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode
  blur?: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
  opacity?: 'light' | 'medium' | 'heavy'
  border?: boolean
  noise?: boolean
  glow?: boolean
}

export function GlassSurface({
  children,
  className,
  blur = 'xl',
  opacity = 'medium',
  border = true,
  noise = true,
  glow = false,
  ...props
}: GlassSurfaceProps) {
  const blurMap = {
    sm: 'backdrop-blur-sm',
    md: 'backdrop-blur-md',
    lg: 'backdrop-blur-lg',
    xl: 'backdrop-blur-xl',
    '2xl': 'backdrop-blur-2xl',
  }
  const opacityMap = {
    light: 'bg-white/[0.03]',
    medium: 'bg-white/[0.06]',
    heavy: 'bg-white/[0.10]',
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden',
        blurMap[blur],
        opacityMap[opacity],
        border && 'border border-white/[0.08]',
        'shadow-2xl shadow-black/20',
        className,
      )}
      {...props}
    >
      {/* Edge light refraction */}
      <div
        className="pointer-events-none absolute inset-0 rounded-[inherit]"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.04) 100%)',
        }}
      />
      {/* Noise texture */}
      {noise && (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.02] mix-blend-overlay"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
      )}
      {/* Ambient glow */}
      {glow && (
        <div
          className="pointer-events-none absolute -inset-1 rounded-[inherit] opacity-50 blur-xl"
          style={{
            background: 'radial-gradient(circle at 50% 0%, rgba(16,185,129,0.15), transparent 70%)',
          }}
        />
      )}
      {/* Content */}
      <div className="relative z-10">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass Card with 3D tilt
// ---------------------------------------------------------------------------

interface GlassCard3DProps {
  children: ReactNode
  className?: string
  tiltStrength?: number  // 0-1, default 0.15
  glow?: boolean
}

export function GlassCard3D({ children, className, tiltStrength = 0.15, glow = true }: GlassCard3DProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [isHovering, setIsHovering] = useState(false)

  const [springs, api] = useSpring(() => ({
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    config: { tension: 300, friction: 30 },
  }))

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width - 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5
    api.start({
      rotateY: x * tiltStrength * 30,
      rotateX: -y * tiltStrength * 30,
      scale: 1.02,
    })
  }

  const handleMouseLeave = () => {
    setIsHovering(false)
    api.start({ rotateX: 0, rotateY: 0, scale: 1 })
  }

  return (
    <animated.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={handleMouseLeave}
      style={{
        ...springs,
        transformStyle: 'preserve-3d',
        perspective: 1000,
      }}
      className={cn('relative', className)}
    >
      <GlassSurface
        blur="2xl"
        opacity="heavy"
        glow={glow && isHovering}
        className="rounded-2xl"
      >
        <div style={{ transform: 'translateZ(50px)' }}>
          {children}
        </div>
      </GlassSurface>
    </animated.div>
  )
}

// ---------------------------------------------------------------------------
// Glass Navigation Bar
// ---------------------------------------------------------------------------

interface GlassNavProps {
  children: ReactNode
  className?: string
}

export function GlassNav({ children, className }: GlassNavProps) {
  return (
    <nav
      className={cn(
        'sticky top-0 z-40 border-b border-white/[0.06]',
        'backdrop-blur-2xl bg-slate-950/40',
        'shadow-lg shadow-black/5',
        className,
      )}
    >
      {/* Edge highlight */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="relative z-10">{children}</div>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Glass Input
// ---------------------------------------------------------------------------

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  icon?: ReactNode
}

export function GlassInput({ label, icon, className, ...props }: GlassInputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-xs font-medium text-slate-400 block">{label}</label>
      )}
      <div className="relative">
        {icon && (
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
            {icon}
          </div>
        )}
        <input
          className={cn(
            'w-full rounded-xl border border-white/[0.08]',
            'backdrop-blur-xl bg-white/[0.03]',
            'px-3.5 py-2.5 text-sm text-slate-100',
            'placeholder:text-slate-500',
            'transition-all duration-200',
            'hover:bg-white/[0.05] hover:border-white/[0.12]',
            'focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 focus:bg-white/[0.07]',
            icon && 'pl-10',
            className,
          )}
          {...props}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass Textarea
// ---------------------------------------------------------------------------

interface GlassTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
}

export function GlassTextarea({ label, className, ...props }: GlassTextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="text-xs font-medium text-slate-400 block">{label}</label>
      )}
      <textarea
        className={cn(
          'w-full rounded-xl border border-white/[0.08]',
          'backdrop-blur-xl bg-white/[0.03]',
          'px-3.5 py-2.5 text-sm text-slate-100',
          'placeholder:text-slate-500',
          'transition-all duration-200',
          'hover:bg-white/[0.05] hover:border-white/[0.12]',
          'focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500/30 focus:bg-white/[0.07]',
          'resize-none',
          className,
        )}
        {...props}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass Badge
// ---------------------------------------------------------------------------

interface GlassBadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info'
  className?: string
}

export function GlassBadge({ children, variant = 'default', className }: GlassBadgeProps) {
  const variants = {
    default: 'bg-white/[0.06] text-slate-300 border-white/[0.08]',
    success: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    warning: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    error: 'bg-red-500/10 text-red-300 border-red-500/20',
    info: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20',
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5',
        'backdrop-blur-md text-[10px] font-medium',
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Glass Tabs
// ---------------------------------------------------------------------------

interface GlassTabsProps {
  tabs: Array<{ id: string; label: string; icon?: ReactNode }>
  activeTab: string
  onTabChange: (id: string) => void
  className?: string
}

export function GlassTabs({ tabs, activeTab, onTabChange, className }: GlassTabsProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-xl border border-white/[0.08]',
        'backdrop-blur-xl bg-white/[0.03] p-1',
        className,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            'relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
            'transition-all duration-200',
            activeTab === tab.id
              ? 'bg-white/10 text-white shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]',
          )}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass Modal
// ---------------------------------------------------------------------------

interface GlassModalProps {
  open: boolean
  onClose: () => void
  children: ReactNode
  title?: string
  className?: string
}

export function GlassModal({ open, onClose, children, title, className }: GlassModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      {/* Modal */}
      <GlassSurface
        blur="2xl"
        opacity="heavy"
        className={cn(
          'relative w-full max-w-lg rounded-2xl p-6',
          'animate-[modal-in_0.2s_ease-out]',
          className,
        )}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200"
            >
              ✕
            </button>
          </div>
        )}
        {children}
        <style jsx>{`
          @keyframes modal-in {
            from { opacity: 0; transform: scale(0.95) translateY(10px); }
            to { opacity: 1; transform: scale(1) translateY(0); }
          }
        `}</style>
      </GlassSurface>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Glass Stat Card
// ---------------------------------------------------------------------------

interface GlassStatCardProps {
  label: string
  value: string | number
  icon?: ReactNode
  trend?: 'up' | 'down' | 'neutral'
  trendValue?: string
}

export function GlassStatCard({ label, value, icon, trend, trendValue }: GlassStatCardProps) {
  return (
    <GlassSurface blur="xl" opacity="medium" className="rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs text-slate-400 mb-1">{label}</p>
          <p className="text-2xl font-bold text-slate-100">{value}</p>
        </div>
        {icon && <div className="text-slate-500">{icon}</div>}
      </div>
      {trend && trendValue && (
        <div className="mt-2 flex items-center gap-1 text-xs">
          <span className={
            trend === 'up' ? 'text-emerald-400' :
            trend === 'down' ? 'text-red-400' :
            'text-slate-400'
          }>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {trendValue}
          </span>
        </div>
      )}
    </GlassSurface>
  )
}
