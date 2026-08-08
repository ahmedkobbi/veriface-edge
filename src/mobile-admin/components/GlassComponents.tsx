/**
 * VeriFace Edge Mobile — Glass Components
 *
 * Premium glassmorphism UI components matching the web admin panel.
 *
 * Components:
 *   - GlassCard       — translucent card with blur + border + shadow
 *   - GlassButton     — gradient button with glow + haptic feedback
 *   - GlassBadge      — translucent badge with color variants
 *   - GlassStatCard   — stat display with icon + glow
 *   - GlassInput      — text input with glass background
 *   - PremiumSpinner  — animated pulse loader
 *   - GlassModal      — modal with blur overlay
 *   - GlassToast      — toast notification (replaces Alert.alert)
 *   - GradientBg      — animated gradient background
 *   - GlassSwitch     — themed switch
 */

import React, { useState, useEffect, useRef } from 'react'
import {
  View, Text, TouchableOpacity, TextInput, Modal,
  ActivityIndicator, StyleSheet, Animated, Easing,
  Switch, Platform, Dimensions, ViewStyle, TextStyle,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../theme/ThemeContext'
import {
  type Theme, type GlassVariant, type BadgeVariant,
  type ButtonVariant, type ButtonSize, gradients,
} from '../theme/theme'

const { width: SCREEN_WIDTH } = Dimensions.get('window')

// ===========================================================================
// GlassCard — translucent card with blur + border + shadow
// ===========================================================================

interface GlassCardProps {
  children: React.ReactNode
  variant?: GlassVariant
  style?: ViewStyle | ViewStyle[]
  onPress?: () => void
  glowColor?: string
}

export function GlassCard({ children, variant = 'default', style, onPress, glowColor }: GlassCardProps) {
  const { theme } = useTheme()

  const opacity = {
    default: 0.03,
    light: 0.02,
    medium: 0.04,
    heavy: 0.06,
    glow: 0.05,
  }

  const cardStyle: ViewStyle = {
    backgroundColor: theme.mode === 'dark'
      ? `rgba(255, 255, 255, ${opacity[variant]})`
      : `rgba(255, 255, 255, ${opacity[variant] + 0.4})`,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.glassBorder,
    padding: theme.spacing.lg,
    ...theme.shadows.glass,
    ...(variant === 'glow' && glowColor ? {
      ...theme.shadows.glow,
      shadowColor: glowColor,
    } : {}),
  }

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
          onPress()
        }}
        style={[cardStyle, style]}
      >
        {children}
      </TouchableOpacity>
    )
  }

  return <View style={[cardStyle, style]}>{children}</View>
}

// ===========================================================================
// GlassButton — gradient button with glow + haptic
// ===========================================================================

interface GlassButtonProps {
  children: React.ReactNode
  onPress: () => void | Promise<void>
  variant?: ButtonVariant
  size?: ButtonSize
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  style?: ViewStyle | ViewStyle[]
}

