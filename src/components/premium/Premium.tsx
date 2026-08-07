'use client'

/**
 * VeriFace Edge — Premium UI Component Library
 *
 * Complete set of glassmorphism-ified interactive components:
 *   - PremiumSpinner (animated SVG gradient)
 *   - PremiumToast (glass + slide-in + countdown)
 *   - PremiumAlert (glass + icon + dismiss)
 *   - PremiumProgress (gradient + shimmer + stripes)
 *   - PremiumTooltip (glass + arrow)
 *   - PremiumDropdown (glass + icons)
 *   - PremiumSwitch (glass + spring)
 *   - PremiumAvatar (glass + ring + status)
 *   - PremiumPopover (glass + arrow)
 *   - PremiumDialog (glass + scale-in)
 *   - PremiumBreadcrumbs (glass)
 *   - PremiumPagination (glass)
 *   - PremiumSkeleton (enhanced shimmer)
 *   - PremiumButton (magnetic + loading + icon animations)
 *
 * All components use backdrop-blur, edge light refraction, noise texture.
 */

import {
  type ReactNode,
  type ButtonHTMLAttributes,
  useEffect,
  useState,
  useRef,
  type MouseEvent,
  useCallback,
} from 'react'
import { animated, useSpring, useTransition } from '@react-spring/web'
import { Fragment } from 'react'
import { cn } from '@/lib/utils'

// ===========================================================================
// Premium Spinner — animated SVG with gradient + glow
// ===========================================================================

interface PremiumSpinnerProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  variant?: 'gradient' | 'dots' | 'pulse' | 'bars'
  className?: string
}

export function PremiumSpinner({ size = 'md', variant = 'gradient', className }: PremiumSpinnerProps) {
  const sizes = { xs: 12, sm: 16, md: 24, lg: 32, xl: 48 }
  const px = sizes[size]

  if (variant === 'dots') {
    return (
      <div className={cn('inline-flex items-center gap-1', className)} style={{ height: px }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400"
            style={{
              width: px / 3,
              height: px / 3,
              animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
            }}
          />
        ))}
        <style jsx>{`
          @keyframes pulse-dot {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
        `}</style>
      </div>
    )
  }

  if (variant === 'bars') {
    return (
      <div className={cn('inline-flex items-end gap-0.5', className)} style={{ height: px }}>
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="w-1 rounded-full bg-gradient-to-t from-emerald-500 to-cyan-400"
            style={{
              height: '100%',
              animation: `bar-bounce 1s ease-in-out ${i * 0.1}s infinite`,
            }}
          />
        ))}
        <style jsx>{`
          @keyframes bar-bounce {
            0%, 100% { transform: scaleY(0.3); }
            50% { transform: scaleY(1); }
          }
        `}</style>
      </div>
    )
  }

  if (variant === 'pulse') {
    return (
      <div className={cn('relative', className)} style={{ width: px, height: px }}>
        <div
          className="absolute inset-0 rounded-full bg-emerald-500/30"
          style={{ animation: 'pulse-ring 1.5s ease-out infinite' }}
        />
        <div
          className="absolute inset-2 rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400"
          style={{ animation: 'pulse-core 1.5s ease-in-out infinite' }}
        />
        <style jsx>{`
          @keyframes pulse-ring {
            0% { transform: scale(0.8); opacity: 0.8; }
            100% { transform: scale(1.4); opacity: 0; }
          }
          @keyframes pulse-core {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(0.9); }
          }
        `}</style>
      </div>
    )
  }

  // Default: gradient ring spinner
  return (
    <svg
      className={cn('animate-spin', className)}
      width={px}
      height={px}
      viewBox="0 0 24 24"
      fill="none"
    >
      <defs>
        <linearGradient id="spinner-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <circle
        cx="12" cy="12" r="10"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M12 2 A10 10 0 0 1 22 12"
        stroke="url(#spinner-gradient)"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="12" cy="12" r="2" fill="url(#spinner-gradient)" opacity="0.8" />
    </svg>
  )
}

// ===========================================================================
// Premium Progress — gradient + shimmer + optional stripes
// ===========================================================================

interface PremiumProgressProps {
  value: number  // 0-100
  size?: 'xs' | 'sm' | 'md' | 'lg'
  variant?: 'gradient' | 'striped' | 'glow'
  showLabel?: boolean
  label?: string
  className?: string
}

