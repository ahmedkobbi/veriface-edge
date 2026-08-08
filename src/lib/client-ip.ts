/**
 * VeriFace Edge — Client IP Extraction (Trusted Proxy Aware)
 *
 * SECURITY FIX (B-09): Previously, the code trusted the `X-Forwarded-For`
 * header unconditionally:
 *   `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'`
 *
 * This header is client-controlled. An attacker can set `X-Forwarded-For:
 * 1.2.3.4` on every request to get a fresh rate-limit bucket each time,
 * bypassing per-IP rate limiting entirely.
 *
 * The correct approach is to only trust `X-Forwarded-For` if the request
 * came from a known reverse proxy (Caddy, Nginx, AWS ALB, Cloudflare, etc.).
 * The proxy sets `X-Forwarded-For` based on the actual TCP source IP, which
 * the client cannot spoof (the proxy overwrites any client-supplied value).
 *
 * Trust chain:
 *   1. If the TCP source IP (req.socket.remoteAddress / x-real-ip) is a
 *      trusted proxy → use X-Forwarded-For (leftmost entry = original client)
 *   2. If the TCP source IP is NOT a trusted proxy → the XFF header is
 *      client-supplied and untrusted → use the TCP source IP directly
 *   3. If no TCP source IP is available → use 'unknown' (fail-closed for
 *      rate limiting — 'unknown' shares a single bucket)
 *
 * Configuration:
 *   VERIFACE_TRUSTED_PROXIES — comma-separated list of trusted proxy IPs/CIDRs
 *     Example: "127.0.0.1,10.0.0.0/8,172.16.0.0/12"
 *   Default (dev): "127.0.0.1,::1" (localhost only)
 *   Default (prod): must be set — if empty, NO XFF is trusted (fail-closed)
 */

import { NextRequest } from 'next/server'
import { logger } from '@/lib/logger'

// ---------------------------------------------------------------------------
// Trusted proxy configuration
// ---------------------------------------------------------------------------

interface TrustedProxyConfig {
  ips: Set<string>
  cidrs: Array<{ base: number; mask: number }>
}

let trustedProxyConfig: TrustedProxyConfig | null = null

function getTrustedProxyConfig(): TrustedProxyConfig {
  if (trustedProxyConfig) return trustedProxyConfig

  const raw = process.env.VERIFACE_TRUSTED_PROXIES
  const ips = new Set<string>()
  const cidrs: Array<{ base: number; mask: number }> = []

  if (raw) {
    for (const entry of raw.split(',').map(s => s.trim()).filter(Boolean)) {
      if (entry.includes('/')) {
        // CIDR notation — parse IPv4 CIDR
        const [ip, maskStr] = entry.split('/')
        const mask = parseInt(maskStr, 10)
        if (mask >= 0 && mask <= 32) {
          const parts = ip.split('.').map(p => parseInt(p, 10))
          if (parts.length === 4 && parts.every(p => p >= 0 && p <= 255)) {
            const base = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]
            cidrs.push({ base: base >>> 0, mask })
          }
        }
      } else {
        // Single IP
        ips.add(entry)
      }
    }
  } else {
    // Default: trust localhost only (dev mode)
    ips.add('127.0.0.1')
    ips.add('::1')
    ips.add('::ffff:127.0.0.1')
    if (process.env.NODE_ENV !== 'production') {
      logger.info('VERIFACE_TRUSTED_PROXIES not set — trusting localhost only (dev mode)')
    }
  }

  trustedProxyConfig = { ips, cidrs }
  return trustedProxyConfig
}

/**
 * Check if an IP address is in a CIDR range.
 * Only supports IPv4 CIDRs (IPv6 trusted proxies should be listed as single IPs).
 */
function isIpInCidr(ip: string, cidr: { base: number; mask: number }): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10))
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return false
  const ipInt = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  const maskBits = cidr.mask === 0 ? 0 : (0xFFFFFFFF << (32 - cidr.mask)) >>> 0
  return (ipInt & maskBits) === (cidr.base & maskBits)
}

/**
 * Check if an IP is a trusted proxy.
 */
function isTrustedProxy(ip: string): boolean {
  if (!ip) return false
  const config = getTrustedProxyConfig()

  // Check single IPs (handles both IPv4 and IPv6)
  if (config.ips.has(ip)) return true
  // Check IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (v4Mapped && config.ips.has(v4Mapped[1])) return true

  // Check CIDRs
  if (v4Mapped) {
    for (const cidr of config.cidrs) {
      if (isIpInCidr(v4Mapped[1], cidr)) return true
    }
  } else {
    for (const cidr of config.cidrs) {
      if (isIpInCidr(ip, cidr)) return true
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// Client IP extraction
// ---------------------------------------------------------------------------

/**
 * Extract the client's real IP address from a request, respecting trusted proxies.
 *
 * Trust chain:
 *   1. If TCP source IP is a trusted proxy → use X-Forwarded-For (leftmost)
 *   2. If TCP source IP is NOT a trusted proxy → use TCP source IP (ignore XFF)
 *   3. If no TCP source IP → 'unknown'
 *
 * Usage:
 *   const clientIp = getClientIp(req)
 *
 * In production, set VERIFACE_TRUSTED_PROXIES to the IP(s) of your reverse
 * proxy (Caddy, Nginx, ALB, Cloudflare). Without this, XFF is untrusted
 * and rate limiting falls back to the TCP source IP (which will be the
 * proxy's IP — all traffic appears to come from one IP).
 */
export function getClientIp(req: NextRequest): string {
  // Get the TCP source IP. In Next.js (Node.js runtime), this is available
  // via the x-real-ip header (set by Caddy/Nginx) or socket.remoteAddress.
  // In Edge runtime, socket is not available — we rely on x-real-ip.
  const tcpSourceIp =
    req.headers.get('x-real-ip') ??
    // @ts-ignore — socket may not be available in Edge runtime
    req.socket?.remoteAddress ??
    'unknown'

  // If we can't determine the TCP source IP, fail closed.
  // 'unknown' shares a single rate-limit bucket — safe but coarse.
  if (tcpSourceIp === 'unknown') {
    // Last resort: check XFF but log a warning (untrusted)
    const xff = req.headers.get('x-forwarded-for')
    if (xff) {
      // In dev mode, accept XFF with a warning. In prod, fail closed.
      if (process.env.NODE_ENV !== 'production') {
        return xff.split(',')[0].trim()
      }
      logger.warn('getClientIp: no TCP source IP — ignoring XFF (untrusted in production)')
    }
    return 'unknown'
  }

  // Check if the TCP source is a trusted proxy
  if (isTrustedProxy(tcpSourceIp)) {
    // Trusted proxy — use X-Forwarded-For (leftmost entry = original client)
    const xff = req.headers.get('x-forwarded-for')
    if (xff) {
      const clientIp = xff.split(',')[0].trim()
      if (clientIp) return clientIp
    }
    // Proxy didn't set XFF — use the proxy's IP (all traffic from this proxy
    // shares a bucket — acceptable since the proxy is trusted)
    return tcpSourceIp
  }

  // TCP source is NOT a trusted proxy — the XFF header is client-supplied
  // and untrusted. Use the TCP source IP directly.
  return tcpSourceIp
}
