'use client'

/**
 * VeriFace Edge — Anti-Injection Status Panel
 *
 * Real-time display of anti-injection defense layers:
 *   1. Virtual camera detection
 *   2. Frame-timing jitter analysis
 *   3. Replay detection (frame hashing)
 *   4. Browser extension tamper check
 *   5. Hardware attestation availability
 *   6. Strobe probe (sub-perceptible challenge/response)
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ShieldCheck, ShieldAlert, Camera, Clock, Repeat, Puzzle, Cpu, Zap } from 'lucide-react'
import type { AntiInjectionReport } from '@/sdk/anti-injection'

interface AntiInjectionPanelProps {
  report: AntiInjectionReport | null
  liveStatus: string
}

export function AntiInjectionPanel({ report, liveStatus }: AntiInjectionPanelProps) {
  const layers = report
    ? [
        {
          name: 'Virtual Camera Scan',
          icon: Camera,
          status: report.deviceScan.suspiciousOnly ? 'fail' : 'pass',
          detail: report.deviceScan.suspiciousOnly
            ? `Only virtual cameras: ${report.deviceScan.virtualCameras.join(', ')}`
            : `${report.deviceScan.realCameras.length} real / ${report.deviceScan.virtualCameras.length} virtual`,
        },
        {
          name: 'Frame-Timing Jitter',
          icon: Clock,
          status: report.timingStats.synthetic ? 'fail' : report.timingStats.samples >= 10 ? 'pass' : 'warn',
          detail: `CV ${report.timingStats.cv.toFixed(3)} • ${report.timingStats.samples} samples`,
        },
        {
          name: 'Replay Detection',
          icon: Repeat,
          status: report.replayDetected ? 'fail' : 'pass',
          detail: report.replayDetected ? 'DUPLICATE FRAME' : 'No duplicates (10-min window)',
        },
        {
          name: 'Extension Tamper',
          icon: Puzzle,
          status: report.tamperCheck.passed ? 'pass' : 'fail',
          detail: report.tamperCheck.passed
            ? 'Prototypes intact'
            : report.tamperCheck.violations.join(', '),
        },
        {
          name: 'Hardware Attestation',
          icon: Cpu,
          status: report.attestation.attestationAvailable ? 'pass' : 'warn',
          detail: report.attestation.algorithm ?? 'Not available (browser)',
        },
        {
          name: 'Strobe Probe',
          icon: Zap,
          status: report.strobeResponses >= Math.max(1, Math.floor(report.strobeChallenges * 0.3)) ? 'pass' : 'warn',
          detail: `${report.strobeResponses}/${report.strobeChallenges} responses`,
        },
      ]
    : [
        { name: 'Virtual Camera Scan', icon: Camera, status: 'idle', detail: 'Awaiting capture' },
        { name: 'Frame-Timing Jitter', icon: Clock, status: 'idle', detail: 'Awaiting capture' },
        { name: 'Replay Detection', icon: Repeat, status: 'idle', detail: 'Awaiting capture' },
        { name: 'Extension Tamper', icon: Puzzle, status: 'idle', detail: 'Awaiting capture' },
        { name: 'Hardware Attestation', icon: Cpu, status: 'idle', detail: 'Awaiting capture' },
        { name: 'Strobe Probe', icon: Zap, status: 'idle', detail: 'Awaiting capture' },
      ]

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>Anti-Injection Defense</span>
          {report && (
            <Badge
              variant="outline"
              className={
                report.passed
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700'
                  : 'bg-red-950/50 text-red-300 border-red-700'
              }
            >
              {report.passed ? (
                <ShieldCheck className="w-3 h-3 mr-1" />
              ) : (
                <ShieldAlert className="w-3 h-3 mr-1" />
              )}
              {report.passed ? 'SECURE' : 'BREACH'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {layers.map((l) => {
          const Icon = l.icon
          const colors = {
            pass: 'text-emerald-400 bg-emerald-950/30 border-emerald-800/50',
            fail: 'text-red-400 bg-red-950/30 border-red-800/50',
            warn: 'text-amber-400 bg-amber-950/30 border-amber-800/50',
            idle: 'text-slate-500 bg-slate-950/30 border-slate-800',
          }[l.status as string] || 'text-slate-500 bg-slate-950/30 border-slate-800'

          return (
            <div
              key={l.name}
              className={`flex items-center justify-between px-3 py-2 rounded-md border ${colors}`}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-3.5 h-3.5" />
                <span className="text-xs text-slate-200">{l.name}</span>
              </div>
              <span className="text-[10px] text-slate-400 font-mono">{l.detail}</span>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
