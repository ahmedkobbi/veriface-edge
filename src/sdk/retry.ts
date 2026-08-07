/**
 * VeriFace Edge SDK — Retry with Exponential Backoff + Jitter
 *
 * Automatically retries failed network requests with increasing delays.
 * Prevents thundering herd via jitter (±25% randomization).
 *
 * Usage:
 *   const data = await retryWithBackoff(() => fetch('/api/session/init'), {
 *     maxAttempts: 3,
 *     onRetry: (attempt, error) => console.log(`Retry ${attempt}:`, error.message)
 *   })
 */

export interface RetryOptions {
  maxAttempts?: number  // default: 3
  initialDelayMs?: number  // default: 1000
  maxDelayMs?: number  // default: 30000
  jitter?: boolean  // default: true (±25%)
  retryOn?: (error: unknown) => boolean  // default: retry on network errors only
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void
  signal?: AbortSignal
}

const DEFAULT_RETRY_ON = (error: unknown): boolean => {
  // Retry on network errors, timeouts, 429, 5xx
  if (error instanceof TypeError) return true  // fetch network error
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof Error && error.message.includes('timeout')) return true
  // Check for retryable HTTP status codes
  const statusMatch = error?.message?.match(/HTTP (\d{3})/)
  if (statusMatch) {
    const code = parseInt(statusMatch[1], 10)
    return code === 429 || (code >= 500 && code < 600)
  }
  return false
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 1000,
    maxDelayMs = 30_000,
    jitter = true,
    retryOn = DEFAULT_RETRY_ON,
    onRetry,
    signal,
  } = options

  let lastError: unknown

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    // Check if aborted
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }

    try {
      return await fn()
    } catch (error) {
      lastError = error

      // Don't retry if this is the last attempt or error isn't retryable
      if (attempt >= maxAttempts || !retryOn(error)) {
        throw error
      }

      // Calculate delay: exponential backoff
      const baseDelay = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs)
      const jitterAmount = jitter ? baseDelay * 0.25 * (Math.random() * 2 - 1) : 0
      const delay = Math.max(100, baseDelay + jitterAmount)

      onRetry?.(attempt + 1, error, delay)

      // Wait before retrying
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, delay)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new DOMException('Aborted', 'AbortError'))
        }, { once: true })
      })
    }
  }

  throw lastError
}

/**
 * Create a retry-enabled fetch wrapper.
 * Usage:
 *   const fetchWithRetry = createRetryFetch({ maxAttempts: 3 })
 *   const res = await fetchWithRetry('/api/session/init', { ... })
 */
export function createRetryFetch(options: RetryOptions = {}) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    return retryWithBackoff(
      async () => {
        const res = await fetch(input, init)
        if (!res.ok && (res.status === 429 || res.status >= 500)) {
          throw new Error(`HTTP ${res.status}`)
        }
        return res
      },
      options,
    )
  }
}
