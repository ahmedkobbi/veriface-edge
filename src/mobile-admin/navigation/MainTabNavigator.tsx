/**
 * VeriFace Edge Mobile — Main Tab Navigator
 *
 * Bottom tab navigation with 5 tabs:
 *   1. Dashboard — overview stats, health, recent activity
 *   2. API Keys — list, create, revoke
 *   3. Security — fraud score, audit stream, alerts
 *   4. Billing — plan, invoices, upgrade
 *   5. Settings — profile, logout, notification prefs
 */

import React from 'react'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { Ionicons } from '@expo/vector-icons'
import { TouchableOpacity, Alert } from 'react-native'

import { DashboardScreen } from '../screens/DashboardScreen'
import { ApiKeysScreen } from '../screens/ApiKeysScreen'
import { SecurityScreen } from '../screens/SecurityScreen'
import { BillingScreen } from '../screens/BillingScreen'
import { SettingsScreen } from '../screens/SettingsScreen'

export type RootTabParamList = {
  Dashboard: undefined
  ApiKeys: undefined
  Security: undefined
  Billing: undefined
  Settings: undefined
}

const Tab = createBottomTabNavigator<RootTabParamList>()

interface Props {
  sessionToken: string | null
  apiBaseUrl: string
  onLogout: () => void
}

export function MainTabNavigator({ sessionToken, apiBaseUrl, onLogout }: Props) {
  const logout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: onLogout },
    ])
  }

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#f1f5f9',
        headerTitleStyle: { fontSize: 16, fontWeight: '600' },
        tabBarStyle: { backgroundColor: '#0f172a', borderTopColor: '#1e293b' },
        tabBarActiveTintColor: '#10b981',
        tabBarInactiveTintColor: '#475569',
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Dashboard',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" color={color} size={size} />,
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
            <TouchableOpacity onPress={logout} style={{ marginRight: 16 }}>
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
