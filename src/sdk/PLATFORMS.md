# VeriFace Edge — Multi-Platform SDK

Privacy-first facial authentication for web, iOS, Android, React Native, and Flutter.

## Platform SDKs

| Platform | Package | Crypto | Camera | Face Detection | Status |
|----------|---------|--------|--------|----------------|--------|
| **Web** | `@veriface/edge-sdk` | @noble (Ed25519, X25519, AES-GCM, BLAKE3) | getUserMedia | MediaPipe | Production |
| **React Native** | `@veriface/edge-react-native` | WebView (delegates to web SDK) | WebView | WebView | Production |
| **iOS** | `VeriFaceEdge` (SPM) | CryptoKit + BLAKE3.swift | AVFoundation | Vision | Beta |
| **Android** | `io.veriface:edge-sdk-android` | BouncyCastle | CameraX | ML Kit | Beta |
| **Flutter** | `veriface_edge` | `cryptography` package | `camera` plugin | `google_mlkit_face_detection` | Beta |

## Privacy Contract (all platforms)

1. **All biometric computation runs on-device** — face detection, rPPG, PAD, and embedding never leave the device.
2. **Only cryptographic payloads are sent to the backend**:
   - Pedersen commitment: `BLAKE3(embedding || nonce)` — proves the SDK computed the embedding honestly
   - Encrypted embedding: AES-256-GCM with the session ECDH key
   - Scalar liveness scores (rPPG, PAD) and anti-injection summary
3. **End-to-end encrypted**: The session key is derived via X25519 ECDH between SDK and backend — even the backend can't decrypt without the ephemeral session key.
4. **No face frames, no embeddings, no PII are ever stored on disk** by the SDK.
5. **Telemetry is opt-in and anonymous** — error codes only, no biometric data.

## Quick Start

### Web
```bash
npm install @veriface/edge-sdk
```
```ts
import { VeriFace } from '@veriface/edge-sdk'
const vf = new VeriFace({ tenantId: 'tnt_...', apiKey: 'vf_live_...' })
const result = await vf.authenticate(externalUserId: 'user_123')
```

### React Native
```bash
npm install @veriface/edge-react-native react-native-webview
cd ios && pod install
```
```tsx
import { VeriFaceView } from '@veriface/edge-react-native'
<VeriFaceView
  tenantId="tnt_..."
  apiKey="vf_live_..."
  flow="authenticate"
  externalUserId="user_123"
  onSuccess={(result) => console.log(result.token)}
  onFailure={(error) => console.error(error)}
/>
```

### iOS (Swift Package Manager)
```swift
.package(url: "https://github.com/veriface/edge-sdk-ios.git", from: "1.0.0")
```
```swift
import VeriFaceEdge
let client = VeriFaceClient(config: VeriFaceConfig(
    tenantId: "tnt_...", apiKey: "vf_live_...",
    apiBaseUrl: URL(string: "https://api.veriface.io")!
))
let result = try await client.authenticate(externalUserId: "user_123")
```

### Android (Gradle)
```kotlin
implementation("io.veriface:edge-sdk-android:1.0.0")
```
```kotlin
val client = VeriFaceClient(context, VeriFaceConfig(
    tenantId = "tnt_...", apiKey = "vf_live_..."
))
val result = client.authenticate(externalUserId = "user_123")
```

### Flutter
```yaml
# pubspec.yaml
dependencies:
  veriface_edge: ^1.0.0
```
```dart
import 'package:veriface_edge/veriface_edge.dart';
VeriFaceWidget(
  config: VeriFaceConfig(tenantId: '...', apiKey: '...'),
  flow: 'authenticate',
  externalUserId: 'user_123',
  onSuccess: (result) => print(result.token),
  onFailure: (error) => print(error),
)
```

## Architecture Comparison

| Aspect | Web | React Native | iOS Native | Android Native | Flutter |
|--------|-----|--------------|-----------|---------------|---------|
| Crypto | @noble | WebView | CryptoKit | BouncyCastle | cryptography pkg |
| Camera | getUserMedia | WebView | AVFoundation | CameraX | camera plugin |
| Face det. | MediaPipe | WebView | Vision | ML Kit | google_mlkit |
| Code reuse | 100% (web is source) | 100% (wraps web) | 0% (native reimpl.) | 0% (native reimpl.) | 0% (Dart reimpl.) |
| Performance | WebGPU/WASM | WebView overhead | Native ( fastest ) | Native | Slight bridge overhead |
| Bundle size | ~150KB | ~10KB + WebView | ~50KB + BoringSSL | ~80KB + BouncyCastle | ~200KB |

## When to Use Which?

- **Web**: Always for websites.
- **React Native**: When you want one codebase for iOS+Android with minimal native code. Best when you already use the web SDK.
- **iOS Native**: When you need maximum performance, native UI, or want to leverage Apple Vision/CryptoKit hardware acceleration.
- **Android Native**: When you need maximum performance, native UI, or tight CameraX integration.
- **Flutter**: When your app is already Flutter. Avoids WebView overhead of the RN SDK.

## Crypto Cross-Platform Compatibility

All SDKs implement the same crypto stack, so a session initiated by one SDK can be verified by the backend regardless of the originating platform:

| Primitive | Web | iOS | Android | Flutter |
|-----------|-----|-----|---------|---------|
| Ed25519 signing | @noble/ed25519 | CryptoKit.Curve25519.Signing | BouncyCastle Ed25519Signer | cryptography Ed25519() |
| X25519 ECDH | @noble/curves | CryptoKit.Curve25519.KeyAgreement | BouncyCastle X25519Agreement | cryptography X25519() |
| AES-256-GCM | @noble/ciphers | CryptoKit.AES.GCM | BouncyCastle GCMBlockCipher | cryptography AesGcm.with256bits() |
| BLAKE3 | @noble/hashes | BLAKE3.swift | BouncyCastle Blake3Digest | cryptography Blake3() |
| HKDF-SHA256 | @noble/hashes | CryptoKit.HKDF<SHA256> | BouncyCastle HKDFBytesGenerator | cryptography HkdfSha256() |
| SHA-256 | @noble/hashes | CryptoKit.SHA256 | BouncyCastle SHA256Digest | cryptography Sha256() |

## Backend Compatibility

All SDKs target the same backend API:
- `POST /api/session/init` — initialize session, get challenge + backend X25519 pubkey
- `POST /api/session/verify` — submit signed + encrypted verification payload

The payload schema is identical across platforms — the backend doesn't know (or care) which SDK produced it.
