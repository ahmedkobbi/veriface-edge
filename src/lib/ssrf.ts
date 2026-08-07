/**
 * VeriFace Edge — SSRF (Server-Side Request Forgery) Protection
 *
 * Validates webhook URLs to prevent attackers from using VeriFace as a
 * proxy to reach internal services.
 *
 * Blocked destinations:
 *   - Private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
 *   - Loopback (127.0.0.0/8, ::1)
 *   - Link-local (169.254.0.0/16) — includes AWS/GCP/Azure metadata endpoints
 *   - Cloud metadata endpoints:
 *       169.254.169.254  (AWS, GCP, Azure)
 *       metadata.google.internal  (GCP)
 *       metadata.azure.com  (Azure)
 *   - 0.0.0.0 (could route to localhost on some systems)
 *   - IPv6-mapped IPv4 private addresses
 *   - DNS rebinding: resolves hostname, checks ALL resolved IPs
 *
 * Allowed:
 *   - Public HTTPS URLs only
 *   - Domains that resolve to public IPs
 */

import * as dnsPromises from 'node:dns/promises'

export interface SsrfCheckResult {
  allowed: boolean
  reason?: string
  resolvedIps?: string[]
}

// Private IP ranges (RFC 1918 + special-use)
const PRIVATE_IP_PATTERNS: Array<{ name: string; test: (ip: string) => boolean }> = [
  {
    name: 'IPv4 loopback (127.0.0.0/8)',
    test: (ip) => /^127\./.test(ip),
  },
  {
    name: 'IPv4 private 10.0.0.0/8',
    test: (ip) => /^10\./.test(ip),
  },
  {
    name: 'IPv4 private 172.16.0.0/12',
    test: (ip) => /^172\.(1[6-9]|2[0-9]|3[01])\./.test(ip),
  },
  {
    name: 'IPv4 private 192.168.0.0/16',
    test: (ip) => /^192\.168\./.test(ip),
  },
  {
    name: 'IPv4 link-local 169.254.0.0/16 (cloud metadata)',
    test: (ip) => /^169\.254\./.test(ip),
  },
  {
    name: 'IPv4 unspecified 0.0.0.0',
    test: (ip) => ip === '0.0.0.0',
  },
  {
    name: 'IPv4 carrier-grade NAT 100.64.0.0/10',
    test: (ip) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip),
  },
  {
    name: 'IPv4 benchmark 198.18.0.0/15',
    test: (ip) => /^198\.(1[89])\./.test(ip),
  },
  {
    name: 'IPv4 multicast 224.0.0.0/4',
    test: (ip) => /^(2[2-3][0-9]|2[4-9]\d)\./.test(ip),
  },
  {
    name: 'IPv4 reserved 240.0.0.0/4',
    test: (ip) => /^(2[4-5][0-9])\./.test(ip),
  },
  {
    name: 'IPv6 loopback ::1',
    test: (ip) => ip === '::1' || ip === '::ffff:127.0.0.1',
  },
  {
    name: 'IPv6 link-local fe80::/10',
    test: (ip) => /^fe[89ab][0-9a-f]:/i.test(ip),
  },
  {
    name: 'IPv6 unique local fc00::/7',
    test: (ip) => /^f[cd][0-9a-f]{2}:/i.test(ip),
  },
  {
    name: 'IPv6 unspecified ::',
    test: (ip) => ip === '::',
  },
  {
    name: 'IPv6 IPv4-mapped private',
    test: (ip) => {
      // ::ffff:10.x.x.x, ::ffff:127.x.x.x, etc.
      const v4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
      if (!v4) return false
      return PRIVATE_IP_PATTERNS.some((p) => p.test(v4[1]))
    },
  },
]

// Blocked hostnames (cloud metadata + internal services)
const BLOCKED_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata',
  'metadata.azure.com',
  '169.254.169.254',
  'metadata.aws.internal',
  'localhost',
  'ip-ranges.amazonaws.com',
  'fd00.local',
  'localtest.me',
])