export function PremiumProgress({
  value,
  size = 'sm',
  variant = 'gradient',
  showLabel = false,
  label,
  className,
}: PremiumProgressProps) {
  const heights = { xs: 1, sm: 2, md: 3, lg: 4 }
  const height = heights[size]
  const clamped = Math.max(0, Math.min(100, value))

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="flex justify-between text-[10px] text-slate-400 mb-1">
          <span>{label}</span>
          <span className="font-mono">{clamped.toFixed(0)}%</span>
        </div>
      )}
      <div
        className={cn(
          'relative w-full overflow-hidden rounded-full',
          'bg-white/[0.04] border border-white/[0.06]',
        )}
        style={{ height }}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300 ease-out relative overflow-hidden',
            variant === 'gradient' && 'bg-gradient-to-r from-emerald-500 via-cyan-400 to-blue-400',
            variant === 'glow' && 'bg-gradient-to-r from-emerald-400 to-cyan-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
          )}
          style={{ width: `${clamped}%` }}
        >
          {variant === 'striped' && (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: 'linear-gradient(45deg, rgba(255,255,255,0.1) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.1) 75%, transparent 75%, transparent)',
                backgroundSize: '20px 20px',
                animation: 'stripe-move 1s linear infinite',
              }}
            />
          )}
          {/* Shimmer overlay */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
              animation: 'shimmer-move 2s linear infinite',
            }}
          />
        </div>
      </div>
      <style jsx>{`
        @keyframes stripe-move {
          0% { background-position: 0 0; }
          100% { background-position: 20px 0; }
        }
        @keyframes shimmer-move {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

// ===========================================================================
// Premium Alert — glass + icon + dismiss animation
// ===========================================================================

interface PremiumAlertProps {
  variant?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  children: ReactNode
  dismissible?: boolean
  onDismiss?: () => void
  className?: string
}

export function PremiumAlert({
  variant = 'info',
  title,
  children,
  dismissible = false,
  onDismiss,
  className,
}: PremiumAlertProps) {
  const [visible, setVisible] = useState(true)
  const transitions = useTransition(visible, {
    from: { opacity: 0, transform: 'translateY(-8px) scale(0.98)' },
    enter: { opacity: 1, transform: 'translateY(0) scale(1)' },
    leave: { opacity: 0, transform: 'translateY(-8px) scale(0.98)' },
    config: { tension: 300, friction: 20 },
  })

  const variants = {
    info: {
      border: 'border-cyan-500/20',
      bg: 'bg-cyan-500/[0.05]',
      text: 'text-cyan-300',
      icon: 'ℹ',
    },
    success: {
      border: 'border-emerald-500/20',
      bg: 'bg-emerald-500/[0.05]',
      text: 'text-emerald-300',
      icon: '✓',
    },
    warning: {
      border: 'border-amber-500/20',
      bg: 'bg-amber-500/[0.05]',
      text: 'text-amber-300',
      icon: '⚠',
    },
    error: {
      border: 'border-red-500/20',
      bg: 'bg-red-500/[0.05]',
      text: 'text-red-300',
      icon: '✕',
    },
  }
  const v = variants[variant]

  const handleDismiss = () => {
    setVisible(false)
    setTimeout(() => onDismiss?.(), 200)
  }

  return transitions((style, show) =>
    show && (
      <animated.div
        style={style}
        role="alert"
        className={cn(
          'relative flex items-start gap-3 rounded-xl border p-3 backdrop-blur-xl',
          v.border, v.bg,
          className,
        )}
      >
        <div className={cn('flex-shrink-0 mt-0.5 text-sm font-bold', v.text)}>
          {v.icon}
        </div>
        <div className="flex-1 min-w-0">
          {title && (
            <p className={cn('text-xs font-semibold mb-0.5', v.text)}>{title}</p>
          )}
          <div className="text-xs text-slate-300">{children}</div>
        </div>
        {dismissible && (
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        )}
      </animated.div>
    ),
  )
}

// ===========================================================================
// Premium Toast — glass + slide-in + auto-dismiss countdown
// ===========================================================================

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface PremiumToastData {
  id: string
  title: string
  description?: string
  variant?: ToastVariant
  duration?: number  // ms, default 5000
}

interface PremiumToastProps {
  toast: PremiumToastData
  onDismiss: (id: string) => void
}

export function PremiumToast({ toast, onDismiss }: PremiumToastProps) {
  const [progress, setProgress] = useState(100)
  const duration = toast.duration ?? 5000

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - start
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onDismiss(toast.id)
      }
    }, 50)
    return () => clearInterval(interval)
  }, [duration, onDismiss, toast.id])

  const variants = {
    info: { border: 'border-cyan-500/20', accent: 'from-cyan-500 to-blue-500', icon: 'ℹ' },
    success: { border: 'border-emerald-500/20', accent: 'from-emerald-500 to-cyan-500', icon: '✓' },
    warning: { border: 'border-amber-500/20', accent: 'from-amber-500 to-orange-500', icon: '⚠' },
    error: { border: 'border-red-500/20', accent: 'from-red-500 to-rose-500', icon: '✕' },
  }
  const v = variants[toast.variant ?? 'info']

  return (
    <animated.div
      className={cn(
        'relative w-full max-w-sm overflow-hidden rounded-xl border backdrop-blur-2xl',
        'bg-slate-950/80 shadow-2xl shadow-black/40',
        v.border,
      )}
    >
      {/* Accent bar */}
      <div className={cn('h-0.5 bg-gradient-to-r', v.accent)} />
      <div className="flex items-start gap-3 p-3">
        <div className={cn('flex-shrink-0 mt-0.5 text-sm font-bold bg-gradient-to-br bg-clip-text text-transparent', v.accent)}>
          {v.icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-slate-100">{toast.title}</p>
          {toast.description && (
            <p className="text-[11px] text-slate-400 mt-0.5">{toast.description}</p>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 text-slate-500 hover:text-slate-300 transition-colors text-xs"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
      {/* Countdown progress */}
      <div className="h-0.5 bg-white/5">
        <div
          className={cn('h-full bg-gradient-to-r transition-all duration-75', v.accent)}
          style={{ width: `${progress}%` }}
        />
      </div>
    </animated.div>
  )
}

// ===========================================================================
// Premium Toast Container — manages multiple toasts
// ===========================================================================

export function PremiumToastContainer({
  toasts,
  onDismiss,
}: {
  toasts: PremiumToastData[]
  onDismiss: (id: string) => void
}) {
  const transitions = useTransition(toasts, {
    from: { opacity: 0, transform: 'translateX(100%)' },
    enter: { opacity: 1, transform: 'translateX(0)' },
    leave: { opacity: 0, transform: 'translateX(120%)' },
    config: { tension: 300, friction: 26 },
    keys: (t) => t.id,
  })

  return (
    <div className="fixed bottom-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      <div className="flex flex-col gap-2 pointer-events-auto">
        {transitions((style, toast) => (
          <animated.div style={style}>
            <PremiumToast toast={toast} onDismiss={onDismiss} />
          </animated.div>
        ))}
      </div>
    </div>
  )
}

// ===========================================================================
// Premium Tooltip — glass + arrow + blur
// ===========================================================================

interface PremiumTooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  delay?: number  // ms
}

export function PremiumTooltip({ content, children, side = 'top', delay = 200 }: PremiumTooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<NodeJS.Timeout | null>(null)

  const show = () => {
    timer.current = setTimeout(() => setVisible(true), delay)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  return (
    <div className="relative inline-block" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div
          className={cn(
            'absolute z-50 pointer-events-none',
            'px-2.5 py-1.5 rounded-lg',
            'backdrop-blur-xl bg-slate-950/80 border border-white/[0.08]',
            'text-[11px] text-slate-200 whitespace-nowrap',
            'shadow-xl shadow-black/30',
            'animate-[tooltip-in_0.15s_ease-out]',
            positions[side],
          )}
        >
          {content}
          <style jsx>{`
            @keyframes tooltip-in {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}
    </div>
  )
}

