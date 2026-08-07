/**
 * VeriFace Edge — SSRF Protection Tests
 */

import { test, expect, describe } from 'bun:test'
import { isPrivateIp, validateWebhookUrl } from '../src/lib/ssrf'

describe('SSRF: Private IP detection', () => {
  test('rejects 127.0.0.1 (loopback)', () => {
    expect(isPrivateIp('127.0.0.1')).not.toBeNull()
  })

  test('rejects 10.0.0.1 (private)', () => {
    expect(isPrivateIp('10.0.0.1')).not.toBeNull()
  })

  test('rejects 172.16.0.1 (private)', () => {
    expect(isPrivateIp('172.16.0.1')).not.toBeNull()
  })

  test('rejects 192.168.1.1 (private)', () => {
    expect(isPrivateIp('192.168.1.1')).not.toBeNull()
  })

  test('rejects 169.254.169.254 (cloud metadata)', () => {
    expect(isPrivateIp('169.254.169.254')).not.toBeNull()
  })

  test('rejects 0.0.0.0', () => {
    expect(isPrivateIp('0.0.0.0')).not.toBeNull()
  })

  test('rejects ::1 (IPv6 loopback)', () => {
    expect(isPrivateIp('::1')).not.toBeNull()
  })

  test('rejects fe80::1 (IPv6 link-local)', () => {
    expect(isPrivateIp('fe80::1')).not.toBeNull()
  })

  test('allows 8.8.8.8 (public)', () => {
    expect(isPrivateIp('8.8.8.8')).toBeNull()
  })

  test('allows 1.1.1.1 (public)', () => {
    expect(isPrivateIp('1.1.1.1')).toBeNull()
  })
})

describe('SSRF: Webhook URL validation', () => {
  test('rejects non-HTTPS URL', async () => {
    const result = await validateWebhookUrl('http://example.com/webhook')
    expect(result.allowed).toBe(false)
    expect(result.reason).toContain('HTTPS')
  })

  test('rejects localhost', async () => {
    const result = await validateWebhookUrl('https://localhost/webhook')
    expect(result.allowed).toBe(false)
  })

  test('rejects 127.0.0.1', async () => {
    const result = await validateWebhookUrl('https://127.0.0.1/webhook')
    expect(result.allowed).toBe(false)
  })

  test('rejects 169.254.169.254 (AWS metadata)', async () => {
    const result = await validateWebhookUrl('https://169.254.169.254/latest/meta-data/')
    expect(result.allowed).toBe(false)
  })

  test('rejects metadata.google.internal', async () => {
    const result = await validateWebhookUrl('https://metadata.google.internal/computeMetadata/v1/')
    expect(result.allowed).toBe(false)
  })

  test('rejects 10.0.0.1', async () => {
    const result = await validateWebhookUrl('https://10.0.0.1/webhook')
    expect(result.allowed).toBe(false)
  })

  test('rejects 192.168.1.1', async () => {
    const result = await validateWebhookUrl('https://192.168.1.1/webhook')
    expect(result.allowed).toBe(false)
  })

  test('rejects malformed URL', async () => {
    const result = await validateWebhookUrl('not-a-url')
    expect(result.allowed).toBe(false)
  })

  test('rejects URL without hostname', async () => {
    const result = await validateWebhookUrl('https:///webhook')
    expect(result.allowed).toBe(false)
  })
})
