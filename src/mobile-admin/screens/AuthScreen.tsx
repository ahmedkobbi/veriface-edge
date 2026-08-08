/**
 * VeriFace Edge Mobile — Auth Screen
 *
 * Login with email + password + 2FA (TOTP or WebAuthn).
 *
 * Security:
 *   - Password field is secure (masked)
 *   - 2FA code field auto-advances (6 digits)
 *   - Session stored in SecureStore after successful login
 *   - Biometric authentication prompt on next launch
 */

import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, Alert, ActivityIndicator,
} from 'react-native'
import * as Haptics from 'expo-haptics'

interface Props {
  onLogin: (email: string, password: string, twoFactorCode?: string) => Promise<any>
}

export function AuthScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [requiresTwoFactor, setRequiresTwoFactor] = useState(false)
  const [twoFactorMethods, setTwoFactorMethods] = useState<{ totp: boolean; webauthn: boolean } | null>(null)

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter email and password')
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
      Alert.alert('Login Failed', e.message || 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.content}>
        <Text style={styles.logo}>VeriFace Edge</Text>
        <Text style={styles.subtitle}>Admin Console</Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#475569"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#475569"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
          />

          {requiresTwoFactor && (
            <>
              <Text style={styles.twoFactorLabel}>
                {twoFactorMethods?.webauthn
                  ? 'Enter 6-digit code or use hardware key'
                  : 'Enter 6-digit code from your authenticator app'}
              </Text>
              <TextInput
                style={styles.input}
                placeholder="000000"
                placeholderTextColor="#475569"
                value={twoFactorCode}
                onChangeText={setTwoFactorCode}
                keyboardType="number-pad"
                maxLength={6}
                textAlign="center"
              />
            </>
          )}

          <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>
                {requiresTwoFactor ? 'Verify' : 'Sign In'}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.footer}>
          🔒 All data encrypted in transit. Biometric auth required on next launch.
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  logo: {
    fontSize: 28, fontWeight: '700',
    color: '#10b981',
    marginBottom: 4,
  },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 40 },
  form: { width: '100%', maxWidth: 360 },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1, borderColor: '#334155',
    borderRadius: 12,
    padding: 14,
    color: '#f1f5f9',
    fontSize: 15,
    marginBottom: 12,
    width: '100%',
  },
  twoFactorLabel: {
    color: '#94a3b8', fontSize: 12,
    marginBottom: 8, textAlign: 'center',
  },
  button: {
    backgroundColor: '#10b981',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  footer: {
    color: '#475569', fontSize: 11,
    textAlign: 'center', marginTop: 40,
    paddingHorizontal: 20,
  },
})
