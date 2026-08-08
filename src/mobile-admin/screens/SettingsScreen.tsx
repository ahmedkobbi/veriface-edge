/**
 * VeriFace Edge Mobile — Settings Screen (Glassmorphism Edition)
 * Includes theme switcher (dark/light/auto)
 */

import React, { useState, useEffect } from 'react'
import { View, Text, ScrollView, TouchableOpacity, Linking } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassButton, GlassSwitch, showToast } from '../components/GlassComponents'
import { VeriFaceLogo, BrandIcon } from '../components/VeriFaceLogo'
import { ApiService } from '../services/ApiService'
import { NotificationService } from '../services/NotificationService'
import type { ThemeMode } from '../theme/theme'

interface Props {
  onLogout: () => void
}

export function SettingsScreen({ onLogout }: Props) {
  const { theme, mode, setMode, isDark } = useTheme()
  const [user, setUser] = useState<any>(null)
  const [pushEnabled, setPushEnabled] = useState(true)
  const [securityAlerts, setSecurityAlerts] = useState(true)
  const [billingAlerts, setBillingAlerts] = useState(true)
  const [authAlerts, setAuthAlerts] = useState(true)

  useEffect(() => {
    ApiService.getMe().then(d => { if (d.success) setUser(d.user) }).catch(() => {})
  }, [])

  const handleLogout = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    import('react-native').then(({ Alert }) =>
      Alert.alert('Sign Out', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: async () => {
          await NotificationService.unregister(); onLogout()
        }},
      ])
    )
  }

  const themes: { mode: ThemeMode; label: string; icon: string }[] = [
    { mode: 'dark', label: 'Dark', icon: 'moon' },
    { mode: 'light', label: 'Light', icon: 'sunny' },
    { mode: 'auto', label: 'Auto', icon: 'phone-portrait' },
  ]

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 100 }}>
      {/* Profile */}
      <GlassCard variant="glow" glowColor={theme.colors.primary}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <BrandIcon size={48} color={theme.colors.primary} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={{ color: theme.colors.text, fontSize: 16, fontWeight: '600' }}>{user?.name || 'Admin'}</Text>
            <Text style={{ color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 }}>{user?.email || '...'}</Text>
            <Text style={{ color: theme.colors.primary, fontSize: 11, marginTop: 2, textTransform: 'uppercase' }}>{user?.role || 'user'}</Text>
          </View>
        </View>
      </GlassCard>

      {/* Brand */}
      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <VeriFaceLogo variant="mark" size={32} />
            <View>
              <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>VeriFace Edge</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: 10 }}>v1.0.0 · MIT License</Text>
            </View>
          </View>
          <GlassBadge variant="info">v1.0</GlassBadge>
        </View>
      </GlassCard>

      {/* Theme switcher */}
      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>🎨 Theme</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {themes.map((t) => (
            <TouchableOpacity
              key={t.mode}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode(t.mode); showToast(`Theme: ${t.label}`, 'info') }}
              style={{
                flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: 12, borderRadius: 10,
                backgroundColor: mode === t.mode ? theme.colors.glassHighlight : 'transparent',
                borderWidth: 1, borderColor: mode === t.mode ? theme.colors.primary + '40' : theme.colors.glassBorder,
              }}
            >
              <Ionicons name={t.icon as any} size={16} color={mode === t.mode ? theme.colors.primary : theme.colors.textSecondary} />
              <Text style={{ color: mode === t.mode ? theme.colors.primary : theme.colors.textSecondary, fontSize: 12, fontWeight: '600' }}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </GlassCard>

      {/* Push notification preferences */}
      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>🔔 Push Notifications</Text>
        <SettingRow label="Enable Push" value={pushEnabled} onChange={setPushEnabled} theme={theme} />
        <SettingRow label="🔒 Security Alerts" desc="Injection, brute force, suspicious activity" value={securityAlerts} onChange={setSecurityAlerts} theme={theme} />
        <SettingRow label="💳 Billing Alerts" desc="Payment failed, threshold, quota exceeded" value={billingAlerts} onChange={setBillingAlerts} theme={theme} />
        <SettingRow label="🔐 Auth Alerts" desc="New device, 2FA change, API key created/revoked" value={authAlerts} onChange={setAuthAlerts} theme={theme} last />
      </GlassCard>

      {/* Quick links */}
      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Links</Text>
        <LinkRow label="📚 API Docs" url="https://api.veriface.io/api-docs" theme={theme} />
        <LinkRow label="📖 GitHub" url="https://github.com/ahmedkobbi/veriface-edge" theme={theme} />
        <LinkRow label="🔒 Security Policy" url="https://github.com/ahmedkobbi/veriface-edge/blob/main/SECURITY.md" theme={theme} />
        <LinkRow label="📊 Status Page" url="https://status.veriface.io" theme={theme} last />
      </GlassCard>

      {/* About */}
      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>About</Text>
        <InfoRow label="Version" value="1.0.0" theme={theme} />
        <InfoRow label="Theme" value={`${mode} (${isDark ? 'dark' : 'light'})`} theme={theme} />
        <InfoRow label="Build" value="2026.08.08" theme={theme} last />
      </GlassCard>

      <GlassButton onPress={handleLogout} variant="danger" size="lg" style={{ marginTop: 12 }}>
        Sign Out
      </GlassButton>

      <Text style={{ color: theme.colors.textMuted, fontSize: 11, textAlign: 'center', marginVertical: 20, lineHeight: 18 }}>
        VeriFace Edge — Privacy-first facial authentication{'\n'}© 2026 ahmedkobbi. MIT License.
      </Text>
    </ScrollView>
  )
}

function SettingRow({ label, desc, value, onChange, theme, last }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.glassBorder }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '500' }}>{label}</Text>
        {desc && <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>{desc}</Text>}
      </View>
      <GlassSwitch value={value} onValueChange={onChange} />
    </View>
  )
}

function LinkRow({ label, url, theme, last }: any) {
  return (
    <TouchableOpacity onPress={() => Linking.openURL(url)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.glassBorder }}>
      <Text style={{ color: theme.colors.info, fontSize: 13 }}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={theme.colors.textMuted} />
    </TouchableOpacity>
  )
}

function InfoRow({ label, value, theme, last }: any) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: last ? 0 : 1, borderBottomColor: theme.colors.glassBorder }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '500' }}>{value}</Text>
    </View>
  )
}
