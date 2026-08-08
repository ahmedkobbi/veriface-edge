/**
 * VeriFace Edge Mobile — Auth Screen (Glassmorphism Edition)
 */

import React, { useState } from 'react'
import {
  View, Text, KeyboardAvoidingView, Platform, Alert,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { LinearGradient } from 'expo-linear-gradient'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassInput, GlassButton, PremiumSpinner, showToast } from '../components/GlassComponents'

interface Props {
  onLogin: (email: string, password: string, twoFactorCode?: string) => Promise<any>
}

export function AuthScreen({ onLogin }: Props) {
  const { theme } = useTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [twoFactorMethods, setTwoFactorMethods] = useState<{ totp: boolean; webauthn: boolean } | null>(null)

  const handleLogin = async () => {
    if (!email || !password) {
      showToast('Please enter email and password', 'warning')
      return
    }
    setLoading(true)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

    try {
      const result = await onLogin(email, password, requiresTwoFactor ? twoFactorCode : undefined)
      if (result.requiresTwoFactor) {
        setRequiresTwoFactor(true)
        setTwoFactorMethods(result.methods)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      }
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      showToast(e.message || 'Login failed', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, justifyContent: 'center', padding: 32 }}
    >
      <View style={{ alignItems: 'center', marginBottom: 40 }}>
        <LinearGradient
          colors={['#10b981', '#06b6d4']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{
            width: 64, height: 64, borderRadius: 16,
            justifyContent: 'center', alignItems: 'center',
            ...theme.shadows.glow,
          }}
        >
          <Text style={{ fontSize: 32 }}>🔐</Text>
        </LinearGradient>
        <Text style={{
          fontSize: 28, fontWeight: '700',
          color: theme.colors.primary,
          marginTop: 16, marginBottom: 4,
        }}>
          VeriFace Edge
        </Text>
        <Text style={{ fontSize: 14, color: theme.colors.textSecondary }}>
          Admin Console
        </Text>
      </View>

      <GlassCard variant="heavy" style={{ padding: 20 }}>
        <View style={{ gap: 12 }}>
          <GlassInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            keyboardType="email-address"
            autoComplete="email"
          />

          <GlassInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            autoComplete="password"
          />

          {requiresTwoFactor && (
            <>
              <Text style={{
                color: theme.colors.textSecondary, fontSize: 12,
                textAlign: 'center', marginTop: 4,
              }}>
                {twoFactorMethods?.webauthn
                  ? 'Enter 6-digit code or use hardware key'
                  : 'Enter 6-digit code from your authenticator app'}
              </Text>
              <GlassInput
                value={twoFactorCode}
                onChangeText={setTwoFactorCode}
                placeholder="000000"
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
              />
            </>
          )}

          <GlassButton
            onPress={handleLogin}
            loading={loading}
            variant="primary"
            size="lg"
            style={{ marginTop: 4 }}
          >
            {requiresTwoFactor ? 'Verify' : 'Sign In'}
          </GlassButton>
        </View>
      </GlassCard>

      <Text style={{
        color: theme.colors.textMuted, fontSize: 11,
        textAlign: 'center', marginTop: 40, paddingHorizontal: 20,
      }}>
        🔒 All data encrypted in transit. Biometric auth required on next launch.
      </Text>
    </KeyboardAvoidingView>
  )
}
