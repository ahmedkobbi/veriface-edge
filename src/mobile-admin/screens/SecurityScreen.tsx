/**
 * VeriFace Edge Mobile — Security Screen
 *
 * Shows fraud score, security alerts, audit stream.
 * Push notifications for critical security events.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native'
import { ApiService } from '../services/ApiService'

export function SecurityScreen() {
  const [fraud, setFraud] = useState<any>(null)
  const [security, setSecurity] = useState<any>(null)
  const [audit, setAudit] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [fraudData, secData, auditData] = await Promise.all([
        ApiService.getFraudScore().catch(() => null),
        ApiService.getSecurityStatus().catch(() => null),
        ApiService.getAuditLog(20),
      ])
      if (fraudData?.success) setFraud(fraudData)
      if (secData?.success) setSecurity(secData)
      if (auditData?.success) setAudit(auditData.entries)
    } catch (e) {
      console.error('Security load failed:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load() }

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#10b981" /></View>

  const scoreColor = fraud?.fraudScore >= 80 ? '#10b981' : fraud?.fraudScore >= 60 ? '#f59e0b' : '#ef4444'

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
    >
      {/* Fraud score */}
      {fraud && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🛡️ Fraud Risk Score</Text>
          <View style={styles.scoreContainer}>
            <Text style={[styles.scoreValue, { color: scoreColor }]}>{fraud.fraudScore}</Text>
            <Text style={styles.scoreLabel}>{fraud.riskLevel}</Text>
          </View>
          {fraud.signals && (
            <View style={styles.signalsContainer}>
              {fraud.signals.map((sig: any, i: number) => (
                <View key={i} style={styles.signalRow}>
                  <Text style={styles.signalName}>{sig.name}</Text>
                  <Text style={[styles.signalScore, { color: sig.score >= 80 ? '#10b981' : '#f59e0b' }]}>
                    {sig.score}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {fraud.recommendation && (
            <Text style={styles.recommendation}>{fraud.recommendation}</Text>
          )}
        </View>
      )}

      {/* Security status */}
      {security && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>🔒 Security Status</Text>
          {security.securityCenter && (
            <>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>2FA Enabled</Text>
                <Text style={styles.statusValue}>{security.securityCenter.twoFactorEnabled ? '✅ Yes' : '❌ No'}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Active Sessions</Text>
                <Text style={styles.statusValue}>{security.securityCenter.activeSessions ?? 0}</Text>
              </View>
              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Blocked IPs</Text>
                <Text style={styles.statusValue}>{security.securityCenter.blockedIps ?? 0}</Text>
              </View>
            </>
          )}
        </View>
      )}

      {/* Audit stream */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>📜 Recent Audit Events</Text>
        {audit.length === 0 ? (
          <Text style={styles.emptyText}>No audit events</Text>
        ) : (
          audit.map((entry, i) => {
            const isSecurity = ['injection.suspected', 'auth.failure', 'rate_limit.exceeded'].includes(entry.eventType)
            return (
              <View key={i} style={styles.auditEntry}>
                <View style={[styles.auditDot, { backgroundColor: isSecurity ? '#ef4444' : '#10b981' }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.auditType}>{entry.eventType}</Text>
                  <Text style={styles.auditTime}>{new Date(entry.createdAt).toLocaleString()}</Text>
                </View>
              </View>
            )
          })
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, margin: 12, marginBottom: 8 },
  cardTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  scoreContainer: { alignItems: 'center', marginBottom: 16 },
  scoreValue: { fontSize: 48, fontWeight: '800' },
  scoreLabel: { color: '#64748b', fontSize: 14, marginTop: 4 },
  signalsContainer: { marginTop: 8 },
  signalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#334155' },
  signalName: { color: '#94a3b8', fontSize: 12 },
  signalScore: { fontSize: 12, fontWeight: '700' },
  recommendation: { color: '#06b6d4', fontSize: 11, marginTop: 12, lineHeight: 18 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  statusLabel: { color: '#64748b', fontSize: 13 },
  statusValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  emptyText: { color: '#475569', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  auditEntry: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#334155' },
  auditDot: { width: 8, height: 8, borderRadius: 4, marginRight: 10 },
  auditType: { color: '#f1f5f9', fontSize: 11, fontFamily: 'monospace' },
  auditTime: { color: '#475569', fontSize: 10, marginTop: 2 },
})
