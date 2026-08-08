/**
 * VeriFace Edge Mobile — Settings Screen
 *
 * Profile, logout, notification preferences, app info.
 */

import React, { useState, useEffect } from 'react'
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Switch, Alert, Linking,
} from 'react-native'
import { ApiService } from '../services/ApiService'
import { NotificationService } from '../services/NotificationService'

interface Props {
  onLogout: () => void
}

export function SettingsScreen({ onLogout }: Props) {
  const [user, setUser] = useState<any>(null)
  const [pushEnabled, setPushEnabled] = useState(true)
  const [securityAlerts, setSecurityAlerts] = useState(true)
  const [billingAlerts, setBillingAlerts] = useState(true)
  const [authAlerts, setAuthAlerts] = useState(true)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
    try {
      const data = await ApiService.getMe()
      if (data.success) setUser(data.user)
    } catch (e) {
      console.error('Failed to load user:', e)
    }
  }

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => {
        await NotificationService.unregister()
        onLogout()
      }},
    ])
  }

  return (
    <ScrollView style={styles.container}>
      {/* Profile */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Profile</Text>
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.email?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.name || 'Admin'}</Text>
            <Text style={styles.profileEmail}>{user?.email || '...'}</Text>
            <Text style={styles.profileRole}>{user?.role || 'user'}</Text>
          </View>
        </View>
      </View>

      {/* Notification preferences */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Push Notifications</Text>
        <SettingRow
          label="Enable Push Notifications"
          value={pushEnabled}
          onValueChange={setPushEnabled}
        />
        <SettingRow
          label="🔒 Security Alerts"
          description="Injection detected, brute force, suspicious activity"
          value={securityAlerts}
          onValueChange={setSecurityAlerts}
        />
        <SettingRow
          label="💳 Billing Alerts"
          description="Payment failed, usage threshold, quota exceeded"
          value={billingAlerts}
          onValueChange={setBillingAlerts}
        />
        <SettingRow
          label="🔐 Auth Alerts"
          description="New device login, 2FA changes, API key created/revoked"
          value={authAlerts}
          onValueChange={setAuthAlerts}
        />
      </View>

      {/* Quick links */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Links</Text>
        <LinkRow label="📚 API Documentation" url="https://api.veriface.io/api-docs" />
        <LinkRow label="📖 GitHub Repository" url="https://github.com/ahmedkobbi/veriface-edge" />
        <LinkRow label="🔒 Security Policy" url="https://github.com/ahmedkobbi/veriface-edge/blob/main/SECURITY.md" />
        <LinkRow label="📊 Status Page" url="https://status.veriface.io" />
      </View>

      {/* App info */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>About</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>SDK Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Build</Text>
          <Text style={styles.infoValue}>{new Date().getFullYear()}.08.08</Text>
        </View>
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutBtnText}>Sign Out</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>
        VeriFace Edge — Privacy-first facial authentication{'\n'}
        © 2026 ahmedkobbi. MIT License.
      </Text>
    </ScrollView>
  )
}

function SettingRow({ label, description, value, onValueChange }: {
  label: string
  description?: string
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  return (
    <View style={styles.settingRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description && <Text style={styles.settingDesc}>{description}</Text>}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#334155', true: '#10b981' }}
        thumbColor="#fff"
      />
    </View>
  )
}

function LinkRow({ label, url }: { label: string; url: string }) {
  return (
    <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(url)}>
      <Text style={styles.linkLabel}>{label}</Text>
      <Text style={styles.linkArrow}>→</Text>
    </TouchableOpacity>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, margin: 12, marginBottom: 8 },
  cardTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  profileRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: '#10b981', justifyContent: 'center', alignItems: 'center',
    marginRight: 12,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  profileName: { color: '#f1f5f9', fontSize: 16, fontWeight: '600' },
  profileEmail: { color: '#64748b', fontSize: 13, marginTop: 2 },
  profileRole: { color: '#10b981', fontSize: 11, marginTop: 2, textTransform: 'uppercase' },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  settingLabel: { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
  settingDesc: { color: '#475569', fontSize: 10, marginTop: 2 },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#334155' },
  linkLabel: { color: '#06b6d4', fontSize: 13 },
  linkArrow: { color: '#475569', fontSize: 16 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  infoLabel: { color: '#64748b', fontSize: 13 },
  infoValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '500' },
  logoutBtn: {
    backgroundColor: '#ef444415', borderRadius: 12, padding: 14,
    margin: 12, alignItems: 'center', borderWidth: 1, borderColor: '#ef444430',
  },
  logoutBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
  footer: { color: '#475569', fontSize: 11, textAlign: 'center', marginVertical: 20, lineHeight: 18 },
})
