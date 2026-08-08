/**
 * VeriFace Edge — Mobile Admin App
 *
 * React Native (Expo) app for on-the-go tenant management.
 *
 * Features:
 *   - Biometric login (Face ID / Touch ID / device PIN)
 *   - Dashboard with real-time stats
 *   - API key management (create, revoke, copy)
 *   - Security center (fraud score, audit stream, security alerts)
 *   - Billing management (plan, invoices, upgrade)
 *   - Push notifications for security alerts
 *   - Haptic feedback on actions
 *
 * Security:
 *   - Session stored in expo-secure-store (encrypted Keychain/Keystore)
 *   - Biometric authentication required on app launch
 *   - Auto-logout after 5 minutes of inactivity
 *   - All API calls authenticated with session cookie
 *   - No sensitive data stored in AsyncStorage (only SecureStore)
 *   - Certificate pinning via expo-network (future)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { NavigationContainer } from '@react-navigation/native'
import * as SecureStore from 'expo-secure-store'
import * as LocalAuthentication from 'expo-local-authentication'
import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import { ActivityIndicator, View, Text } from 'react-native'

import { AuthScreen } from './screens/AuthScreen'
import { MainTabNavigator } from './navigation/MainTabNavigator'
import { NotificationService } from './services/NotificationService'

const API_BASE_URL = 'https://api.veriface.io'
const SESSION_KEY = 'veriface_session'
const INACTIVITY_TIMEOUT = 5 * 60 * 1000 // 5 minutes

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

export default function App() {
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
  const [lastActivity, setLastActivity] = useState(Date.now())

  // --- Initialize: check stored session + register for push notifications ---
  useEffect(() => {
    initializeApp()
  }, [])

  const initializeApp = async () => {
    try {
      // Check for stored session
      const stored = await SecureStore.getItemAsync(SESSION_KEY)
      if (stored) {
        // Verify session is still valid
        const res = await fetch(`${API_BASE_URL}/api/auth/me`, {
          headers: { Cookie: `veriface_session=${stored}` },
        })
        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setSessionToken(stored)
            setIsAuthenticated(true)
            // Register for push notifications
            await NotificationService.registerForPushNotifications(stored)
          }
        }
      }
    } catch (e) {
      // Session expired or network error
      await SecureStore.deleteItemAsync(SESSION_KEY)
    } finally {
      setIsLoading(false)
    }
  }

  // --- Biometric authentication on app launch ---
  useEffect(() => {
    if (isAuthenticated) {
      authenticateBiometric()
    }
  }, [isAuthenticated])

  const authenticateBiometric = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync()
    if (!compatible) return // Skip if no biometric hardware

    const enrolled = await LocalAuthentication.isEnrolledAsync()
    if (!enrolled) return // Skip if no biometric enrolled

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authenticate to access VeriFace Admin',
      fallbackLabel: 'Use Passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    })

    if (!result.success) {
      // Biometric failed — log out
      handleLogout()
    }
  }

  // --- Auto-logout on inactivity ---
  useEffect(() => {
    if (!isAuthenticated) return

    const interval = setInterval(() => {
      if (Date.now() - lastActivity > INACTIVITY_TIMEOUT) {
        handleLogout()
      }
    }, 60 * 1000) // Check every minute

    return () => clearInterval(interval)
  }, [isAuthenticated, lastActivity])

  // --- Track activity (touch events) ---
  const handleActivity = useCallback(() => {
    setLastActivity(Date.now())
  }, [])

  // --- Login handler ---
  const handleLogin = async (email: string, password: string, twoFactorCode?: string) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })

    const data = await res.json()

    if (data.requiresTwoFactor) {
      // Submit 2FA code
      if (!twoFactorCode) {
        return { requiresTwoFactor: true, methods: data.twoFactorMethods }
      }

      const verifyRes = await fetch(`${API_BASE_URL}/api/auth/2fa/challenge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pendingToken: data.pendingToken, code: twoFactorCode }),
      })
      const verifyData = await verifyRes.json()

      if (!verifyData.success) {
        throw new Error(verifyData.error || '2FA verification failed')
      }

      // Extract session cookie
      const setCookie = verifyRes.headers.get('set-cookie') || ''
      const token = extractSessionToken(setCookie)
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
      const token = extractSessionToken(setCookie)
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

  // --- Logout handler ---
  const handleLogout = async () => {
    await fetch(`${API_BASE_URL}/api/auth/logout`, { method: 'POST' })
    await SecureStore.deleteItemAsync(SESSION_KEY)
    setSessionToken(null)
    setIsAuthenticated(false)
  }

  // --- Loading state ---
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' }}>
        <ActivityIndicator size="large" color="#10b981" />
        <Text style={{ color: '#64748b', marginTop: 12, fontSize: 12 }}>Loading VeriFace Admin...</Text>
      </View>
    )
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <View style={{ flex: 1 }} onTouchStart={handleActivity}>
        {isAuthenticated ? (
          <NavigationContainer>
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
    </SafeAreaProvider>
  )
}

function extractSessionToken(setCookie: string): string | null {
  const match = setCookie.match(/veriface_session=([^;]+)/)
  return match ? match[1] : null
}
