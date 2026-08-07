'use client'

/**
 * VeriFace Edge — Live Capture Panel
 *
 * Live video preview with face bounding box overlay + landmark dots.
 * Updates per frame from the SDK's onFrame callback.
 */

import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import type { DetectedFace } from '@/sdk/ai-pipeline'
import { GlassSurface, GlassBadge } from '@/components/premium/Glass'
import { PremiumSpinner, PremiumProgress } from '@/components/premium/Premium'

interface FaceCapturePanelProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  face: DetectedFace | null
  rppgProgress: number
  status: string
  strobeActive?: boolean
}

export function FaceCapturePanel({
  videoRef,
  face,
  rppgProgress,
  status,
  strobeActive,
}: FaceCapturePanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (face) {
      const { width, height } = canvas
      const bbox = face.boundingBox

      // Bounding box
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 2
      ctx.strokeRect(
        bbox.x * width,
        bbox.y * height,
        bbox.width * width,
        bbox.height * height,
      )

      // Corner markers
      ctx.fillStyle = '#10b981'
      const cornerSize = 12
      const corners = [
        [bbox.x * width, bbox.y * height],
        [(bbox.x + bbox.width) * width, bbox.y * height],
        [bbox.x * width, (bbox.y + bbox.height) * height],
        [(bbox.x + bbox.width) * width, (bbox.y + bbox.height) * height],
      ]
      for (const [x, y] of corners) {
        ctx.fillRect(x - cornerSize / 2, y - cornerSize / 2, cornerSize, cornerSize)
      }

      // Key landmarks
      ctx.fillStyle = '#f59e0b'
      const keyIndices = [33, 263, 1, 61, 291]
      for (const idx of keyIndices) {
        const lm = face.landmarks[idx]
        if (lm) {
          ctx.beginPath()
          ctx.arc(lm.x * width, lm.y * height, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
  }, [face])

  return (
    <GlassSurface blur="2xl" opacity="heavy" className="relative overflow-hidden aspect-video rounded-2xl">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover -scale-x-100"
      />
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        className="absolute inset-0 w-full h-full -scale-x-100 pointer-events-none"
      />

      {/* Idle spinner overlay */}
      {status === 'idle' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50">
          <div className="flex flex-col items-center gap-3">
            <PremiumSpinner size="xl" variant="pulse" />
            <span className="text-xs text-slate-400">Awaiting capture</span>
          </div>
        </div>
      )}

      {/* Top-left status badge */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <GlassBadge variant={
          status === 'capturing' ? 'success' :
          status === 'failed' ? 'error' :
          status === 'success' ? 'success' :
          'default'
        }>
          {status === 'capturing' && <PremiumSpinner size="xs" variant="dots" />}
          {status === 'capturing' ? 'LIVE CAPTURE' : status.toUpperCase()}
        </GlassBadge>
        {face ? (
          <GlassBadge variant="success">
            Face: {(face.detectionConfidence * 100).toFixed(0)}%
          </GlassBadge>
        ) : status === 'capturing' ? (
          <GlassBadge variant="warning">
            Searching for face…
          </GlassBadge>
        ) : null}
      </div>

      {/* rPPG progress bar — premium version */}
      {status === 'capturing' && (
        <div className="absolute bottom-3 left-3 right-3">
          <div className="flex justify-between text-xs text-slate-300 mb-1.5">
            <span className="font-medium">rPPG Sample Buffer</span>
            <span className="font-mono text-emerald-300">{Math.floor(rppgProgress * 72)}/72 frames</span>
          </div>
          <PremiumProgress
            value={rppgProgress * 100}
            size="sm"
            variant="glow"
          />
        </div>
      )}

      {/* Sub-perceptible strobe indicator */}
      {strobeActive && status === 'capturing' && (
        <div className="absolute top-3 right-3">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        </div>
      )}
    </GlassSurface>
  )
}
