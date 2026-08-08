/**
 * VeriFace Edge Mobile — Glass Design System
 *
 * Design tokens that match the web admin panel's glassmorphism aesthetic.
 * Colors, typography, spacing, shadows — all derived from the web theme.
 */

export type ThemeMode = 'dark' | 'light' | 'auto'

export interface Theme {
  mode: 'dark' | 'light'
  colors: {
    // Backgrounds
    bg: string
    bgGradientStart: string
    bgGradientEnd: string
    surface: string
    surfaceBlur: string // translucent overlay for glass effect
    surfaceBorder: string
    // Text
    text: string
    textSecondary: string
    textMuted: string
    // Brand
    primary: string
    primaryGradientStart: string
    primaryGradientEnd: string
    accent: string
    // Status
    success: string
    warning: string
    error: string
    info: string
    // Glass
    glassBg: string
    glassBorder: string
    glassHighlight: string
    // Tab bar
    tabBarBg: string
    tabBarBorder: string
    tabBarActive: string
    tabBarInactive: string
    // Header
    headerBg: string
    headerText: string
  }
  spacing: {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
  }
  radius: {
    sm: number
    md: number
    lg: number
    xl: number
    full: number
  }
  typography: {
    fontFamily: string
    fontMono: string
    sizes: {
      xs: number
      sm: number
      md: number
      lg: number
      xl: number
      xxl: number
      display: number
    }
    weights: {
      regular: '400'
      medium: '500'
      semibold: '600'
      bold: '700'
      extrabold: '800'
    }
  }
  shadows: {
    glass: {
      shadowColor: string
      shadowOffset: { width: number; height: number }
      shadowOpacity: number
      shadowRadius: number
      elevation: number
    }
    glow: {
      shadowColor: string
      shadowOffset: { width: number; height: number }
      shadowOpacity: number
      shadowRadius: number
      elevation: number
    }
  }
}

// ---------------------------------------------------------------------------
// Dark theme (default — matches web admin panel)
// ---------------------------------------------------------------------------

export const darkTheme: Theme = {
  mode: 'dark',
  colors: {
    bg: '#0f172a',
    bgGradientStart: '#0f172a',
    bgGradientEnd: '#1e1b4b',
    surface: '#1e293b',
    surfaceBlur: 'rgba(30, 41, 59, 0.6)',
    surfaceBorder: 'rgba(255, 255, 255, 0.06)',
    text: '#f1f5f9',
    textSecondary: '#94a3b8',
    textMuted: '#475569',
    primary: '#10b981',
    primaryGradientStart: '#10b981',
    primaryGradientEnd: '#06b6d4',
    accent: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
    info: '#06b6d4',
    glassBg: 'rgba(255, 255, 255, 0.03)',
    glassBorder: 'rgba(255, 255, 255, 0.06)',
    glassHighlight: 'rgba(255, 255, 255, 0.08)',
    tabBarBg: 'rgba(15, 23, 42, 0.8)',
    tabBarBorder: 'rgba(255, 255, 255, 0.06)',
    tabBarActive: '#10b981',
    tabBarInactive: '#475569',
    headerBg: 'rgba(15, 23, 42, 0.8)',
    headerText: '#f1f5f9',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
    xxl: 32,
  },
  radius: {
    sm: 6,
    md: 10,
    lg: 14,
    xl: 20,
    full: 9999,
  },
  typography: {
    fontFamily: 'System',
    fontMono: 'Menlo',
    sizes: {
      xs: 10,
      sm: 12,
      md: 14,
      lg: 16,
      xl: 20,
      xxl: 28,
      display: 40,
    },
    weights: {
      regular: '400',
      medium: '500',
      semibold: '600',
      bold: '700',
      extrabold: '800',
    },
  },
  shadows: {
    glass: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.15,
      shadowRadius: 12,
      elevation: 4,
    },
    glow: {
      shadowColor: '#10b981',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 16,
      elevation: 8,
    },
  },
}

// ---------------------------------------------------------------------------
// Light theme
// ---------------------------------------------------------------------------

export const lightTheme: Theme = {
  mode: 'light',
  colors: {
    bg: '#f8fafc',
    bgGradientStart: '#f8fafc',
    bgGradientEnd: '#e0f2fe',
    surface: '#ffffff',
    surfaceBlur: 'rgba(255, 255, 255, 0.7)',
    surfaceBorder: 'rgba(0, 0, 0, 0.06)',
    text: '#0f172a',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    primary: '#059669',
    primaryGradientStart: '#059669',
    primaryGradientEnd: '#0891b2',
    accent: '#0891b2',
    success: '#059669',
    warning: '#d97706',
    error: '#dc2626',
    info: '#0891b2',
    glassBg: 'rgba(255, 255, 255, 0.6)',
    glassBorder: 'rgba(0, 0, 0, 0.08)',
    glassHighlight: 'rgba(255, 255, 255, 0.8)',
    tabBarBg: 'rgba(248, 250, 252, 0.8)',
    tabBarBorder: 'rgba(0, 0, 0, 0.06)',
    tabBarActive: '#059669',
    tabBarInactive: '#94a3b8',
    headerBg: 'rgba(248, 250, 252, 0.8)',
    headerText: '#0f172a',
  },
  spacing: darkTheme.spacing,
  radius: darkTheme.radius,
  typography: darkTheme.typography,
  shadows: {
    glass: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    },
    glow: {
      shadowColor: '#059669',
      shadowOffset: { width: 0, height: 0 },
      shadowOpacity: 0.2,
      shadowRadius: 12,
      elevation: 6,
    },
  },
}

// ---------------------------------------------------------------------------
// Gradient presets (for LinearGradient)
// ---------------------------------------------------------------------------

export const gradients = {
  primary: ['#10b981', '#06b6d4'],
  primaryLight: ['#059669', '#0891b2'],
  danger: ['#ef4444', '#dc2626'],
  warning: ['#f59e0b', '#f97316'],
  info: ['#06b6d4', '#3b82f6'],
  purple: ['#a855f7', '#6366f1'],
  bgDark: ['#0f172a', '#1e1b4b'],
  bgLight: ['#f8fafc', '#e0f2fe'],
}

export type GlassVariant = 'default' | 'heavy' | 'medium' | 'light' | 'glow'
export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info'
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'
