/**
 * VeriFace Edge Mobile — Main Tab Navigator (Glassmorphism Edition)
 *
 * Glass bottom tab bar with blur + theme switcher in Settings header.
 */

import React, { useState } from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { TouchableOpacity, Alert, View, Text, StyleSheet } from 'react-native'
import { BlurView } from 'expo-blur'
import * as Haptics from 'expo-haptics'

import { DashboardScreen } from '../screens/DashboardScreen'
import { ApiKeysScreen } from '../screens/ApiKeysScreen'
import { SecurityScreen } from '../screens/SecurityScreen'
import { BillingScreen } from '../screens/BillingScreen'
import { SettingsScreen } from '../screens/SettingsScreen'
import { useTheme } from '../theme/ThemeContext'
import { GlassButton, showToast } from '../components/GlassComponents'
import type { ThemeMode } from '../theme/theme'

const Tab = createBottomTabNavigator()

interface Props {
  sessionToken: string | null
  apiBaseUrl: string
  onLogout: () => void
}

export function MainTabNavigator({ onLogout }: Props) {
  const { theme, mode, setMode, isDark } = useTheme()

  const cycleTheme = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    const next: ThemeMode = mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark'
    setMode(next)
    showToast(`Theme: ${next}`, 'info')
  }

  const logout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: onLogout },
    ])
  }

  const themeIcon = mode === 'dark' ? 'moon' : mode === 'light' ? 'sunny' : 'phone-portrait'

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: 'transparent' },
        headerTransparent: true,
        headerTintColor: theme.colors.headerText,
        headerTitleStyle: { fontSize: 16, fontWeight: '600' },
        headerBackground: () => (
          <BlurView
            intensity={50}
            tint={theme.mode}
            style={{ ...StyleSheet.absoluteFillObject }}
          />
        ),
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: 'transparent',
          borderTopColor: theme.colors.tabBarBorder,
          borderTopWidth: 1,
          elevation: 0,
        },
        tabBarBackground: () => (
          <BlurView
            intensity={50}
            tint={theme.mode}
            style={{ ...StyleSheet.absoluteFillObject }}
          />
        ),
        tabBarActiveTintColor: theme.colors.tabBarActive,
        tabBarInactiveTintColor: theme.colors.tabBarInactive,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '500' },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
          headerRight: () => (
            <TouchableOpacity onPress={cycleTheme} style={{ marginRight: 16, padding: 4 }}>
              <Ionicons name={themeIcon as any} size={20} color={theme.colors.textSecondary} />
            </TouchableOpacity>
          ),
        }}
      />
      <Tab.Screen
        name="ApiKeys"
        component={ApiKeysScreen}
        options={{
          title: 'API Keys',
          tabBarIcon: ({ color, size }) => <Ionicons name="key-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Security"
        component={SecurityScreen}
        options={{
          title: 'Security',
          tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Billing"
        component={BillingScreen}
        options={{
          title: 'Billing',
          tabBarIcon: ({ color, size }) => <Ionicons name="card-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color} size={size} />,
          headerRight: () => (
            <TouchableOpacity onPress={logout} style={{ marginRight: 16, padding: 4 }}>
              <Ionicons name="log-out-outline" size={22} color="#ef4444" />
            </TouchableOpacity>
          ),
        }}
      >
        {(props) => <SettingsScreen {...props} onLogout={onLogout} />}
      </Tab.Screen>
    </Tab.Navigator>
  )
}