export function GlassButton({
  children, onPress, variant = 'primary', size = 'md',
  disabled, loading, icon, style,
}: GlassButtonProps) {
  const { theme } = useTheme()
  const [pressing, setPressing] = useState(false)
  const scale = useRef(new Animated.Value(1)).current

  const sizes = {
    sm: { paddingVertical: 8, paddingHorizontal: 14, fontSize: 12 },
    md: { paddingVertical: 12, paddingHorizontal: 20, fontSize: 14 },
    lg: { paddingVertical: 16, paddingHorizontal: 28, fontSize: 16 },
  }

  const handlePress = () => {
    if (disabled || loading) return
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    onPress()
  }

  const handlePressIn = () => {
    setPressing(true)
    Animated.spring(scale, {
      toValue: 0.96,
      useNativeDriver: true,
      friction: 8,
    }).start()
  }

  const handlePressOut = () => {
    setPressing(false)
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
    }).start()
  }

  const getBackground = () => {
    if (variant === 'primary') return gradients.primary
    if (variant === 'danger') return gradients.danger
    return null // ghost/secondary use solid colors
  }

  const bg = getBackground()

  return (
    <Animated.View style={{ transform: [{ scale }], ...style }}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        activeOpacity={0.8}
      >
        {bg ? (
          <LinearGradient
            colors={bg}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[
              styles.button,
              sizes[size],
              { overflow: 'hidden' },
              variant === 'primary' ? theme.shadows.glow : {},
              disabled && { opacity: 0.4 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {icon}
                <Text style={[styles.buttonText, { fontSize: sizes[size].fontSize }]}>
                  {children}
                </Text>
              </View>
            )}
          </LinearGradient>
        ) : (
          <View
            style={[
              styles.button,
              sizes[size],
              {
                backgroundColor: variant === 'secondary'
                  ? theme.colors.glassHighlight
                  : 'transparent',
                borderWidth: variant === 'secondary' ? 1 : 0,
                borderColor: theme.colors.glassBorder,
              },
              disabled && { opacity: 0.4 },
            ]}
          >
            {loading ? (
              <ActivityIndicator color={theme.colors.primary} size="small" />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {icon}
                <Text style={[styles.buttonText, {
                  fontSize: sizes[size].fontSize,
                  color: variant === 'ghost' ? theme.colors.textSecondary : theme.colors.text,
                }]}>
                  {children}
                </Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  )
}

// ===========================================================================
// GlassBadge — translucent badge with color variants
// ===========================================================================

interface GlassBadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  size?: 'sm' | 'md'
}

export function GlassBadge({ children, variant = 'default', size = 'sm' }: GlassBadgeProps) {
  const { theme } = useTheme()

  const colors: Record<BadgeVariant, { bg: string; text: string; border: string }> = {
    default: { bg: 'rgba(148, 163, 184, 0.15)', text: theme.colors.textSecondary, border: 'rgba(148, 163, 184, 0.2)' },
    success: { bg: 'rgba(16, 185, 129, 0.15)', text: theme.colors.success, border: 'rgba(16, 185, 129, 0.25)' },
    warning: { bg: 'rgba(245, 158, 11, 0.15)', text: theme.colors.warning, border: 'rgba(245, 158, 11, 0.25)' },
    error: { bg: 'rgba(239, 68, 68, 0.15)', text: theme.colors.error, border: 'rgba(239, 68, 68, 0.25)' },
    info: { bg: 'rgba(6, 182, 212, 0.15)', text: theme.colors.info, border: 'rgba(6, 182, 212, 0.25)' },
  }

  const c = colors[variant]
  const fontSize = size === 'sm' ? 10 : 12
  const padding = size === 'sm' ? 4 : 6

  return (
    <View style={{
      backgroundColor: c.bg,
      borderColor: c.border,
      borderWidth: 1,
      borderRadius: theme.radius.full,
      paddingHorizontal: padding + 4,
      paddingVertical: padding - 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    }}>
      <Text style={{
        color: c.text,
        fontSize,
        fontWeight: theme.typography.weights.semibold,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
      }}>
        {children}
      </Text>
    </View>
  )
}

// ===========================================================================
// GlassStatCard — stat display with value + label
// ===========================================================================

interface GlassStatCardProps {
  label: string
  value: string | number
  color?: string
  icon?: React.ReactNode
}

export function GlassStatCard({ label, value, color, icon }: GlassStatCardProps) {
  const { theme } = useTheme()

  return (
    <GlassCard variant="medium" style={{ flex: 1, minWidth: '45%', padding: theme.spacing.md + 2 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        {icon}
        <Text style={{
          color: theme.colors.textMuted,
          fontSize: theme.typography.sizes.xs,
          fontWeight: theme.typography.weights.medium,
        }}>
          {label}
        </Text>
      </View>
      <Text style={{
        color: color || theme.colors.text,
        fontSize: theme.typography.sizes.xxl,
        fontWeight: theme.typography.weights.extrabold,
      }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </Text>
    </GlassCard>
  )
}

// ===========================================================================
// GlassInput — text input with glass background
// ===========================================================================

interface GlassInputProps {
  value: string
  onChangeText: (text: string) => void
  placeholder?: string
  secureTextEntry?: boolean
  keyboardType?: 'default' | 'email-address' | 'number-pad'
  autoComplete?: string
  autoCapitalize?: 'none' | 'sentences' | 'words'
  maxLength?: number
  style?: ViewStyle | ViewStyle[]
  textAlign?: 'left' | 'center'
}

export function GlassInput({
  value, onChangeText, placeholder, secureTextEntry,
  keyboardType, autoComplete, autoCapitalize, maxLength, style, textAlign = 'left',
}: GlassInputProps) {
  const { theme } = useTheme()

  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={theme.colors.textMuted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      autoComplete={autoComplete as any}
      autoCapitalize={autoCapitalize || 'none'}
      maxLength={maxLength}
      textAlign={textAlign}
      style={[
        {
          backgroundColor: theme.colors.glassBg,
          borderWidth: 1,
          borderColor: theme.colors.glassBorder,
          borderRadius: theme.radius.md,
          padding: 14,
          color: theme.colors.text,
          fontSize: theme.typography.sizes.md,
          fontFamily: textAlign === 'center' ? theme.typography.fontMono : theme.typography.fontFamily,
        },
        style,
      ]}
    />
  )
}

// ===========================================================================
// PremiumSpinner — animated pulse loader
// ===========================================================================

export function PremiumSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const { theme } = useTheme()
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(0.5)).current

  const sizes = { sm: 20, md: 32, lg: 48, xl: 64 }

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, { toValue: 1.2, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
          Animated.timing(scale, { toValue: 1, duration: 600, useNativeDriver: true, easing: Easing.inOut(Easing.ease) }),
        ]),
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.5, duration: 600, useNativeDriver: true }),
        ]),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [])

  return (
    <View style={{ justifyContent: 'center', alignItems: 'center' }}>
      <Animated.View
        style={{
          width: sizes[size],
          height: sizes[size],
          borderRadius: sizes[size] / 2,
          borderWidth: 3,
          borderColor: theme.colors.primary,
          borderTopColor: 'transparent',
          transform: [{ scale }],
          opacity,
        }}
      />
    </View>
  )
}

