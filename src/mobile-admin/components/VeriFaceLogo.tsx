/**
 * VeriFace Edge Mobile — Brand Logo Component
 *
 * Renders the VeriFace Edge logo as a React component (no image files needed).
 * Uses SVG paths for crisp rendering at any size.
 *
 * Variants:
 *   - 'full'     — Logo mark + wordmark ("VeriFace Edge")
 *   - 'mark'     — Just the logo mark (shield + face scan)
 *   - 'icon'     — Compact icon (for tab headers, avatars)
 *   - 'splash'   — Large splash screen variant
 *
 * Colors:
 *   - Uses theme colors (adapts to dark/light)
 *   - Gradient: #10b981 → #06b6d4 (brand primary)
 */

import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../theme/ThemeContext'

type LogoVariant = 'full' | 'mark' | 'icon' | 'splash'

interface LogoProps {
  variant?: LogoVariant
  size?: number
  showText?: boolean
  textColor?: string
}

export function VeriFaceLogo({ variant = 'full', size = 40, showText = true, textColor }: LogoProps) {
  const { theme } = useTheme()
  const color = textColor || theme.colors.text

  if (variant === 'splash') {
    return <SplashLogo />
  }

  if (variant === 'icon') {
    return <LogoMark size={size} theme={theme} />
  }

  if (variant === 'mark') {
    return <LogoMark size={size} theme={theme} />
  }

  // Full: mark + wordmark
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <LogoMark size={size} theme={theme} />
      {showText && (
        <View>
          <Text style={[styles.wordmark, { color, fontSize: size * 0.4 }]}>
            VeriFace
            <Text style={{ color: theme.colors.primary }}> Edge</Text>
          </Text>
        </View>
      )}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Logo Mark — shield + face scan lines
// ---------------------------------------------------------------------------

function LogoMark({ size, theme }: { size: number; theme: any }) {
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size * 0.22,
      overflow: 'hidden',
      ...theme.shadows.glow,
    }}>
      <LinearGradient
        colors={['#10b981', '#06b6d4']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{
          width: '100%',
          height: '100%',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        {/* Shield outline */}
        <View style={{
          width: size * 0.55,
          height: size * 0.65,
          borderRadius: size * 0.08,
          borderWidth: size * 0.06,
          borderColor: 'rgba(255, 255, 255, 0.95)',
          borderBottomLeftRadius: size * 0.2,
          borderBottomRightRadius: size * 0.2,
          borderTopWidth: 0,
          justifyContent: 'center',
          alignItems: 'center',
        }}>
          {/* Face scan circle */}
          <View style={{
            width: size * 0.22,
            height: size * 0.22,
            borderRadius: size * 0.11,
            borderWidth: size * 0.035,
            borderColor: 'rgba(255, 255, 255, 0.9)',
            marginBottom: size * 0.04,
          }} />
          {/* Scan lines */}
          <View style={{
            width: size * 0.3,
            height: size * 0.02,
            backgroundColor: 'rgba(255, 255, 255, 0.6)',
            borderRadius: size * 0.01,
            marginBottom: size * 0.02,
          }} />
          <View style={{
            width: size * 0.25,
            height: size * 0.02,
            backgroundColor: 'rgba(255, 255, 255, 0.4)',
            borderRadius: size * 0.01,
          }} />
        </View>
      </LinearGradient>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Splash Logo — large centered logo with gradient background
// ---------------------------------------------------------------------------

function SplashLogo() {
  const { theme } = useTheme()

  return (
    <View style={splashStyles.container}>
      <LinearGradient
        colors={['#0f172a', '#1e1b4b']}
        style={splashStyles.background}
      >
        {/* Glow effect */}
        <View style={splashStyles.glow} />

        {/* Logo */}
        <LogoMark size={100} theme={theme} />

        {/* Wordmark */}
        <Text style={splashStyles.title}>
          VeriFace
          <Text style={{ color: '#10b981' }}> Edge</Text>
        </Text>
        <Text style={splashStyles.subtitle}>Admin Console</Text>

        {/* Tagline */}
        <Text style={splashStyles.tagline}>
          Privacy-First Facial Authentication
        </Text>

        {/* Loading */}
        <View style={splashStyles.loaderContainer}>
          <View style={splashStyles.loaderBar} />
        </View>
      </LinearGradient>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Brand Icon — for notification + small contexts
// ---------------------------------------------------------------------------

export function BrandIcon({ size = 24, color = '#10b981' }: { size?: number; color?: string }) {
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size * 0.22,
      backgroundColor: color,
      justifyContent: 'center',
      alignItems: 'center',
    }}>
      {/* Mini shield */}
      <View style={{
        width: size * 0.5,
        height: size * 0.6,
        borderTopLeftRadius: size * 0.05,
        borderTopRightRadius: size * 0.05,
        borderBottomLeftRadius: size * 0.18,
        borderBottomRightRadius: size * 0.18,
        borderWidth: size * 0.06,
        borderColor: 'rgba(255, 255, 255, 0.9)',
        borderTopWidth: 0,
      }}>
        {/* Face dot */}
        <View style={{
          width: size * 0.16,
          height: size * 0.16,
          borderRadius: size * 0.08,
          borderWidth: size * 0.03,
          borderColor: 'rgba(255, 255, 255, 0.8)',
          alignSelf: 'center',
          marginTop: size * 0.08,
        }} />
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  wordmark: {
    fontWeight: '700',
    letterSpacing: -0.5,
  },
})

const splashStyles = StyleSheet.create({
  container: {
    flex: 1,
  },
  background: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  glow: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    top: '30%',
    alignSelf: 'center',
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#f1f5f9',
    marginTop: 24,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#64748b',
    marginTop: 4,
    fontWeight: '500',
  },
  tagline: {
    fontSize: 12,
    color: '#475569',
    marginTop: 24,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
  loaderContainer: {
    position: 'absolute',
    bottom: 80,
    width: 120,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 1.5,
    overflow: 'hidden',
  },
  loaderBar: {
    width: '40%',
    height: '100%',
    backgroundColor: '#10b981',
    borderRadius: 1.5,
  },
})
