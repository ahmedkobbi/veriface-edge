/**
 * VeriFace Edge Mobile — Billing Screen
 *
 * Shows current plan, usage, invoices, and upgrade options.
 * Redirects to Stripe Checkout for payment (opens in WebView).
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  StyleSheet, ActivityIndicator, Linking,
} from 'react-native'
import { ApiService } from '../services/ApiService'

export function BillingScreen() {
  const [billing, setBilling] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await ApiService.getBillingStatus()
      if (data.success) {
        setBilling(data.billing)
      }
    } catch (e) {
      console.error('Billing load failed:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load() }

  const handleUpgrade = async (planTier: string, interval: string) => {
    try {
      const data = await ApiService.createCheckout(planTier, interval)
      if (data.success && data.url) {
        Linking.openURL(data.url)
      }
    } catch (e: any) {
      Alert.alert('Failed', e.message)
    }
  }

  if (loading) return <View style={styles.loading}><ActivityIndicator size="large" color="#10b981" /></View>
  if (!billing) return <View style={styles.loading}><Text style={{ color: '#64748b' }}>No billing data</Text></View>

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
    >
      {/* Current plan */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Current Plan</Text>
        <Text style={styles.planName}>
          {(billing.planTier || 'developer').charAt(0).toUpperCase() + (billing.planTier || 'developer').slice(1)}
        </Text>
        <View style={styles.statusRow}>
          <Text style={styles.statusLabel}>Status</Text>
          <Text style={[styles.statusValue, { color: billing.status === 'active' ? '#10b981' : '#f59e0b' }]}>
            {billing.status || 'free'}
          </Text>
        </View>
        {billing.currentPeriodEnd && (
          <View style={styles.statusRow}>
            <Text style={styles.statusLabel}>Renews</Text>
            <Text style={styles.statusValue}>{new Date(billing.currentPeriodEnd).toLocaleDateString()}</Text>
          </View>
        )}
      </View>

      {/* Upgrade options */}
      {billing.planTier !== 'growth' && billing.planTier !== 'enterprise' && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Upgrade</Text>
          <TouchableOpacity style={styles.upgradeBtn} onPress={() => handleUpgrade('growth', 'month')}>
            <Text style={styles.upgradeBtnText}>🚀 Growth — $99/mo</Text>
            <Text style={styles.upgradeBtnSubtext}>100K calls/mo · Multi-region · Webhooks</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.upgradeBtn, { backgroundColor: '#a855f720' }]} onPress={() => handleUpgrade('enterprise', 'month')}>
            <Text style={[styles.upgradeBtnText, { color: '#a855f7' }]}>🏢 Enterprise — $499/mo</Text>
            <Text style={styles.upgradeBtnSubtext}>Unlimited · SAML · FIDO2 · SLA 99.99%</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Invoices */}
      {billing.invoices && billing.invoices.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Invoices</Text>
          {billing.invoices.slice(0, 5).map((inv: any, i: number) => (
            <View key={i} style={styles.invoiceRow}>
              <View>
                <Text style={styles.invoiceNum}>{inv.number || 'Invoice'}</Text>
                <Text style={styles.invoiceDate}>{new Date(inv.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.invoiceAmount}>${(inv.amountPaid / 100).toFixed(2)}</Text>
                <Text style={[styles.invoiceStatus, { color: inv.status === 'paid' ? '#10b981' : '#f59e0b' }]}>
                  {inv.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Payments */}
      {billing.payments && billing.payments.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recent Payments</Text>
          {billing.payments.slice(0, 5).map((pay: any, i: number) => (
            <View key={i} style={styles.invoiceRow}>
              <View>
                <Text style={styles.invoiceNum}>{pay.provider}</Text>
                <Text style={styles.invoiceDate}>{pay.paymentMethod || 'card'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.invoiceAmount}>${(pay.amount / 100).toFixed(2)}</Text>
                <Text style={[styles.invoiceStatus, { color: pay.status === 'succeeded' ? '#10b981' : '#f59e0b' }]}>
                  {pay.status}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, margin: 12, marginBottom: 8 },
  cardTitle: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  planName: { color: '#10b981', fontSize: 28, fontWeight: '800', marginBottom: 12 },
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  statusLabel: { color: '#64748b', fontSize: 13 },
  statusValue: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  upgradeBtn: {
    backgroundColor: '#10b98120', borderRadius: 12, padding: 16,
    marginBottom: 8, borderWidth: 1, borderColor: '#10b98140',
  },
  upgradeBtnText: { color: '#10b981', fontSize: 16, fontWeight: '700', marginBottom: 4 },
  upgradeBtnSubtext: { color: '#64748b', fontSize: 11 },
  invoiceRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#334155' },
  invoiceNum: { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  invoiceDate: { color: '#475569', fontSize: 10, marginTop: 2 },
  invoiceAmount: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  invoiceStatus: { fontSize: 10, fontWeight: '600', marginTop: 2 },
})
