'use client'

/**
 * VeriFace Edge — Liveness Score Panel
 *
 * Real-time display of liveness signals:
 *   - rPPG (Remote Photoplethysmography) — blood-flow pulse detection
 *   - PAD Texture (micro-texture via Laplacian variance)
 *   - PAD Depth (geometric depth from landmarks)
 *   - Overall composite score
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Heart, Activity, Layers, Box } from 'lucide-react'
import type { VeriFaceLivenessReport } from '@/sdk/veriface'

interface LivenessPanelProps {
  liveness: VeriFaceLivenessReport | null
  threshold: number
}

export function LivenessPanel({ liveness, threshold }: LivenessPanelProps) {
  const scores = liveness
    ? [
        {
          label: 'rPPG (Blood Flow)',
          value: liveness.rppg,
          icon: Heart,
          detail: liveness.rppgHeartRateBpm
            ? `${liveness.rppgHeartRateBpm} BPM • SNR ${liveness.rppgSnr.toFixed(1)} dB`
            : `SNR ${liveness.rppgSnr.toFixed(1)} dB`,
          color: 'text-rose-400',
        },
        {
          label: 'PAD Micro-Texture',
          value: liveness.padTexture,
          icon: Activity,
          detail: 'Laplacian variance (deepfake fingerprint)',
          color: 'text-amber-400',
        },
        {
          label: 'PAD Depth',
          value: liveness.padDepth,
          icon: Box,
          detail: 'Geometric depth from landmarks',
          color: 'text-cyan-400',
        },
        {
          label: 'Overall Liveness',
          value: liveness.overall,
          icon: Layers,
          detail: liveness.overall >= threshold
            ? `Pass (≥ ${threshold})`
            : `Below threshold (${threshold})`,
          color: liveness.overall >= threshold ? 'text-emerald-400' : 'text-red-400',
        },
      ]
    : [
        { label: 'rPPG (Blood Flow)', value: 0, icon: Heart, detail: 'Awaiting capture', color: 'text-slate-500' },
        { label: 'PAD Micro-Texture', value: 0, icon: Activity, detail: 'Awaiting capture', color: 'text-slate-500' },
        { label: 'PAD Depth', value: 0, icon: Box, detail: 'Awaiting capture', color: 'text-slate-500' },
        { label: 'Overall Liveness', value: 0, icon: Layers, detail: 'Awaiting capture', color: 'text-slate-500' },
      ]

  return (
    <Card className="bg-slate-900/50 border-slate-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-slate-200 flex items-center justify-between">
          <span>Passive Liveness Signals</span>
          {liveness && (
            <Badge
              variant="outline"
              className={
                liveness.overall >= threshold
                  ? 'bg-emerald-950/50 text-emerald-300 border-emerald-700'
                  : 'bg-red-950/50 text-red-300 border-red-700'
              }
            >
              {liveness.overall >= threshold ? 'PASS' : 'FAIL'}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {scores.map((s) => {
          const Icon = s.icon
          return (
            <div key={s.label} className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className={`flex items-center gap-1.5 ${s.color}`}>
                  <Icon className="w-3 h-3" />
                  <span className="text-slate-300">{s.label}</span>
                </span>
                <span className="font-mono text-slate-200">
                  {(s.value * 100).toFixed(1)}%
                </span>
              </div>
              <Progress
                value={s.value * 100}
                className="h-1.5 bg-slate-800"
              />
              <p className="text-[10px] text-slate-500">{s.detail}</p>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
