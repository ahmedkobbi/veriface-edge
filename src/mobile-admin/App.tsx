/**
 * VeriFace Edge — Mobile Admin App (Glassmorphism Edition)
 *
 * Premium glassmorphism UI matching the web admin panel.
 * Features:
 *   - Dark/Light/Auto theme switcher
 *   - Glass components (GlassCard, GlassButton, GlassBadge, etc.)
 *   - Animated gradient background
 *   - Biometric authentication
 *   - Push notifications
 *   - Haptic feedback
 */

import React, { useState, useEffect, useCallback } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { View, ActivityIndicator, Text } from 'react-native'

import { ThemeProvider, useTheme } from './theme/ThemeContext'
import { GradientBg, GlassToastContainer, PremiumSpinner } from './components/GlassComponents'
import { AuthScreen } from './screens/AuthScreen'
import { MainTabNavigator } from './navigation/MainTabNavigator'
import { NotificationService } from './services/NotificationService'

const API_BASE_URL = 'https://api.veriface.io'
const SESSION_KEY = 'veriface_session'
const INACTIVITY_TIMEOUT = 5 * 60 * 1000

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
})

function AppContent() {
  const { theme, isDark } = useTheme()
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState(Date.now())

  useEffect(() => {
    initializeApp()
  }, [])

  const initializeApp = async () => {
    try {
      const stored = await SecureStore.getItemAsync(SESSION_KEY)
      if (stored) {
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Cookie: `veriface_session=${stored}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setSessionToken(stored)
            setIsAuthenticated(true)
            await NotificationService.registerForPushNotifications(stored)
          }
        }
      }
    } catch {
      await SecureStore.deleteItemAsync(SESSION_KEY)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isAuthenticated) authenticateBiometric()
  }, [isAuthenticated])

  const authenticateBiometric = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync()
    if (!compatible) return
    const enrolled = await LocalAuthentication.isEnrolledAsync()
    if (!enrolled) return
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to access VeriFace Admin',
      fallbackLabel: 'Use Passcode',
    })
    if (!result.success) handleLogout()
  }

  useEffect(() => {
    if (!isAuthenticated) return
    const interval = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) handleLogout()
    }, 60000)
    return () => clearInterval(interval)
  }, [isAuthenticated, lastActivity])

  const handleActivity = useCallback(() => setLastActivity(Date.now()), [])

  const handleLogin = async (email: string, password: string, twoFactorCode?: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()

    if (data.requiresTwoFactor) {
      if (!twoFactorCode) return { requiresTwoFactor: true, methods: data.twoFactorMethods }
      const verifyRes = await fetch(`${API_BASE_URL}/api/auth/2fa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken: data.pendingToken, code: twoFactorCode }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyData.success) throw new Error(verifyData.error || '2FA failed')
      const setCookie = verifyRes.headers.get('set-cookie') || ''
      const token = setCookie.match(/veriface_session=([^;]+)/)?.[1]
      if (token) {
        await SecureStore.setItemAsync(SESSION_KEY, token)
        setSessionToken(token)
        setIsAuthenticated(true)
        await NotificationService.registerForPushNotifications(token)
        return { success: true }
      }
    }

    if (data.success) {
      const setCookie = res.headers.get('set-cookie') || ''
      const token = setCookie.match(/veriface_session=([^;]+)/)?.[1]
      if (token) {
        await SecureStore.setItemAsync(SESSION_KEY, token)
        setSessionToken(token)
        setIsAuthenticated(true)
        await NotificationService.registerForPushNotifications(token)
        return { success: true }
      }
    }
    throw new Error(data.error || 'Login failed')
  }

  const handleLogout = async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' }).catch(() => {})
    await SecureStore.deleteItemAsync(SESSION_KEY)
    setSessionToken(null)
    setIsAuthenticated(false)
  }

  // Navigation theme
  const navTheme = isDark ? DarkTheme : DefaultTheme
  navTheme.colors = {
    ...navTheme.colors,
    primary: theme.colors.primary,
    background: 'transparent', // Let GradientBg show through
    card: theme.colors.tabBarBg,
    text: theme.colors.headerText,
    border: theme.colors.tabBarBorder,
    notification: theme.colors.error,
  }

  if (isLoading) {
    return (
      <GradientBg>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <PremiumSpinner size="xl" />
          <Text style={{ color: theme.colors.textMuted, marginTop: 16, fontSize: 12 }}>
            Loading VeriFace Admin...
          </Text>
        </View>
      </GradientBg>
    )
  }

  return (
    <GradientBg>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <GlassToastContainer />
      <View style={{ flex: 1 }} onTouchStart={handleActivity}>
        {isAuthenticated ? (
          <NavigationContainer theme={navTheme}>
            <MainTabNavigator
              sessionToken={sessionToken}
              apiBaseUrl={API_BASE_URL}
              onLogout={handleLogout}
            />
          </NavigationContainer>
        ) : (
          <AuthScreen onLogin={handleLogin} />
        )}
      </View>
    </GradientBg>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <AppContent />
      </SafeAreaProvider>
    </ThemeProvider>
  )
}
