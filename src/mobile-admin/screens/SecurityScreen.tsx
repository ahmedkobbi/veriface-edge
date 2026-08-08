/**
 * VeriFace Edge Mobile — Security Screen (Glassmorphism Edition)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassBadge, PremiumSpinner } from '../components/GlassComponents'
import { ApiService } from '../services/ApiService'

export function SecurityScreen() {
  const { theme } = useTheme()
  const [fraud, setFraud] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [fraudData, auditData] = await Promise.all([
        ApiService.getFraudScore().catch(() => null),
        ApiService.getAuditLog(20),
      ])
      if (fraudData?.success) setFraud(fraudData)
      if (auditData?.success) setAudit(auditData.entries)
    } catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])
  const onRefresh = () => { setRefreshing(true); load() }

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><PremiumSpinner size="lg" /></View>

  const scoreColor = fraud?.fraudScore >= 80 ? theme.colors.success : fraud?.fraudScore >= 60 ? theme.colors.warning : theme.colors.error

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}>

      {fraud && (
        <GlassCard variant="glow" glowColor={scoreColor}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>🛡️ Fraud Risk Score</Text>
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <Text style={{ fontSize: 48, fontWeight: '800', color: scoreColor }}>{fraud.fraudScore}</Text>
            <GlassBadge variant={fraud.fraudScore >= 80 ? 'success' : fraud.fraudScore >= 60 ? 'warning' : 'error'} size="md">{fraud.riskLevel}</GlassBadge>
          </View>
          {fraud.signals?.map((sig: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>{sig.name}</Text>
              <Text style={{ fontSize: 12, fontWeight: '700', color: sig.score >= 80 ? theme.colors.success : theme.colors.warning }}>{sig.score}</Text>
            </View>
          ))}
          {fraud.recommendation && <Text style={{ color: theme.colors.info, fontSize: 11, marginTop: 12, lineHeight: 18 }}>{fraud.recommendation}</Text>}
        </GlassCard>
      )}

      <GlassCard variant="medium" style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>📜 Recent Audit Events</Text>
        {audit.length === 0 ? (
          <Text style={{ color: theme.colors.textMuted, fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>No audit events</Text>
        ) : audit.map((entry, i) => {
          const isSecurity = ['injection.suspected', 'auth.failure', 'rate_limit.exceeded'].includes(entry.eventType)
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: isSecurity ? theme.colors.error : theme.colors.success, marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 11, fontFamily: theme.typography.fontMono }}>{entry.eventType}</Text>
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
