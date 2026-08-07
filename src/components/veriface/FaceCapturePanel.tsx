'use client'

/**
 * VeriFace Edge — Live Capture Panel
 *
 * Live video preview with face bounding box overlay + landmark dots.
 * Updates per frame from the SDK's onFrame callback.
 */

import { useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { DetectedFace } from '@/sdk/ai-pipeline'

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
    <Card className="relative overflow-hidden p-0 aspect-video bg-slate-950 border-slate-800">
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

      {/* Top-left status badge */}
      <div className="absolute top-3 left-3 flex flex-col gap-2">
        <Badge variant={status === 'capturing' ? 'default' : 'secondary'}
          className={status === 'capturing'
            ? 'bg-emerald-600 text-white'
            : status === 'failed'
            ? 'bg-red-600 text-white'
            : ''
          }
        >
          {status === 'capturing' ? '● LIVE CAPTURE' : status.toUpperCase()}
        </Badge>
        {face ? (
          <Badge variant="outline" className="bg-slate-900/80 text-emerald-300 border-emerald-700">
            Face: {(face.detectionConfidence * 100).toFixed(0)}%
          </Badge>
        ) : status === 'capturing' ? (
          <Badge variant="outline" className="bg-slate-900/80 text-amber-300 border-amber-700">
            Searching for face…
          </Badge>
        ) : null}
      </div>

      {/* rPPG progress bar */}
      {status === 'capturing' && (
        <div className="absolute bottom-3 left-3 right-3">
          <div className="flex justify-between text-xs text-slate-300 mb-1">
            <span>rPPG Sample Buffer</span>
            <span>{Math.floor(rppgProgress * 72)}/72 frames</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-150"
              style={{ width: `${Math.min(100, rppgProgress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Sub-perceptible strobe indicator (UI debug only — actual strobe is invisible) */}
      {strobeActive && status === 'capturing' && (
        <div className="absolute top-3 right-3">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
        </div>
      )}
    </Card>
  )
}
