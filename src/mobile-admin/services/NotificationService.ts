/**
 * VeriFace Edge Mobile — Notification Service
 *
 * Handles push notification registration + display.
 * Uses expo-notifications for cross-platform push (iOS APNs + Android FCM).
 *
 * Security:
 *   - Device token stored in SecureStore (encrypted)
 *   - Token registered with backend (associated with session)
 *   - Notifications are silent if app is in foreground (shows in-app banner instead)
 */

import * as Notifications from 'expo-notifications'
import * as Device from 'expo-device'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const DEVICE_TOKEN_KEY = 'veriface_push_token'
const API_BASE_URL = 'https://api.veriface.io'

export class NotificationService {
  /**
   * Register for push notifications.
   * Called on app launch if user is authenticated.
   *
   * Flow:
   *   1. Request permission (iOS shows dialog, Android auto-grants)
   *   2. Get Expo push token
   *   3. Register token with backend (associates with session)
   *   4. Store token in SecureStore (avoid re-registering)
   */
  static async registerForPushNotifications(sessionToken: string): Promise<string | null> {
    if (!Device.isDevice) {
      console.log('[Notifications] Must use physical device for push notifications')
      return null
    }

    // Check if already registered
    const existing = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)
    if (existing) {
      return existing
    }

    // Request permission
    const { status: existingStatus } = await Notifications.getPermissionsAsync()
    let finalStatus = existingStatus

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync()
      finalStatus = status
    }

    if (finalStatus !== 'granted') {
      console.log('[Notifications] Permission not granted')
      return null
    }

    // Get push token
    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: 'your-expo-project-id',
    })
    const token = tokenData.data

    // Register with backend
    try {
      await fetch(`${API_BASE_URL}/api/mobile/register-device`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `veriface_session=${sessionToken}`,
        },
        body: JSON.stringify({
          pushToken: token,
          platform: Platform.OS,
          deviceName: Device.deviceName || Device.modelName || 'Unknown',
          appVersion: '1.0.0',
        }),
      })

      await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token)
      console.log('[Notifications] Registered for push notifications')
      return token
    } catch (e) {
      console.error('[Notifications] Failed to register:', e)
      return null
    }
  }

  /**
   * Unregister from push notifications (on logout).
   */
  static async unregister(): Promise<void> {
    const token = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)
    if (token) {
      // Backend will remove the token association
      await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY)
    }
  }

  /**
   * Schedule a local notification (for testing).
   */
  static async sendLocalNotification(title: string, body: string): Promise<void> {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null, // Immediately
    })
  }
}

// Notification categories (for interactive notifications)
export const NotificationCategories = {
  SECURITY_ALERT: 'security_alert',
  BILLING_ALERT: 'billing_alert',
  SYSTEM_ALERT: 'system_alert',
}

// Notification priority levels
export const NotificationPriority = {
  CRITICAL: 'critical', // SEV-1: security breach, service outage
  HIGH: 'high',         // SEV-2: billing failure, rate limit spike
  MEDIUM: 'medium',     // SEV-3: usage threshold, new device login
  LOW: 'low',           // SEV-4: weekly digest, product update
}
