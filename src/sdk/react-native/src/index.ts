/**
 * VeriFace Edge SDK — React Native bindings
 *
 * Exports the public API for iOS/Android apps:
 *   - <VeriFaceView /> component (wraps the web SDK via WebView)
 *   - useVeriFace() hook (imperative API)
 *   - VeriFaceError class
 *   - All TypeScript types
 */

export { VeriFaceView } from './VeriFaceView'
export { useVeriFace } from './useVeriFace'
export { VeriFaceError } from './errors'
export type {
  VeriFaceConfig,
  VeriFaceResult,
  VeriFaceStatus,
  VeriFaceLivenessReport,
  VeriFaceErrorCode,
} from './types'
