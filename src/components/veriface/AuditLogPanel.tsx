'use client'

/**
 * VeriFace Edge — Audit Log Panel
 *
 * Displays the hash-chained audit log entries for the active tenant.
 * Each entry is verified against the chain (thisHash == SHA-256(prev + payload + ts)).
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react'
import { GlassSurface, GlassBadge } from '@/components/premium/Glass'

interface AuditEntry {
  id: string
  eventType: string
  payload: any
  chainIndex: number
  prevHash: string
  thisHash: string
  actorIp: string | null
  apiKeyId: string | null
  createdAt: string
}

interface AuditLogPanelProps {
  tenantId: string | null
  apiKey: string | null
  refreshKey: number
}

export function AuditLogPanel({ tenantId, apiKey, refreshKey }: AuditLogPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [chainValid, setChainValid] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchEntries = async () => {
    if (!tenantId || !apiKey) return
    setLoading(true)
    try {
      const res = await fetch(`/api/audit?limit=50`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      const data = await res.json()
      if (data.success) {
        setEntries(data.entries)
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }

  const verifyChain = async () => {
    if (!tenantId || !apiKey) return
    try {
      const res = await fetch(`/api/verify-audit`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      const data = await res.json()
      setChainValid(data.valid)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchEntries()
    verifyChain()
  }, [tenantId, apiKey, refreshKey])

  return (
    <GlassSurface blur="xl" opacity="medium" className="rounded-2xl">
      <div className="p-4">
        <div className="pb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-slate-200">Hash-Chained Audit Log</span>
          <div className="flex items-center gap-2">
            {chainValid !== null && (
              <GlassBadge variant={chainValid ? 'success' : 'error'}>
                {chainValid ? (
                  <ShieldCheck className="w-3 h-3 mr-1" />
                ) : (
                  <ShieldAlert className="w-3 h-3 mr-1" />
                )}
                {chainValid ? 'CHAIN INTACT' : 'CHAIN BROKEN'}
              </GlassBadge>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { fetchEntries(); verifyChain() }}
              disabled={loading}
              className="h-7 px-2 text-xs text-slate-300"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>
        <ScrollArea className="h-72 pr-3">
          {entries.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">
              No audit entries yet. Run an enrollment or authentication flow.
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry) => {
                const eventColors: Record<string, string> = {
                  'auth.success': 'bg-emerald-950/30 text-emerald-300 border-emerald-800/50',
                  'auth.failure': 'bg-red-950/30 text-red-300 border-red-800/50',
                  'enroll.success': 'bg-cyan-950/30 text-cyan-300 border-cyan-800/50',
                  'session.init': 'bg-slate-950/30 text-slate-400 border-slate-800',
                  'template.revoked': 'bg-amber-950/30 text-amber-300 border-amber-800/50',
                  'injection.suspected': 'bg-red-950/30 text-red-300 border-red-800/50',
                  'webhook.delivered': 'bg-blue-950/30 text-blue-300 border-blue-800/50',
                  'api_key.created': 'bg-purple-950/30 text-purple-300 border-purple-800/50',
                  'api_key.revoked': 'bg-orange-950/30 text-orange-300 border-orange-800/50',
                  'token.revoked': 'bg-rose-950/30 text-rose-300 border-rose-800/50',
                  'token.verified': 'bg-teal-950/30 text-teal-300 border-teal-800/50',
                  'webauthn.enrolled': 'bg-indigo-950/30 text-indigo-300 border-indigo-800/50',
                  'webauthn.verified': 'bg-indigo-950/30 text-indigo-300 border-indigo-800/50',
                }
                const color = eventColors[entry.eventType] || 'bg-slate-950/30 text-slate-400 border-slate-800'
                return (
                  <div
                    key={entry.id}
                    className={`rounded-md border px-3 py-2 ${color}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">#{entry.chainIndex}</span>
                        <span className="text-xs font-medium">{entry.eventType}</span>
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {new Date(entry.createdAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <pre className="text-[10px] text-slate-400 font-mono overflow-x-auto whitespace-pre-wrap break-all">
                      {JSON.stringify(entry.payload, null, 2)}
                    </pre>
                    <div className="mt-1 flex items-center gap-1">
                      <span className="text-[9px] text-slate-600 font-mono">
                        hash: {entry.thisHash.slice(0, 16)}…
                      </span>
                      {entry.apiKeyId && (
                        <span className="text-[9px] text-slate-600 font-mono">
                          • key: {entry.apiKeyId.slice(0, 8)}…
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </div>
    </GlassSurface>
  )
}