/**
 * Check if an IP address is private/reserved.
 * Returns the pattern name if blocked, null if allowed.
 */
export function isPrivateIp(ip: string): string | null {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(ip)) {
      return pattern.name
    }
  }
  return null
}

/**
 * Validate a webhook URL for SSRF safety.
 *
 * Checks:
 *   1. Must be HTTPS
 *   2. Hostname not in blocked list
 *   3. If hostname is an IP, must not be private
 *   4. DNS resolve hostname — ALL resolved IPs must be public
 *   5. Re-resolve at delivery time to detect DNS rebinding
 *
 * Returns { allowed: boolean, reason?: string, resolvedIps?: string[] }
 */
export async function validateWebhookUrl(url: string): Promise<SsrfCheckResult> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { allowed: false, reason: 'Invalid URL format' }
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { allowed: false, reason: 'Webhook URL must use HTTPS' }
  }

  // Must have a hostname
  const hostname = parsed.hostname
  if (!hostname) {
    return { allowed: false, reason: 'URL must have a hostname' }
  }

  // Check blocked hostnames
  const lowerHostname = hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.has(lowerHostname)) {
    return { allowed: false, reason: `Blocked hostname: ${hostname}` }
  }

  // If hostname is already an IP, check it directly
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.includes(':')
  if (isIpAddress) {
    const blocked = isPrivateIp(hostname)
    if (blocked) {
      return { allowed: false, reason: `IP address is ${blocked}` }
    }
    return { allowed: true, resolvedIps: [hostname] }
  }

  // DNS resolve — check ALL resolved IPs
  // Try node:dns first (Node.js runtime), fall back to DNS-over-HTTPS (Edge runtime)
  let resolved: string[]
  try {
    const result = await dnsPromises.resolve4(hostname)
    if (result.length === 0) {
      // Try IPv6
      const v6 = await dnsPromises.resolve6(hostname)
      resolved = v6
    } else {
      // Also check IPv6
      try {
        const v6 = await dnsPromises.resolve6(hostname)
        resolved = [...result, ...v6]
      } catch {
        resolved = result
      }
    }
  } catch {
    // Fallback: DNS-over-HTTPS via Cloudflare (works in Edge runtime)
    try {
      const dohResponse = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        {
          headers: { 'Accept': 'application/dns-json' },
          signal: AbortSignal.timeout(5000),
        },
      )
      const dohData = await dohResponse.json() as any
      const aRecords = (dohData.Answer ?? [])
        .filter((a: any) => a.type === 1)
        .map((a: any) => a.data)
      if (aRecords.length === 0) {
        return { allowed: false, reason: `DNS resolution failed for ${hostname}` }
      }
      resolved = aRecords
    } catch {
      return { allowed: false, reason: `DNS resolution failed for ${hostname}` }
    }
  }

  if (resolved.length === 0) {
    return { allowed: false, reason: `No DNS records for ${hostname}` }
  }

  // Check every resolved IP
  for (const ip of resolved) {
    const blocked = isPrivateIp(ip)
    if (blocked) {
      return {
        allowed: false,
        reason: `Hostname ${hostname} resolves to ${ip} (${blocked})`,
        resolvedIps: resolved,
      }
    }
  }

  return { allowed: true, resolvedIps: resolved }
}

/**
 * Re-validate the webhook URL's resolved IP at delivery time.
 * This catches DNS rebinding attacks where the hostname was public
 * at validation time but resolves to a private IP at delivery time.
 *
 * Usage: call this immediately before fetch() in the webhook delivery loop.
 */
export async function revalidateWebhookIp(url: string): Promise<SsrfCheckResult> {
  const result = await validateWebhookUrl(url)
  if (!result.allowed) {
    return result
  }
  // Double-check the resolved IPs haven't changed (DNS rebinding)
  // Note: between this check and the actual fetch, a sophisticated
  // attacker could still rebind. The ultimate defense is to pin the
  // resolved IP and connect to it directly with SNI set to the hostname.
  // That requires a custom HTTP agent — out of scope for this implementation.
  return result
}
