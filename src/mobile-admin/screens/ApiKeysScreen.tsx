/**
 * VeriFace Edge Mobile — API Keys Screen
 *
 * List, create, and revoke API keys.
 * Copy key to clipboard (shown once on creation).
 */

import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, FlatList, TouchableOpacity, RefreshControl,
  Alert, Modal, TextInput, StyleSheet, Clipboard,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { ApiService } from '../services/ApiService'

export function ApiKeysScreen() {
  const [keys, setKeys] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newKeyLabel, setNewKeyLabel] = useState('')
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await ApiService.listApiKeys()
      if (data.apiKeys) setKeys(data.apiKeys)
    } catch (e) {
      console.error('Failed to load API keys:', e)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const onRefresh = () => { setRefreshing(true); load() }

  const handleCreate = async () => {
    if (!newKeyLabel.trim()) {
      Alert.alert('Missing label', 'Please enter a label for the API key')
      return
    }
    try {
      const data = await ApiService.createApiKey(newKeyLabel, '*')
      if (data.apiKey?.plaintext) {
        setCreatedKey(data.apiKey.plaintext)
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }
      setShowCreate(false)
      setNewKeyLabel('')
      load()
    } catch (e: any) {
      Alert.alert('Failed', e.message)
    }
  }

  const handleRevoke = (keyId: string, label: string) => {
    Alert.alert(
      'Revoke API Key',
      `Are you sure you want to revoke "${label}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke', style: 'destructive',
          onPress: async () => {
            try {
              await ApiService.revokeApiKey(keyId)
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              load()
            } catch (e: any) {
              Alert.alert('Failed', e.message)
            }
          },
        },
      ],
    )
  }

  const copyKey = (key: string) => {
    Clipboard.setString(key)
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Alert.alert('Copied', 'API key copied to clipboard')
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>API Keys ({keys.length})</Text>
        <TouchableOpacity style={styles.createBtn} onPress={() => setShowCreate(true)}>
          <Text style={styles.createBtnText}>+ Create</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={keys}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#10b981" />}
        renderItem={({ item }) => (
          <View style={styles.keyCard}>
            <View style={{ flex: 1 }}>
              <View style={styles.keyHeader}>
                <Text style={styles.keyLabel}>{item.label}</Text>
                <View style={[styles.keyBadge, item.active ? styles.badgeActive : styles.badgeRevoked]}>
                  <Text style={styles.keyBadgeText}>{item.active ? 'Active' : 'Revoked'}</Text>
                </View>
              </View>
              <Text style={styles.keyPrefix}>{item.keyPrefix}...{item.lastFour}</Text>
              <Text style={styles.keyMeta}>
                Scopes: {item.scopes} · Created {new Date(item.createdAt).toLocaleDateString()}
              </Text>
              {item.lastUsedAt && (
                <Text style={styles.keyMeta}>Last used: {new Date(item.lastUsedAt).toLocaleDateString()}</Text>
              )}
            </View>
            {item.active && (
              <TouchableOpacity onPress={() => handleRevoke(item.id, item.label)} style={styles.revokeBtn}>
                <Text style={styles.revokeBtnText}>Revoke</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>No API keys. Create one to get started.</Text>
        }
      />

      {/* Create modal */}
      <Modal visible={showCreate} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Create API Key</Text>
            <TextInput
              style={styles.input}
              placeholder="Label (e.g., Production)"
              placeholderTextColor="#475569"
              value={newKeyLabel}
              onChangeText={setNewKeyLabel}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => { setShowCreate(false); setNewKeyLabel('') }}>
                <Text style={styles.cancelBtn}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreate} style={styles.createConfirmBtn}>
                <Text style={styles.createConfirmText}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Created key modal */}
      <Modal visible={!!createdKey} animationType="fade" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>🔑 API Key Created</Text>
            <Text style={styles.warningText}>
              Copy this key now — it will NOT be shown again.
            </Text>
            <TouchableOpacity onPress={() => createdKey && copyKey(createdKey)} style={styles.keyBox}>
              <Text style={styles.keyText} numberOfLines={1}>{createdKey}</Text>
              <Text style={styles.copyHint}>Tap to copy</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setCreatedKey(null)} style={styles.createConfirmBtn}>
              <Text style={styles.createConfirmText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  title: { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  createBtn: { backgroundColor: '#10b981', borderRadius: 8, padding: 8, paddingHorizontal: 16 },
  createBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  keyCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 12,
    padding: 14, marginHorizontal: 12, marginBottom: 8,
  },
  keyHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  keyLabel: { color: '#f1f5f9', fontSize: 14, fontWeight: '600', flex: 1 },
  keyBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeActive: { backgroundColor: '#10b98130' },
  badgeRevoked: { backgroundColor: '#ef444430' },
  keyBadgeText: { fontSize: 10, fontWeight: '600' },
  keyPrefix: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  keyMeta: { color: '#475569', fontSize: 10 },
  revokeBtn: { padding: 8 },
  revokeBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  emptyText: { color: '#475569', fontSize: 14, textAlign: 'center', marginTop: 40 },
  modalOverlay: { flex: 1, justifyContent: 'center', backgroundColor: '#00000080', padding: 24 },
  modalContent: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24 },
  modalTitle: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 16 },
  input: {
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155',
    borderRadius: 8, padding: 12, color: '#f1f5f9', fontSize: 14, marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  cancelBtn: { color: '#64748b', fontSize: 14, padding: 8 },
  createConfirmBtn: { backgroundColor: '#10b981', borderRadius: 8, padding: 10, paddingHorizontal: 20 },
  createConfirmText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  warningText: { color: '#f59e0b', fontSize: 12, marginBottom: 12 },
  keyBox: { backgroundColor: '#0f172a', borderRadius: 8, padding: 12, marginBottom: 16 },
  keyText: { color: '#10b981', fontSize: 13, fontFamily: 'monospace' },
  copyHint: { color: '#475569', fontSize: 10, marginTop: 4, textAlign: 'center' },
})
