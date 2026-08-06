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

interface AuditEntry {
  id: string
  eventType: string
  payload: any
  chainIndex: number
  prevHash: string
  thisHash: string
  actorIp: string | null
  createdAt: string
}

interface AuditLogPanelProps {
  tenantId: string | null
  refreshKey: number
}

export function AuditLogPanel({ tenantId, refreshKey }: AuditLogPanelProps) {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [chainValid, setChainValid] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  const fetchEntries = async () => {
    if (!tenantId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/audit?tenantId=${tenantId}&limit=50`)
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
    if (!tenantId) return
    try {
      const res = await fetch(`/api/verify-audit?tenantId=${tenantId}`)
      const data = await res.json()
      setChainValid(data.valid)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchEntries()
    verifyChain()
  }, [tenantId, refreshKey])

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>Hash-Chained Audit Log</span>
          <div className="flex items-center gap-2">
            {chainValid !== null && (
              <Badge
                variant="outline"
                className={
                  chainValid
                    ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700'
                    : 'bg-red-950/50 text-red-300 border-red-700'
                }
              >
                {chainValid ? (
                  <ShieldCheck className="w-3 h-3 mr-1" />
                ) : (
                  <ShieldAlert className="w-3 h-3 mr-1" />
                )}
                {chainValid ? 'CHAIN INTACT' : 'CHAIN BROKEN'}
              </Badge>
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
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-72 pr-3">
          {entries.length === 0 ? (
            <p className="text-xs text-slate-500 text-center py-8">
              No audit entries yet. Run an enrollment or authentication flow.
            </p>
          ) : (
            <div className="space-y-2">
              {entries.map((entry, idx) => {
                const eventColors: Record<string, string> = {
                  'auth.success': 'bg-emerald-950/30 text-emerald-300 border-emerald-800/50',
                  'auth.failure': 'bg-red-950/30 text-red-300 border-red-800/50',
                  'enroll.success': 'bg-cyan-950/30 text-cyan-300 border-cyan-800/50',
                  'session.init': 'bg-slate-950/30 text-slate-400 border-slate-800',
                  'template.revoked': 'bg-amber-950/30 text-amber-300 border-amber-800/50',
                  'injection.suspected': 'bg-red-950/30 text-red-300 border-red-800/50',
                  'webhook.delivered': 'bg-blue-950/30 text-blue-300 border-blue-800/50',
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
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
