'use client'

/**
 * VeriFace Edge — Premium Loading Skeleton
 *
 * Shimmer-animated skeleton screens for loading states.
 * More premium than spinners — shows the shape of upcoming content.
 */

import { cn } from '@/lib/utils'

interface SkeletonProps {
  className?: string
}

export function ShimmerSkeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md bg-slate-800/50',
        'before:absolute before:inset-0 before:-translate-x-full',
        'before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r',
        'before:from-transparent before:via-white/5 before:to-transparent',
        className,
      )}
    >
      <style jsx>{`
        @keyframes shimmer {
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}

export function FaceCaptureSkeleton() {
  return (
    <div className="space-y-4">
      <ShimmerSkeleton className="aspect-video w-full rounded-xl" />
      <div className="flex gap-2">
        <ShimmerSkeleton className="h-10 flex-1 rounded-lg" />
        <ShimmerSkeleton className="h-10 flex-1 rounded-lg" />
      </div>
    </div>
  )
}

export function LivenessPanelSkeleton() {
  return (
    <div className="space-y-4 p-4 rounded-xl border border-slate-800 bg-slate-900/50">
      <ShimmerSkeleton className="h-4 w-32" />
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex justify-between">
            <ShimmerSkeleton className="h-3 w-24" />
            <ShimmerSkeleton className="h-3 w-10" />
          </div>
          <ShimmerSkeleton className="h-1.5 w-full" />
        </div>
      ))}
    </div>
  )
}

export function AuditLogSkeleton() {
  return (
    <div className="space-y-2 p-4 rounded-xl border border-slate-800 bg-slate-900/50">
      <ShimmerSkeleton className="h-4 w-40 mb-4" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-1.5 p-2 rounded-md border border-slate-800/50">
          <div className="flex justify-between">
            <ShimmerSkeleton className="h-3 w-20" />
            <ShimmerSkeleton className="h-3 w-16" />
          </div>
          <ShimmerSkeleton className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}