// ===========================================================================
// GlassModal — modal with blur overlay
// ===========================================================================

interface GlassModalProps {
  visible: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

export function GlassModal({ visible, onClose, title, children }: GlassModalProps) {
  const { theme } = useTheme()

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={{
        flex: 1,
        justifyContent: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        padding: 24,
      }}>
        <BlurView
          intensity={40}
          tint={theme.mode}
          style={{
            borderRadius: theme.radius.xl,
            borderWidth: 1,
            borderColor: theme.colors.glassBorder,
            padding: 24,
            ...theme.shadows.glass,
          }}
        >
          <Text style={{
            color: theme.colors.text,
            fontSize: theme.typography.sizes.lg,
            fontWeight: theme.typography.weights.bold,
            marginBottom: theme.spacing.md,
          }}>
            {title}
          </Text>
          {children}
        </BlurView>
      </View>
    </Modal>
  )
}

// ===========================================================================
// GlassToast — toast notification (replaces Alert.alert)
// ===========================================================================

type ToastVariant = 'success' | 'error' | 'warning' | 'info'

interface ToastState {
  visible: boolean
  message: string
  variant: ToastVariant
}

let toastCallback: ((state: ToastState) => void) | null = null

export function showToast(message: string, variant: ToastVariant = 'info') {
  if (toastCallback) {
    toastCallback({ visible: true, message, variant })
    setTimeout(() => {
      if (toastCallback) toastCallback({ visible: false, message: '', variant: 'info' })
    }, 3000)
  }
}

export function GlassToastContainer() {
  const { theme } = useTheme()
  const [state, setState] = useState<ToastState({ visible: false, message: '', variant: 'info' })
  const slideAnim = useRef(new Animated.Value(-100)).current

  useEffect(() => {
    toastCallback = (s) => {
      setState(s)
      if (s.visible) {
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          friction: 8,
        }).start()
      } else {
        Animated.timing(slideAnim, {
          toValue: -100,
          duration: 300,
          useNativeDriver: true,
        }).start()
      }
    }
    return () => { toastCallback = null }
  }, [])

  if (!state.visible && slideAnim._value === -100) return null

  const colors: Record<ToastVariant, string> = {
    success: theme.colors.success,
    error: theme.colors.error,
    warning: theme.colors.warning,
    info: theme.colors.info,
  }

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 50,
        left: 16,
        right: 16,
        transform: [{ translateY: slideAnim }],
        zIndex: 9999,
      }}
    >
      <BlurView
        intensity={30}
        tint={theme.mode}
        style={{
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: colors[state.variant] + '40',
          padding: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          ...theme.shadows.glass,
        }}
      >
        <View style={{
          width: 8, height: 8, borderRadius: 4,
          backgroundColor: colors[state.variant],
        }} />
        <Text style={{
          color: theme.colors.text,
          fontSize: theme.typography.sizes.sm,
          flex: 1,
        }}>
          {state.message}
        </Text>
      </BlurView>
    </Animated.View>
  )
}

// ===========================================================================
// GradientBg — animated gradient background (behind all screens)
// ===========================================================================

export function GradientBg({ children }: { children: React.ReactNode }) {
  const { theme, isDark } = useTheme()
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start()
  }, [isDark])

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <LinearGradient
        colors={isDark ? gradients.bgDark : gradients.bgLight}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={{ flex: 1 }}
      >
        {children}
      </LinearGradient>
    </Animated.View>
  )
}

// ===========================================================================
// GlassSwitch — themed switch
// ===========================================================================

export function GlassSwitch({
  value, onValueChange,
}: {
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  const { theme } = useTheme()

  return (
    <Switch
      value={value}
      onValueChange={(v) => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onValueChange(v)
      }}
      trackColor={{
        false: theme.colors.glassHighlight,
        true: theme.colors.primary,
      }}
      thumbColor="#fff"
      ios_backgroundColor={theme.colors.glassHighlight}
    />
  )
}

// ===========================================================================
// Styles
// ===========================================================================

const styles = StyleSheet.create({
  button: {
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
})