// ===========================================================================
// Premium Switch — glass + spring physics
// ===========================================================================

interface PremiumSwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label?: string
  className?: string
}

export function PremiumSwitch({ checked, onChange, disabled, label, className }: PremiumSwitchProps) {
  const springs = useSpring({
    translate: checked ? 20 : 0,
    config: { tension: 400, friction: 25 },
  })

  return (
    <label className={cn('inline-flex items-center gap-2 cursor-pointer', disabled && 'opacity-50 cursor-not-allowed', className)}>
      {label && <span className="text-xs text-slate-300">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-11 h-6 rounded-full transition-colors duration-200',
          'backdrop-blur-xl border',
          checked
            ? 'bg-gradient-to-r from-emerald-500/80 to-cyan-500/80 border-emerald-400/30'
            : 'bg-white/[0.06] border-white/[0.08]',
        )}
      >
        <animated.div
          style={{ transform: springs.translate.to((t) => `translateX(${t}px)`) }}
          className={cn(
            'absolute top-0.5 left-0.5 w-5 h-5 rounded-full shadow-lg',
            checked
              ? 'bg-white shadow-emerald-500/30'
              : 'bg-slate-400 shadow-black/30',
          )}
        />
      </button>
    </label>
  )
}

// ===========================================================================
// Premium Avatar — glass + ring + status dot
// ===========================================================================

