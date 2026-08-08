/**
 * VeriFace Edge Mobile — API Service
 *
 * Handles all API calls to the VeriFace Edge backend.
 * Session token is injected as a cookie on every request.
 *
 * Security:
 *   - Session token from SecureStore (never AsyncStorage)
 *   - Auto-logout on 401 (session expired)
 *   - Request timeout (10s) to prevent hanging
 *   - Error messages sanitized (no stack traces exposed)
 */

import * as SecureStore from 'expo-secure-store'

const API_BASE_URL = 'https://api.veriface.io'
const SESSION_KEY = 'veriface_session'
const REQUEST_TIMEOUT = 10_000

export class ApiService {
  private static async getHeaders(): Promise<HeadersInit> {
    const token = await SecureStore.getItemAsync(SESSION_KEY)
    return {
      'Content-Type': 'application/json',
      ...(token ? { Cookie: `veriface_session=${token}` } : {}),
    }
  }

  private static async request<T = any>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const headers = await this.getHeaders()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)

    try {
      const res = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: { ...headers, ...(options.headers || {}) },
        signal: controller.signal,
      })

      clearTimeout(timeout)

      if (res.status === 401) {
        // Session expired — clear stored session
        await SecureStore.deleteItemAsync(SESSION_KEY)
        throw new Error('SESSION_EXPIRED')
      }

      const data = await res.json()

      if (!res.ok && !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`)
      }

      return data
    } catch (e: any) {
      clearTimeout(timeout)
      if (e.name === 'AbortError') {
        throw new Error('Request timed out')
      }
      throw e
    }
  }

  // --- Auth ---
  static async getMe() {
    return this.request('/api/auth/me')
  }

  // --- Dashboard ---
  static async getUsage() {
    return this.request('/api/admin/usage')
  }

  static async getAuditLog(limit = 10) {
    return this.request(`/api/audit?limit=${limit}`)
  }

  // --- API Keys ---
  static async listApiKeys() {
    return this.request('/api/api-keys/list')
  }

  static async createApiKey(label: string, scopes = '*') {
    return this.request('/api/api-keys/create', {
      method: 'POST',
      body: JSON.stringify({ label, scopes }),
    })
  }

  static async revokeApiKey(apiKeyId: string) {
    return this.request('/api/api-keys/revoke', {
      method: 'POST',
      body: JSON.stringify({ apiKeyId }),
    })
  }

  // --- Security ---
  static async getFraudScore() {
    return this.request('/api/admin/fraud-score')
  }

  static async getSecurityStatus() {
    return this.request('/api/admin/security')
  }

  // --- Billing ---
  static async getBillingStatus() {
    return this.request('/api/billing/status')
  }

  static async createCheckout(planTier: string, interval: string) {
    return this.request('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ planTier, interval }),
    })
  }

  // --- Notifications ---
  static async getNotifications() {
    return this.request('/api/customer/notifications')
  }

  // --- Rate Limits / Plan ---
  static async getPlan() {
    return this.request('/api/admin/plan')
  }

  // --- Backups ---
  static async getBackups() {
    return this.request('/api/admin/backups')
  }
}
