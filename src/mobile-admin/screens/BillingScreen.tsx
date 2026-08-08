/**
 * VeriFace Edge Mobile — Billing Screen (Glassmorphism Edition)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, ScrollView, RefreshControl, Linking } from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassButton, GlassBadge, PremiumSpinner, showToast } from '../components/GlassComponents'
import { ApiService } from '../services/ApiService'

export function BillingScreen() {
  const { theme } = useTheme()
  const [billing, setBilling] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    try { const data = await ApiService.getBillingStatus(); if (data.success) setBilling(data.billing) }
    catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])
  const onRefresh = () => { setRefreshing(true); load() }

  const handleUpgrade = async (planTier: string, interval: string) => {
    try {
      const data = await ApiService.createCheckout(planTier, interval)
      if (data.success && data.url) { Linking.openURL(data.url); showToast('Redirecting to checkout...', 'info') }
    } catch (e: any) { showToast(e.message, 'error') }
  }

  if (loading) return <View style={{ flex: 1, justifyContent: 'center' }}><PremiumSpinner size="lg" /></View>

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingTop: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}>

      <GlassCard variant="glow" glowColor={theme.colors.primary}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 12, marginBottom: 4 }}>Current Plan</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', color: theme.colors.primary, marginBottom: 12 }}>
          {(billing?.planTier || 'developer').charAt(0).toUpperCase() + (billing?.planTier || 'developer').slice(1)}
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: theme.colors.textSecondary, fontSize: 13 }}>Status</Text>
          <GlassBadge variant={billing?.status === 'active' ? 'success' : 'warning'}>{billing?.status || 'free'}</GlassBadge>
        </View>
      </GlassCard>

      {billing?.planTier === 'developer' && (
        <GlassCard variant="medium" style={{ marginTop: 8 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Upgrade</Text>
          <GlassButton onPress={() => handleUpgrade('growth', 'month')} variant="primary" size="md" style={{ marginBottom: 8 }}>
            🚀 Growth — $99/mo
          </GlassButton>
          <GlassButton onPress={() => handleUpgrade('enterprise', 'month')} variant="secondary" size="md">
            🏢 Enterprise — $499/mo
          </GlassButton>
        </GlassCard>
      )}

      {billing?.invoices?.length > 0 && (
        <GlassCard variant="medium" style={{ marginTop: 8 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Recent Invoices</Text>
          {billing.invoices.slice(0, 5).map((inv: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
              <View>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>{inv.number || 'Invoice'}</Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>{new Date(inv.createdAt).toLocaleDateString()}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>${(inv.amountPaid / 100).toFixed(2)}</Text>
                <GlassBadge variant={inv.status === 'paid' ? 'success' : 'warning'}>{inv.status}</GlassBadge>
              </View>
            </View>
          ))}
        </GlassCard>
      )}

      {billing?.payments?.length > 0 && (
        <GlassCard variant="medium" style={{ marginTop: 8 }}>
          <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600', marginBottom: 12 }}>Recent Payments</Text>
          {billing.payments.slice(0, 5).map((pay: any, i: number) => (
            <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.colors.glassBorder }}>
              <View>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>{pay.provider}</Text>
                <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 2 }}>{pay.paymentMethod || 'card'}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '700' }}>${(pay.amount / 100).toFixed(2)}</Text>
                <GlassBadge variant={pay.status === 'succeeded' ? 'success' : 'warning'}>{pay.status}</GlassBadge>
              </View>
            </View>
          ))}
        </GlassCard>
      )}
    </ScrollView>
  )
}