interface PremiumAvatarProps {
  src?: string
  alt?: string
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
  status?: 'online' | 'offline' | 'busy' | 'away'
  className?: string
}

export function PremiumAvatar({ src, alt, size = 'md', status, className }: PremiumAvatarProps) {
  const sizes = { xs: 20, sm: 28, md: 36, lg: 44, xl: 56 }
  const px = sizes[size]
  const statusColors = {
    online: 'bg-emerald-400',
    offline: 'bg-slate-500',
    busy: 'bg-red-400',
    away: 'bg-amber-400',
  }

  return (
    <div className={cn('relative inline-block', className)} style={{ width: px, height: px }}>
      <div
        className={cn(
          'w-full h-full rounded-full overflow-hidden',
          'backdrop-blur-xl border-2 border-white/10',
          'bg-gradient-to-br from-slate-700 to-slate-800',
        )}
      >
        {src ? (
          <img src={src} alt={alt} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs font-medium">
            {alt?.[0]?.toUpperCase() ?? '?'}
          </div>
        )}
      </div>
      {status && (
        <div
          className={cn(
            'absolute bottom-0 right-0 rounded-full border-2 border-slate-950',
            statusColors[status],
          )}
          style={{ width: px / 3, height: px / 3 }}
        />
      )}
    </div>
  )
}

// ===========================================================================
// Premium Skeleton — enhanced shimmer + pulse
// ===========================================================================

interface PremiumSkeletonProps {
  className?: string
  variant?: 'rect' | 'circle' | 'text'
  width?: string | number
  height?: string | number
}

