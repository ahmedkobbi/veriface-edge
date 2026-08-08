/**
 * VeriFace Edge Mobile — Dashboard Screen (Glassmorphism Edition)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassStatCard, GlassBadge, PremiumSpinner } from '../components/GlassComponents'
import { ApiService } from '../services/ApiService'

export function DashboardScreen() {
  const { theme } = useTheme()
  const [usage, setUsage] = useState<any>(null)
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [usageData, auditData] = await Promise.all([ApiService.getUsage(), ApiService.getAuditLog(10)])
      if (usageData.success) setUsage(usageData)
      if (auditData.success) setRecent(auditData.entries)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])
  const onRefresh = () => { setRefreshing(true); load() }

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><PremiumSpinner size="lg" /></View>

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 12, paddingTop: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <GlassStatCard label="Auths (30d)" value={usage?.summary?.authSuccess ?? 0} color={theme.colors.success} />
        <GlassStatCard label="Enrollments" value={usage?.summary?.enrollments ?? 0} color={theme.colors.info} />
        <GlassStatCard label="Failures" value={usage?.summary?.authFailure ?? 0} color={theme.colors.error} />
        <GlassStatCard label="Rate Limited" value={usage?.summary?.rateLimited ?? 0} color={theme.colors.warning} />
      </View>

      {usage?.summary && (
        <GlassCard variant="medium" style={{ marginTop: 8 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Usage Summary</Text>
          <Row label="Active API Keys" value={usage.summary.activeKeys} theme={theme} />
          <Row label="Enrolled Users" value={usage.summary.enrolledUsers} theme={theme} />
          <Row label="Est. Cost (30d)" value={`$${usage.summary.estimatedCost}`} theme={theme} />
        </GlassCard>
      )}

      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Recent Activity</Text>
        {recent.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>No recent activity</Text>
        ) : recent.map((entry, i) => {
          const isSecurity = ['injection.suspected', 'auth.failure', 'rate_limit.exceeded'].includes(entry.eventType)
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isSecurity ? theme.colors.error : theme.colors.success, marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 12, fontFamily: theme.typography.fontMono }}>{entry.eventType}</Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>{new Date(entry.createdAt).toLocaleString()}</Text>
              </View>
              {isSecurity && <GlassBadge variant="error">alert</GlassBadge>}
            </View>
          )
        })}
      </GlassCard>
    </ScrollView>
  )
}

function Row({ label, value, theme }: { label: string; value: any; theme: any }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>{label}</Text>
      <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>{value}</Text>
    </View>
  )
}
