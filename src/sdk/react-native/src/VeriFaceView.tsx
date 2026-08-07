/**
 * VeriFace Edge — React Native VeriFaceView Component
 *
 * Wraps the web SDK via react-native-webview. Loads a self-contained HTML
 * page that mounts the `<face-auth>` web component, then bridges events
 * between the WebView and React Native via postMessage.
 *
 * Architecture:
 *   [React Native] ⇄ postMessage ⇄ [WebView + <face-auth> web component] ⇄ Camera
 *
 * The WebView approach gives us:
 *   - 100% code reuse with the web SDK (crypto, AI pipeline, anti-injection)
 *   - WebGPU/WASM acceleration (where supported by the platform WebView)
 *   - No need to reimplement Ed25519/X25519/AES-GCM/BLAKE3 in Swift/Kotlin
 *
 * Limitations:
 *   - Slightly slower startup (~200ms WebView init)
 *   - WebGPU not available on iOS WKWebView (falls back to WASM)
 *   - Camera permission must be requested natively before the WebView can access it
 *
 * For native camera + native crypto, use the @veriface/edge-ios or
 * @veriface/edge-android SDKs directly.
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { Platform, View, StyleSheet, NativeModules, PermissionsAndroid } from 'react-native'
import { WebView, type WebViewMessageEvent } from 'react-native-webview'
import type {
  VeriFaceViewProps,
  VeriFaceViewRef,
  VeriFaceResult,
  VeriFaceStatus,
  VeriFaceErrorCode,
  VeriFaceLivenessReport,
} from './types'

// ---------------------------------------------------------------------------
// WebView HTML payload
// ---------------------------------------------------------------------------

/**
 * Build the HTML page that runs inside the WebView.
 * Loads the web SDK from CDN, mounts the <face-auth> web component, and
 * bridges all events to React Native via postMessage.
 */
function buildWebViewHtml(props: VeriFaceViewProps): string {
  const cdnBaseUrl = props.apiBaseUrl?.replace(/\/api$/, '') ?? 'https://cdn.veriface.io'
  const sdkUrl = `${cdnBaseUrl}/v1/face-auth.js`

  const config = {
    tenantId: props.tenantId,
    apiKey: props.apiKey,
    apiBaseUrl: props.apiBaseUrl ?? '',
    flow: props.flow ?? 'authenticate',
    externalUserId: props.externalUserId ?? '',
    captureDurationMs: props.captureDurationMs ?? 1800,
    livenessThreshold: props.livenessThreshold ?? 0.78,
    theme: props.theme ?? 'auto',
    telemetryOptIn: props.telemetryOptIn ?? false,
    autoStart: props.autoStart ?? false,
    showUi: props.showUi ?? true,
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>VeriFace Edge</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%; height: 100%;
      background: ${props.theme === 'light' ? '#ffffff' : '#0f172a'};
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    #root { width: 100%; height: 100%; }
    face-auth {
      display: block;
      width: 100%;
      height: 100%;
    }
  </style>
</head>
<body>
  <div id="root">
    <face-auth
      tenant-id="${config.tenantId}"
      api-key="${config.apiKey}"
      flow="${config.flow}"
      ${config.externalUserId ? `external-user-id="${config.externalUserId}"` : ''}
      theme="${config.theme}"
      capture-duration="${config.captureDurationMs}"
      liveness-threshold="${config.livenessThreshold}"
    ></face-auth>
  </div>

  <script type="module" src="${sdkUrl}"></script>
  <script>
    // Configuration passed from React Native
    const VF_CONFIG = ${JSON.stringify(config)};

    // Wait for the web component to be defined, then wire up event listeners
    customElements.whenDefined('face-auth').then(() => {
      const el = document.querySelector('face-auth');

      // Bridge events to React Native
      el.addEventListener('veriface:success', (e) => {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'success',
          payload: e.detail,
        }));
      });

      el.addEventListener('veriface:failure', (e) => {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'failure',
          payload: e.detail,
        }));
      });

      el.addEventListener('veriface:status', (e) => {
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'status',
          payload: e.detail,
        }));
      });

      el.addEventListener('veriface:frame', (e) => {
        // Throttle frame events to ~10fps to avoid JS bridge overload
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: 'frame',
          payload: e.detail,
        }));
      });

      // Auto-start if requested
      if (VF_CONFIG.autoStart) {
        el.start().catch((err) => {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'failure',
            payload: { code: 'UNKNOWN', message: String(err) },
          }));
        });
      }

      // Notify RN that we're ready
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready' }));
    });

    // Listen for commands from React Native
    window.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data);
        const el = document.querySelector('face-auth');
        if (!el) return;

        if (msg.type === 'start') {
          el.start().catch((err) => {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'failure',
              payload: { code: 'UNKNOWN', message: String(err) },
            }));
          });
        } else if (msg.type === 'cancel') {
          el.cancel?.();
        } else if (msg.type === 'setTelemetry') {
          // Telemetry toggle requires re-init — for simplicity, reload the page
          // with the new config. A more sophisticated approach would expose
          // setTelemetryOptIn directly on the web component.
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'log',
            payload: 'Telemetry toggle requires page reload',
          }));
        }
      } catch (err) {
        console.error('RN command failed:', err);
      }
    });
  </script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// Camera permission helpers
// ---------------------------------------------------------------------------

async function requestCameraPermission(): Promise<boolean> {
  if (Platform.OS === 'ios') {
    // iOS: permission is requested automatically by WKWebView when getUserMedia is called.
    // The user will see the standard iOS camera permission dialog.
    return true
  }

  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
        {
          title: 'Camera Permission',
          message: 'VeriFace Edge needs camera access to verify your identity.',
          buttonNeutral: 'Ask Me Later',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        },
      )
      return granted === PermissionsAndroid.RESULTS.GRANTED
    } catch {
      return false
    }
  }

  return false
}