export function PremiumSkeleton({ className, variant = 'rect', width, height }: PremiumSkeletonProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden',
        'backdrop-blur-sm bg-white/[0.03] border border-white/[0.04]',
        variant === 'circle' && 'rounded-full',
        variant === 'rect' && 'rounded-md',
        variant === 'text' && 'rounded',
        className,
      )}
      style={{ width, height }}
    >
      {/* Shimmer */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)',
          animation: 'skeleton-shimmer 2s linear infinite',
        }}
      />
      {/* Pulse */}
      <div
        className="absolute inset-0 bg-white/[0.02]"
        style={{ animation: 'skeleton-pulse 2s ease-in-out infinite' }}
      />
      <style jsx>{`
        @keyframes skeleton-shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes skeleton-pulse {
          0%, 100% { opacity: 0.5; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  )
}

// ===========================================================================
// Premium Button — magnetic + loading + icon animations
// ===========================================================================

interface PremiumButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'xs' | 'sm' | 'md' | 'lg'
  loading?: boolean
  icon?: ReactNode
  iconPosition?: 'left' | 'right'
  magnetic?: boolean
  magneticStrength?: number
  children?: ReactNode
}

export function PremiumButton({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  magnetic = true,
  magneticStrength = 0.25,
  children,
  className,
  disabled,
  ...props
}: PremiumButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [springs, api] = useSpring(() => ({
    x: 0, y: 0, scale: 1,
    config: { tension: 300, friction: 20 },
  }))

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (!magnetic || disabled || loading) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - (rect.left + rect.width / 2)
    const y = e.clientY - (rect.top + rect.height / 2)
    api.start({ x: x * magneticStrength, y: y * magneticStrength, scale: 1.03 })
  }

  const handleMouseLeave = () => {
    api.start({ x: 0, y: 0, scale: 1 })
  }

  const variants = {
    primary: 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40',
    secondary: 'backdrop-blur-xl bg-white/[0.06] text-slate-100 border border-white/[0.08] hover:bg-white/[0.1]',
    ghost: 'bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
    danger: 'bg-gradient-to-r from-red-500 to-rose-500 text-white shadow-lg shadow-red-500/25 hover:shadow-red-500/40',
    outline: 'bg-transparent text-slate-200 border border-white/[0.12] hover:bg-white/[0.04] hover:border-white/[0.2]',
  }

  const sizes = {
    xs: 'px-2 py-1 text-[10px] gap-1',
    sm: 'px-3 py-1.5 text-xs gap-1.5',
    md: 'px-4 py-2 text-sm gap-2',
    lg: 'px-6 py-3 text-base gap-2.5',
  }

  return (
    <animated.button
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      disabled={disabled || loading}
      style={springs}
      className={cn(
        'relative inline-flex items-center justify-center rounded-xl font-medium',
        'transition-all duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        'focus:outline-none focus:ring-2 focus:ring-emerald-500/30 focus:ring-offset-2 focus:ring-offset-slate-950',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <PremiumSpinner size="sm" variant="gradient" />
        </span>
      )}
      <span className={cn('inline-flex items-center gap-inherit', loading && 'opacity-0')}>
        {icon && iconPosition === 'left' && <span className="flex-shrink-0">{icon}</span>}
        {children}
        {icon && iconPosition === 'right' && <span className="flex-shrink-0">{icon}</span>}
      </span>
    </animated.button>
  )
}

// ===========================================================================
// Premium Dialog — glass + scale-in + backdrop blur
// ===========================================================================

interface PremiumDialogProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children?: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function PremiumDialog({
  open, onClose, title, description, children, footer, size = 'md',
}: PremiumDialogProps) {
  const sizes = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl' }

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const transitions = useTransition(open, {
    from: { opacity: 0 },
    enter: { opacity: 1 },
    leave: { opacity: 0 },
    config: { duration: 200 },
  })

  const panelTransitions = useTransition(open, {
    from: { opacity: 0, transform: 'scale(0.95) translateY(10px)' },
    enter: { opacity: 1, transform: 'scale(1) translateY(0)' },
    leave: { opacity: 0, transform: 'scale(0.95) translateY(10px)' },
    config: { tension: 300, friction: 26 },
  })

  return transitions((style, show) =>
    show && (
      <animated.div
        style={style}
        className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
          onClick={onClose}
        />
        {panelTransitions((panelStyle, panelShow) =>
          panelShow && (
            <animated.div
              style={panelStyle}
              className={cn(
                'relative w-full overflow-hidden rounded-2xl',
                'backdrop-blur-2xl bg-slate-950/80 border border-white/[0.08]',
                'shadow-2xl shadow-black/50',
                sizes[size],
              )}
            >
              {/* Edge highlight */}
              <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              {(title || description) && (
                <div className="p-5 border-b border-white/[0.06]">
                  {title && (
                    <h2 className="text-base font-semibold text-slate-100">{title}</h2>
                  )}
                  {description && (
                    <p className="text-xs text-slate-400 mt-1">{description}</p>
                  )}
                </div>
              )}
              {children && <div className="p-5">{children}</div>}
              {footer && (
                <div className="p-4 border-t border-white/[0.06] flex justify-end gap-2">
                  {footer}
                </div>
              )}
            </animated.div>
          ),
        )}
      </animated.div>
    ),
  )
}

// ===========================================================================
// Premium Popover — glass + arrow
// ===========================================================================

interface PremiumPopoverProps {
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

export function PremiumPopover({ trigger, children, side = 'bottom', className }: PremiumPopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  }

  const transitions = useTransition(open, {
    from: { opacity: 0, scale: 0.95 },
    enter: { opacity: 1, scale: 1 },
    leave: { opacity: 0, scale: 0.95 },
    config: { tension: 300, friction: 26 },
  })

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {transitions((style, show) =>
        show && (
          <animated.div
            style={style}
            className={cn(
              'absolute z-50 min-w-[200px] p-3 rounded-xl',
              'backdrop-blur-2xl bg-slate-950/80 border border-white/[0.08]',
              'shadow-2xl shadow-black/40',
              positions[side],
              className,
            )}
          >
            {children}
          </animated.div>
        ),
      )}
    </div>
  )
}

// ===========================================================================
// Premium Breadcrumbs — glass
// ===========================================================================

interface PremiumBreadcrumbsProps {
  items: Array<{ label: string; href?: string; icon?: ReactNode }>
  separator?: ReactNode
  className?: string
}

export function PremiumBreadcrumbs({ items, separator, className }: PremiumBreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn('inline-flex items-center', className)}>
      <div className="inline-flex items-center gap-1.5 rounded-lg backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] px-2.5 py-1.5">
        {items.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <span className="text-slate-600 text-xs">
                {separator ?? '›'}
              </span>
            )}
            <a
              href={item.href}
              className={cn(
                'inline-flex items-center gap-1 text-xs transition-colors',
                i === items.length - 1
                  ? 'text-slate-200 font-medium'
                  : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {item.icon}
              {item.label}
            </a>
          </Fragment>
        ))}
      </div>
    </nav>
  )
}

// ===========================================================================
// Premium Pagination — glass
// ===========================================================================

interface PremiumPaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  className?: string
}

export function PremiumPagination({ page, totalPages, onPageChange, className }: PremiumPaginationProps) {
  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1
    if (page <= 4) return i + 1
    if (page >= totalPages - 3) return totalPages - 6 + i
    return page - 3 + i
  })

  return (
    <div className={cn('inline-flex items-center gap-1 rounded-xl backdrop-blur-xl bg-white/[0.03] border border-white/[0.06] p-1', className)}>
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="px-2 py-1 rounded-md text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        ←
      </button>
      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={cn(
            'min-w-[28px] px-2 py-1 rounded-md text-xs font-medium transition-all',
            p === page
              ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:bg-white/5 hover:text-slate-200',
          )}
        >
          {p}
        </button>
      ))}
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="px-2 py-1 rounded-md text-xs text-slate-400 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
      >
        →
      </button>
    </div>
  )
}

// ===========================================================================
// Premium Dropdown Menu — glass + icons + animations
// ===========================================================================

interface PremiumDropdownProps {
  trigger: ReactNode
  items: Array<{
    label: string
    icon?: ReactNode
    onClick?: () => void
    danger?: boolean
    separator?: boolean
  }>
  align?: 'left' | 'right'
  className?: string
}

export function PremiumDropdown({ trigger, items, align = 'right', className }: PremiumDropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const transitions = useTransition(open, {
    from: { opacity: 0, y: -8, scale: 0.95 },
    enter: { opacity: 1, y: 0, scale: 1 },
    leave: { opacity: 0, y: -8, scale: 0.95 },
    config: { tension: 300, friction: 26 },
  })

  return (
    <div ref={ref} className={cn('relative inline-block', className)}>
      <div onClick={() => setOpen(!open)}>{trigger}</div>
      {transitions((style, show) =>
        show && (
          <animated.div
            style={style}
            className={cn(
              'absolute top-full mt-2 min-w-[180px] p-1.5 rounded-xl',
              'backdrop-blur-2xl bg-slate-950/80 border border-white/[0.08]',
              'shadow-2xl shadow-black/40 z-50',
              align === 'right' ? 'right-0' : 'left-0',
            )}
          >
            {items.map((item, i) => (
              item.separator ? (
                <div key={i} className="h-px bg-white/[0.06] my-1" />
              ) : (
                <button
                  key={i}
                  onClick={() => {
                    item.onClick?.()
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors',
                    item.danger
                      ? 'text-red-300 hover:bg-red-500/10'
                      : 'text-slate-300 hover:bg-white/5 hover:text-slate-100',
                  )}
                >
                  {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              )
            ))}
          </animated.div>
        ),
      )}
    </div>
  )
}

// ===========================================================================
// Hook: usePremiumToast — manage toast state
// ===========================================================================

export function usePremiumToast() {
  const [toasts, setToasts] = useState<PremiumToastData[]>([])

  const addToast = useCallback((toast: Omit<PremiumToastData, 'id'>) => {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { ...toast, id }])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = {
    success: (title: string, description?: string) => addToast({ title, description, variant: 'success' }),
    error: (title: string, description?: string) => addToast({ title, description, variant: 'error' }),
    warning: (title: string, description?: string) => addToast({ title, description, variant: 'warning' }),
    info: (title: string, description?: string) => addToast({ title, description, variant: 'info' }),
  }

  return { toasts, dismissToast, toast }
}
