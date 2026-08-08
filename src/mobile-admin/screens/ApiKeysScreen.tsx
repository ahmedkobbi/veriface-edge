/**
 * VeriFace Edge Mobile — API Keys Screen (Glassmorphism Edition)
 */

import React, { useState, useEffect, useCallback } from 'react'
import { View, Text, FlatList, RefreshControl, Clipboard } from 'react-native'
import * as Haptics from 'expo-haptics'
import { useTheme } from '../theme/ThemeContext'
import { GlassCard, GlassButton, GlassBadge, GlassInput, GlassModal, showToast } from '../components/GlassComponents'
import { ApiService } from '../services/ApiService'

export function ApiKeysScreen() {
  const { theme } = useTheme()
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { const data = await ApiService.listApiKeys(); if (data.apiKeys) setKeys(data.apiKeys) }
    catch (e) { console.error(e) }
    finally { setLoading(false); setRefreshing(false) }
  }, [])

  useEffect(() => { load() }, [load])
  const onRefresh = () => { setRefreshing(true); load() }

  const handleCreate = async () => {
    if (!newKeyLabel.trim()) { showToast('Please enter a label', 'warning'); return }
    try {
      const data = await ApiService.createApiKey(newKeyLabel, '*')
      if (data.apiKey?.plaintext) { setCreatedKey(data.apiKey.plaintext); showToast('API key created', 'success') }
      setShowCreate(false); setNewKeyLabel(''); load()
    } catch (e: any) { showToast(e.message, 'error') }
  }

  const handleRevoke = (keyId: string, label: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    import('react-native').then(({ Alert }) =>
      Alert.alert('Revoke API Key', `Revoke "${label}"? This cannot be undone.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: async () => {
          try { await ApiService.revokeApiKey(keyId); showToast('Key revoked', 'success'); load() }
          catch (e: any) { showToast(e.message, 'error') }
        }},
      ])
    )
  }

  const copyKey = (key: string) => {
    Clipboard.setString(key)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    showToast('API key copied', 'success')
  }

  return (
    <View style={{ flex: 1, paddingTop: 100 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, marginBottom: 8 }}>
        <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: '700' }}>API Keys ({keys.length})</Text>
        <GlassButton onPress={() => setShowCreate(true)} variant="primary" size="sm">+ Create</GlassButton>
      </View>

      <FlatList
        data={keys}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.colors.primary} />}
        renderItem={({ item }) => (
          <GlassCard variant="medium" style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <Text style={{ color: theme.colors.text, fontSize: 14, fontWeight: '600' }}>{item.label}</Text>
                <GlassBadge variant={item.active ? 'success' : 'error'}>{item.active ? 'Active' : 'Revoked'}</GlassBadge>
              </View>
              <Text style={{ color: theme.colors.textSecondary, fontSize: 12, fontFamily: theme.typography.fontMono }}>{item.keyPrefix}...{item.lastFour}</Text>
              <Text style={{ color: theme.colors.textMuted, fontSize: 10, marginTop: 4 }}>Scopes: {item.scopes} · {new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            {item.active && <GlassButton onPress={() => handleRevoke(item.id, item.label)} variant="danger" size="sm">Revoke</GlassButton>}
          </GlassCard>
        )}
        ListEmptyComponent={<Text style={{ color: theme.colors.textMuted, fontSize: 14, textAlign: 'center', marginTop: 40 }}>No API keys. Create one to get started.</Text>}
      />

      <GlassModal visible={showCreate} onClose={() => setShowCreate(false)} title="Create API Key">
        <GlassInput value={newKeyLabel} onChangeText={setNewKeyLabel} placeholder="Label (e.g., Production)" autoFocus />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 16 }}>
          <GlassButton onPress={() => { setShowCreate(false); setNewKeyLabel('') }} variant="ghost" size="md">Cancel</GlassButton>
          <GlassButton onPress={handleCreate} variant="primary" size="md">Create</GlassButton>
        </View>
      </GlassModal>

      <GlassModal visible={!!createdKey} onClose={() => setCreatedKey(null)} title="🔑 API Key Created">
        <Text style={{ color: theme.colors.warning, fontSize: 12, marginBottom: 12 }}>Copy this key now — it will NOT be shown again.</Text>
        <GlassCard variant="heavy" style={{ marginBottom: 16 }}>
          <Text style={{ color: theme.colors.primary, fontSize: 13, fontFamily: theme.typography.fontMono }} numberOfLines={1}>{createdKey}</Text>
        </GlassCard>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <GlassButton onPress={() => createdKey && copyKey(createdKey)} variant="secondary" size="md" style={{ flex: 1 }}>Copy</GlassButton>
          <GlassButton onPress={() => setCreatedKey(null)} variant="primary" size="md" style={{ flex: 1 }}>Done</GlassButton>
        </View>
      </GlassModal>
    </View>
  )
}
