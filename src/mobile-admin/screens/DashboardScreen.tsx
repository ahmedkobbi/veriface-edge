/**
 * VeriFace Edge Mobile — Dashboard Screen
 *
 * Shows overview stats: auth count, enrollments, failures, rate limits.
 * Recent audit log entries. API health status.
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, RefreshControl, StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { ApiService } from '../services/ApiService'

export function DashboardScreen() {
  const [usage, setUsage] = useState<any>(null)
  const [recent, setRecent] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const [usageData, auditData] = await Promise.all([
        ApiService.getUsage(),
        ApiService.getAuditLog(10),
      ])
      if (usageData.success) setUsage(usageData)
      if (auditData.success) setRecent(auditData.entries)
    } catch (e) {
      console.error('Dashboard load failed:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    load()
  }, [load])

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator size="large" color="#10b981" /></View>
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
    >
      {/* Stats grid */}
      <View style={styles.statsGrid}>
        <StatCard label="Auths (30d)" value={usage?.summary?.authSuccess ?? 0} color="#10b981" />
        <StatCard label="Enrollments" value={usage?.summary?.enrollments ?? 0} color="#06b6d4" />
        <StatCard label="Failures" value={usage?.summary?.authFailure ?? 0} color="#ef4444" />
        <StatCard label="Rate Limited" value={usage?.summary?.rateLimited ?? 0} color="#f59e0b" />
      </View>

      {/* Usage */}
      {usage?.summary && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Usage Summary</Text>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Active API Keys</Text>
            <Text style={styles.cardValue}>{usage.summary.activeKeys}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Enrolled Users</Text>
            <Text style={styles.cardValue}>{usage.summary.enrolledUsers}</Text>
          </View>
          <View style={styles.cardRow}>
            <Text style={styles.cardLabel}>Est. Cost (30d)</Text>
            <Text style={styles.cardValue}>${usage.summary.estimatedCost}</Text>
          </View>
        </View>
      )}

      {/* Recent activity */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Activity</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>No recent activity</Text>
        ) : (
          recent.map((entry, i) => (
            <View key={i} style={styles.auditEntry}>
              <View style={styles.auditDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.auditType}>{entry.eventType}</Text>
                <Text style={styles.auditTime}>{new Date(entry.createdAt).toLocaleString()}</Text>
              </View>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value.toLocaleString()}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    padding: 12, gap: 8,
  },
  statCard: {
    flex: 1, minWidth: '45%',
    backgroundColor: '#1e293b', borderRadius: 12,
    padding: 14, marginBottom: 8,
  },
  statLabel: { color: '#64748b', fontSize: 11, marginBottom: 4 },
  statValue: { fontSize: 22, fontWeight: '700' },
  card: {
    backgroundColor: '#1e293b', borderRadius: 12,
    padding: 16, margin: 12, marginBottom: 8,
  },
  cardTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  cardLabel: { color: '#64748b', fontSize: 13 },
  cardValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  emptyText: { color: '#475569', fontSize: 13, textAlign: 'center', paddingVertical: 20 },
  auditEntry: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  auditDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: '#10b981', marginRight: 10,
  },
  auditType: { color: '#f1f5f9', fontSize: 12, fontFamily: 'monospace' },
  auditTime: { color: '#475569', fontSize: 10, marginTop: 2 },
})
