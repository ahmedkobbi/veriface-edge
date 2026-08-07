'use client'

/**
 * VeriFace Edge — Custom Icon Set
 *
 * 24 custom SVG icons designed for biometric authentication concepts.
 * All icons share a consistent visual language:
 *   - 24x24 viewBox
 *   - 1.5px stroke width
 *   - Round line caps/joins
 *   - Current color fill (inherit from parent)
 */

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

const base = (props: IconProps) => ({
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export function FaceScanIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="10" r="3" />
      <path d="M7 18c0-3 2-5 5-5s5 2 5 5" />
      <line x1="4" y1="13" x2="20" y2="13" strokeDasharray="2 2" opacity="0.5" />
    </svg>
  )
}

export function ShieldLockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2 L20 6 L20 13 C20 17 16 21 12 22 C8 21 4 17 4 13 L4 6 Z" />
      <rect x="9" y="11" width="6" height="5" rx="1" />
      <path d="M10 11 V9 a2 2 0 0 1 4 0 V11" />
    </svg>
  )
}

export function PulseIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12 H6 L8 6 L12 18 L14 12 L16 14 L18 12 H22" />
    </svg>
  )
}

export function FingerprintIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 4a8 8 0 0 0-8 8v4" />
      <path d="M12 4a8 8 0 0 1 8 8v4" />
      <path d="M8 12a4 4 0 0 1 8 0v2" />
      <path d="M12 12v6" />
      <path d="M6 16v0" />
      <path d="M18 16v0" />
    </svg>
  )
}

export function ScanIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2" />
      <path d="M16 4h2a2 2 0 0 1 2 2v2" />
      <path d="M20 16v2a2 2 0 0 1-2 2h-2" />
      <path d="M8 20H6a2 2 0 0 1-2-2v-2" />
      <line x1="4" y1="12" x2="20" y2="12" />
    </svg>
  )
}

export function KeyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="15" r="4" />
      <path d="M10.5 12.5 L20 3" />
      <path d="M16 7 L18 9" />
      <path d="M18 5 L20 7" />
    </svg>
  )
}

export function LockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  )
}

export function UnlockIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11 V7 a4 4 0 0 1 7.5-2" />
      <circle cx="12" cy="16" r="1" fill="currentColor" />
    </svg>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12 L11 15 L16 9" />
    </svg>
  )
}

export function XCircleIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9 L15 15" />
      <path d="M15 9 L9 15" />
    </svg>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 L22 20 H2 Z" />
      <line x1="12" y1="10" x2="12" y2="14" />
      <circle cx="12" cy="17" r="0.5" fill="currentColor" />
    </svg>
  )
}

export function InfoIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    </svg>
  )
}

export function EyeIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12 C5 7 8 5 12 5 C16 5 19 7 22 12 C19 17 16 19 12 19 C8 19 5 17 2 12 Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export function ZapIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M13 2 L4 14 H11 L11 22 L20 10 H13 Z" />
    </svg>
  )
}

export function CpuIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <line x1="9" y1="3" x2="9" y2="6" />
      <line x1="15" y1="3" x2="15" y2="6" />
      <line x1="9" y1="18" x2="9" y2="21" />
      <line x1="15" y1="18" x2="15" y2="21" />
      <line x1="3" y1="9" x2="6" y2="9" />
      <line x1="3" y1="15" x2="6" y2="15" />
      <line x1="18" y1="9" x2="21" y2="9" />
      <line x1="18" y1="15" x2="21" y2="15" />
    </svg>
  )
}

export function RadioIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <path d="M8.5 8.5 a5 5 0 0 0 0 7" />
      <path d="M15.5 8.5 a5 5 0 0 1 0 7" />
      <path d="M5 5 a10 10 0 0 0 0 14" />
      <path d="M19 5 a10 10 0 0 1 0 14" />
    </svg>
  )
}

export function ActivityIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 12 H6 L8 6 L12 18 L14 12 L16 14 L18 12 H22" />
    </svg>
  )
}

export function UserPlusIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20 c0-4 3-6 6-6 s6 2 6 6" />
      <line x1="18" y1="9" x2="18" y2="15" />
      <line x1="15" y1="12" x2="21" y2="12" />
    </svg>
  )
}

export function LogInIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4 H18 a2 2 0 0 1 2 2 V18 a2 2 0 0 1-2 2 H14" />
      <path d="M10 12 H2" />
      <path d="M6 8 L2 12 L6 16" />
    </svg>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 7 H20" />
      <path d="M9 7 V5 a1 1 0 0 1 1-1 H14 a1 1 0 0 1 1 1 V7" />
      <path d="M6 7 L7 20 a1 1 0 0 0 1 1 H16 a1 1 0 0 0 1-1 L18 7" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 V15" />
      <path d="M8 11 L12 15 L16 11" />
      <path d="M4 17 V19 a2 2 0 0 0 2 2 H18 a2 2 0 0 0 2-2 V17" />
    </svg>
  )
}

