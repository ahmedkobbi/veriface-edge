'use client'

/**
 * VeriFace Edge — Magnetic Button
 *
 * Premium button with magnetic hover effect using react-spring physics.
 */

import { useRef, type ReactNode, type MouseEvent } from 'react'
import { animated, useSpring } from '@react-spring/web'
import { cn } from '@/lib/utils'

interface MagneticButtonProps {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  magneticStrength?: number
}

export function MagneticButton({
  children,
  onClick,
  disabled,
  variant = 'primary',
  size = 'md',
  className,
  magneticStrength = 0.3,
}: MagneticButtonProps) {
  const ref = useRef<HTMLButtonElement>(null)

  const [springs, api] = useSpring(() => ({
    x: 0,
    y: 0,
    scale: 1,
    config: { tension: 300, friction: 20, mass: 0.5 },
  }))

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    if (disabled) return
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = e.clientX - (rect.left + rect.width / 2)
    const y = e.clientY - (rect.top + rect.height / 2)
    api.start({ x: x * magneticStrength, y: y * magneticStrength, scale: 1.05 })
  }

  const handleMouseLeave = () => {
    api.start({ x: 0, y: 0, scale: 1 })
  }

  const variants = {
    primary: 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white shadow-lg shadow-emerald-500/30 hover:shadow-emerald-500/50',
    secondary: 'bg-slate-800 text-slate-100 border border-slate-700 hover:bg-slate-700',
    ghost: 'bg-transparent text-slate-300 hover:bg-slate-800/50',
    danger: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-500/30',
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-5 py-2.5 text-sm',
    lg: 'px-7 py-3.5 text-base',
  }

  return (
    <animated.button
      ref={ref}
      onClick={onClick}
      disabled={disabled}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={springs}
      className={cn(
        'relative inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-colors duration-200',
        'disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none',
        'focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:ring-offset-2 focus:ring-offset-slate-950',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </animated.button>
  )
}
