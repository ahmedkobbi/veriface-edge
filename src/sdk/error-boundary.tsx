'use client'

/**
 * VeriFace Edge SDK — React Error Boundary
 *
 * Catches errors thrown by the VeriFace SDK during render.
 * Displays a user-friendly error message instead of a white screen.
 *
 * Usage:
 *   <VeriFaceErrorBoundary>
 *     <DemoConsole />
 *   </VeriFaceErrorBoundary>
 */

import { Component, type ReactNode, type ErrorInfo } from 'react'

interface Props {
  children: ReactNode
  fallback?: (error: Error, reset: () => void) => ReactNode
  onError?: (error: Error, info: ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class VeriFaceErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[VeriFace] Error boundary caught:', error, info)
    this.props.onError?.(error, info)
  }

  reset = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.reset)
      }
      return (
        <div
          role="alert"
          className="rounded-xl border border-red-500/20 bg-red-500/5 p-4 text-sm"
        >
          <p className="font-medium text-red-300 mb-1">Authentication Error</p>
          <p className="text-red-400/80 text-xs">{this.state.error.message}</p>
          <button
            onClick={this.reset}
            className="mt-3 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/20"
          >
            Try Again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