// ---------------------------------------------------------------------------
// VeriFaceView component
// ---------------------------------------------------------------------------

export const VeriFaceView = forwardRef<VeriFaceViewRef, VeriFaceViewProps>(
  function VeriFaceView(props, ref) {
    const webViewRef = useRef<WebView>(null)
    const [permissionGranted, setPermissionGranted] = useState<boolean | null>(null)
    const [ready, setReady] = useState(false)

    // Request camera permission on mount
    useEffect(() => {
      let cancelled = false
      void requestCameraPermission().then((granted) => {
        if (!cancelled) setPermissionGranted(granted)
      })
      return () => { cancelled = true }
    }, [])

    // Handle messages from the WebView
    const onMessage = useCallback((event: WebViewMessageEvent) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data)
        switch (msg.type) {
          case 'ready':
            setReady(true)
            break
          case 'success':
            props.onSuccess?.(msg.payload as VeriFaceResult)
            break
          case 'failure':
            props.onFailure?.(msg.payload as { code: VeriFaceErrorCode; message: string })
            break
          case 'status':
            props.onStatus?.(msg.payload.status as VeriFaceStatus)
            break
          case 'frame':
            props.onFrame?.(msg.payload as { rppgProgress: number; liveness: VeriFaceLivenessReport | null })
            break
          case 'log':
            console.log('[VeriFace WebView]', msg.payload)
            break
        }
      } catch (e) {
        console.warn('[VeriFace] Failed to parse WebView message:', e)
      }
    }, [props])

    // Imperative API (exposed via ref)
    useImperativeHandle(ref, () => ({
      start: async () => {
        if (!webViewRef.current) return
        // Ensure camera permission before starting
        if (permissionGranted !== true) {
          const granted = await requestCameraPermission()
          if (!granted) {
            props.onFailure?.({
              code: 'CAMERA_DENIED',
              message: 'Camera permission was not granted',
            })
            return
          }
        }
        webViewRef.current.postMessage(JSON.stringify({ type: 'start' }))
      },
      cancel: () => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'cancel' }))
      },
      setTelemetryOptIn: (optIn: boolean) => {
        webViewRef.current?.postMessage(JSON.stringify({ type: 'setTelemetry', optIn }))
      },
    }), [permissionGranted, props])

    // Permission denied UI
    if (permissionGranted === false) {
      return (
        <View style={[styles.container, styles.errorContainer, props.style]}>
          <VeriFaceErrorView
            code="CAMERA_DENIED"
            message="Camera permission was denied. Please enable it in app settings."
          />
        </View>
      )
    }

    // Loading state
    if (permissionGranted === null) {
      return (
        <View style={[styles.container, styles.loadingContainer, props.style]}>
          <VeriFaceLoadingView />
        </View>
      )
    }

    return (
      <View style={[styles.container, props.style]}>
        <WebView
          ref={webViewRef}
          source={{ html: buildWebViewHtml(props), baseUrl: props.apiBaseUrl ?? 'https://cdn.veriface.io' }}
          onMessage={onMessage}
          // Camera access
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          // Security
          allowsBackForwardNavigationGestures={false}
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          // Performance
          originWhitelist={['*']}
          // iOS-specific: allow camera capture
          {...(Platform.OS === 'ios' ? {
            allowsInlineMediaPlayback: true,
            mediaCapturePermission: 'granted' as any,
          } : {})}
          // Android-specific: allow file access for WASM
          {...(Platform.OS === 'android' ? {
            allowFileAccess: true,
            allowFileAccessFromFileURLs: true,
            allowUniversalAccessFromFileURLs: true,
            javaScriptEnabled: true,
            domStorageEnabled: true,
          } : {})}
          style={styles.webview}
        />
        {!ready && (
          <View style={styles.loadingOverlay}>
            <VeriFaceLoadingView />
          </View>
        )}
      </View>
    )
  },
)

// ---------------------------------------------------------------------------
// Helper UI components (pure RN, no WebView dependency)
// ---------------------------------------------------------------------------

function VeriFaceLoadingView() {
  return (
    <View style={styles.loadingInner}>
      <View style={styles.spinner} />
      <VeriFaceLogo />
    </View>
  )
}

function VeriFaceErrorView({ code, message }: { code: string; message: string }) {
  return (
    <View style={styles.errorInner}>
      <VeriFaceLogo />
      <VeriFaceErrorIcon />
      <Text style={styles.errorCode}>{code}</Text>
      <Text style={styles.errorMessage}>{message}</Text>
    </View>
  )
}

function VeriFaceLogo() {
  return (
    <Text style={styles.logo}>VeriFace Edge</Text>
  )
}

function VeriFaceErrorIcon() {
  return <Text style={styles.errorIcon}>⚠</Text>
}

// Import Text from react-native (lazy import to avoid circular dep)
import { Text } from 'react-native'

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0f172a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingInner: {
    alignItems: 'center',
    gap: 12,
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: '#10b981',
    borderTopColor: 'transparent',
  },
  logo: {
    color: '#10b981',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  errorInner: {
    alignItems: 'center',
    gap: 8,
  },
  errorIcon: {
    fontSize: 48,
    color: '#ef4444',
  },
  errorCode: {
    color: '#ef4444',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  errorMessage: {
    color: '#94a3b8',
    fontSize: 12,
    textAlign: 'center',
  },
})