export function RefreshIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 12 a8 8 0 0 1 14-5" />
      <path d="M20 12 a8 8 0 0 1-14 5" />
      <path d="M18 3 V7 H14" />
      <path d="M6 21 V17 H10" />
    </svg>
  )
}

export function CommandIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6 a3 3 0 1 0-3 3 H18 a3 3 0 1 0-3-3 V18 a3 3 0 1 0 3-3 H6 a3 3 0 1 0 3 3 Z" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2 V5" />
      <path d="M12 19 V22" />
      <path d="M2 12 H5" />
      <path d="M19 12 H22" />
      <path d="M5 5 L7 7" />
      <path d="M17 17 L19 19" />
      <path d="M19 5 L17 7" />
      <path d="M7 17 L5 19" />
    </svg>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="5" y1="5" x2="7" y2="7" />
      <line x1="17" y1="17" x2="19" y2="19" />
      <line x1="19" y1="5" x2="17" y2="7" />
      <line x1="7" y1="17" x2="5" y2="19" />
    </svg>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M21 12.8 A9 9 0 1 1 11.2 3 A7 7 0 0 0 21 12.8 Z" />
    </svg>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15 H4 a1 1 0 0 1-1-1 V4 a1 1 0 0 1 1-1 H14 a1 1 0 0 1 1 1 V5" />
    </svg>
  )
}

export function SparklesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 L13.5 9 L20 10.5 L13.5 12 L12 18 L10.5 12 L4 10.5 L10.5 9 Z" />
      <path d="M19 3 V6" />
      <path d="M17.5 4.5 H20.5" />
      <path d="M5 17 V19" />
      <path d="M4 18 H6" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Logo Components
// ---------------------------------------------------------------------------

export function VeriFaceLogo({
  size = 32,
  variant = 'color',
  className,
}: {
  size?: number
  variant?: 'color' | 'mono' | 'white'
  className?: string
}) {
  const gradientId = `vf-logo-grad-${variant}-${size}`
  const colors = {
    color: { start: '#10b981', mid: '#06b6d4', end: '#3b82f6' },
    mono: { start: 'currentColor', mid: 'currentColor', end: 'currentColor' },
    white: { start: '#ffffff', mid: '#ffffff', end: '#ffffff' },
  }
  const c = colors[variant]

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      role="img"
      aria-label="VeriFace Edge logo"
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={c.start} />
          <stop offset="50%" stopColor={c.mid} />
          <stop offset="100%" stopColor={c.end} />
        </linearGradient>
      </defs>
      <path d="M32 2 L58 16 L58 42 L32 62 L6 42 L6 16 Z" fill={`url(#${gradientId})`} opacity="0.15" />
      <path d="M32 2 L58 16 L58 42 L32 62 L6 42 L6 16 Z" stroke={`url(#${gradientId})`} strokeWidth="2" strokeLinejoin="round" />
      <path d="M32 10 L50 20 L50 38 L32 52 L14 38 L14 20 Z" stroke={`url(#${gradientId})`} strokeWidth="1" strokeLinejoin="round" opacity="0.4" />
      <ellipse cx="32" cy="28" rx="8" ry="9" fill={`url(#${gradientId})`} opacity="0.5" />
      <path d="M20 48 Q20 38 32 38 Q44 38 44 48" fill={`url(#${gradientId})`} opacity="0.5" />
      <line x1="14" y1="34" x2="50" y2="34" stroke={`url(#${gradientId})`} strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14" cy="34" r="1.5" fill={c.start} />
      <circle cx="50" cy="34" r="1.5" fill={c.end} />
      <rect x="29" y="44" width="6" height="5" rx="1" fill={`url(#${gradientId})`} />
      <path d="M30 44 V42 Q30 40 32 40 Q34 40 34 42 V44" stroke={`url(#${gradientId})`} strokeWidth="1" fill="none" />
    </svg>
  )
}

export function VeriFaceLogoFull({
  size = 32,
  variant = 'color',
  className,
}: {
  size?: number
  variant?: 'color' | 'mono' | 'white'
  className?: string
}) {
  return (
    <div className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <VeriFaceLogo size={size} variant={variant} />
      <div className="flex flex-col leading-none">
        <span className={`text-base font-bold tracking-tight ${
          variant === 'white' ? 'text-white' :
          variant === 'mono' ? 'text-slate-100' :
          'bg-gradient-to-r from-slate-100 to-slate-400 bg-clip-text text-transparent'
        }`}>
          VeriFace
        </span>
        <span className="text-[9px] font-medium tracking-[0.2em] text-slate-500 mt-0.5">
          EDGE
        </span>
      </div>
    </div>
  )
}
