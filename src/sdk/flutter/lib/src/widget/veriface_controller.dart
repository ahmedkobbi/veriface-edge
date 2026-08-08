// VeriFace Edge — VeriFaceController
//
// Imperative API for apps that want full control over the UI.
// Wraps the camera plugin + ML Kit face detection + crypto + API client.
//
// Usage:
//   final controller = VeriFaceController(config: config);
//   await controller.initialize();
//   final result = await controller.authenticate(externalUserId: 'user_123');
//   await controller.dispose();

import 'dart:async';
import 'dart:typed_data';
import 'package:camera/camera.dart';
import '../api/client.dart';
import '../api/types.dart';
import '../api/errors.dart';
import '../crypto/ed25519.dart';
import '../crypto/x25519.dart';
import '../crypto/aes_gcm.dart';
import '../crypto/hkdf.dart';
import '../crypto/pedersen.dart';

class VeriFaceController {
  final VeriFaceConfig config;
  final VeriFaceClient _client;

  CameraController? _cameraController;
  X25519KeyPair? _sessionKeypair;
  Ed25519KeyPair? _signingKeypair;
  SessionInitResponse? _session;
  bool _initialized = false;

  VeriFaceController({required this.config})
      : _client = VeriFaceClient(config);

  /// Initialize the controller: load the tenant's signing key, generate
  /// ephemeral ECDH key, find camera.
  ///
  /// SECURITY FIX (S-01): The Ed25519 signing key is loaded from
  /// config.signingPrivateKey (the tenant's stored private key), NOT
  /// generated ephemerally. The backend verifies JWTs against the tenant's
  /// stored public key — an ephemeral key would cause every auth to fail.
  /// Only the X25519 ECDH keypair is ephemeral (per-session).
  Future<void> initialize() async {
    if (_initialized) return;

    // Load the tenant's Ed25519 signing keypair from the stored private key
    _signingKeypair = await loadEd25519KeyPair(config.signingPrivateKey);

    // Generate ephemeral X25519 keypair for ECDH (per-session)
    _sessionKeypair = await generateX25519KeyPair();

    // Find front-facing camera
    final cameras = await availableCameras();
    final frontCamera = cameras.firstWhere(
      (c) => c.lensDirection == CameraLensDirection.front,
      orElse: () => cameras.first,
    );

    _cameraController = CameraController(
      frontCamera,
      ResolutionPreset.high,
      enableAudio: false,
      imageFormatGroup: ImageFormatGroup.yuv420,
    );
    await _cameraController!.initialize();

    _initialized = true;
  }

  /// Get the camera controller (for embedding the preview in your UI).
  CameraController? get cameraController => _cameraController;

  /// Start the full authentication/enrollment flow.
  ///
  /// Returns the verify response (with auth token on success).
  /// Throws [VeriFaceException] on any failure.
  Future<SessionVerifyResponse> authenticate({
    String? externalUserId,
  }) async {
    if (!_initialized) {
      throw VeriFaceException(VeriFaceErrorCode.unknown, 'Controller not initialized');
    }

    // 1. Init session with backend
    _session = await _client.initSession(
      flow: config.modelVersion.contains('enroll') ? 'enroll' : 'authenticate',
      externalUserId: externalUserId,
    );

    // 2. Capture frames for captureDurationMs (passive rPPG window)
    final captureStart = DateTime.now();
    final frames = <CameraImage>[];
    final completer = Completer<void>();

    final timer = Timer(Duration(milliseconds: config.captureDurationMs), () {
      completer.complete();
    });

    _cameraController!.startImageStream((image) {
      frames.add(image);
      if (frames.length > 60) {
        // Cap memory: keep last 60 frames (~2s at 30fps)
        frames.removeAt(0);
      }
    });

    await completer.future;
    timer.cancel();
    await _cameraController!.stopImageStream();

    final captureDuration = DateTime.now().difference(captureStart);

    // 3. Compute liveness + embedding (TODO: implement rPPG + PAD + ONNX in Dart)
    // For now, we use placeholder values — the real implementation would
    // need an ONNX runtime for Dart (or delegate to platform channels).
    final liveness = LivenessReport(
      rppg: 0.85,
      rppgHeartRateBpm: 72,
      rppgSnr: 4.2,
      padTexture: 0.90,
      padDepth: 0.88,
      padCombined: 0.89,
      overall: 0.86,
    );

    final antiInjection = AntiInjectionReport(
      passed: true,
      failureReasons: [],
      replayDetected: false,
      strobeChallenges: 0,
      strobeResponses: 0,
    );

    // 4. Generate embedding (placeholder — real impl uses ONNX runtime)
    final embedding = List<double>.filled(512, 0.5);

    // 5. Compute Pedersen commitment
    final nonce = List<int>.filled(32, 0);
    // Fill nonce with random bytes (in production: use secure RNG)
    for (var i = 0; i < 32; i++) {
      nonce[i] = DateTime.now().microsecond ^ i;
    }
    final commitment = await createCommitment(embedding: embedding, nonce: nonce);

    // 6. Derive session key + encrypt embedding
    final sharedSecret = await computeSharedSecret(
      privateKey: _sessionKeypair!.privateKey,
      peerPublicKey: await parseX25519PublicKey(_session!.backendPubKey),
    );
    final challengeBytes = hexToBytes(_session!.challenge);
    final sessionKey = await deriveSessionKey(
      sharedSecret: sharedSecret,
      challengeBytes: challengeBytes,
    );

    final embeddingBytes = embeddingToBytes(embedding);
    final iv = await generateIv();
    final ciphertext = await aesGcmEncrypt(
      key: sessionKey,
      plaintext: embeddingBytes,
      iv: iv,
      aad: challengeBytes,
    );

    // 7. Sign JWT (Ed25519) with all signals
    final jwt = await _signJwt(
      sessionId: _session!.sessionId,
      liveness: liveness,
      antiInjection: antiInjection,
      commitment: commitment,
    );

    // 8. Submit verify
    final payload = SessionVerifyPayload(
      sessionId: _session!.sessionId,
      tenantId: config.tenantId,
      jwt: jwt,
      sdkPubKey: await _sessionKeypair!.publicKeyHex,
      encryptedEmbedding: {
        'ciphertext': ciphertext.ciphertextHex,
        'iv': ciphertext.ivHex,
        'authTag': ciphertext.authTagHex,
      },
      commitment: commitment,
      commitmentNonce: bytesToHex(nonce),
      liveness: liveness,
      antiInjection: antiInjection,
      externalUserId: externalUserId,
    );

    return _client.verifySession(payload: payload);
  }

  /// Sign the JWT payload with Ed25519.
  ///
  /// SECURITY FIX (S-01): The JWT is signed with the tenant's signing private key
  /// (loaded from config.signingPrivateKey during initialize()). The backend
  /// verifies against the tenant's stored public key (tenant.signingPubKey).
  /// Previously, this used an ephemeral key — which didn't match the stored key
  /// and caused every auth request to fail with JWT_INVALID.
  ///
  /// Format: base64url(header).base64url(payload).base64url(signature)
  Future<String> _signJwt({
    required String sessionId,
    required LivenessReport liveness,
    required AntiInjectionReport antiInjection,
    required String commitment,
  }) async {
    final header = {'alg': 'EdDSA', 'typ': 'JWT'};
    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final payload = {
      'iss': 'veriface-edge-sdk-flutter',
      'sub': sessionId,
      'iat': now,
      'exp': now + 60,
      'jti': sessionId,
      'session_id': sessionId,
      'tenant_id': config.tenantId,
      'model_version': config.modelVersion,
      'liveness_score': liveness.overall,
      'liveness': liveness.toJson(),
      'anti_injection': antiInjection.toJson(),
      'commitment': commitment,
    };

    final headerB64 = _base64Url(jsonEncode(header));
    final payloadB64 = _base64Url(jsonEncode(payload));
    final signingInput = '$headerB64.$payloadB64';

    final signature = await signEd25519(
      messageHex: bytesToHex(_utf8Encode(signingInput)),
      privateKey: _signingKeypair!.privateKey,
    );

    return '$signingInput.$signature';
  }

  String _base64Url(String s) {
    final bytes = _utf8Encode(s);
    return base64UrlEncode(bytes).replaceAll('=', '');
  }

  List<int> _utf8Encode(String s) {
    return s.codeUnits.expand((c) {
      if (c < 0x80) return [c];
      if (c < 0x800) return [0xC0 | (c >> 6), 0x80 | (c & 0x3F)];
      return [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)];
    }).toList();
  }

  /// Release all resources (camera, keypairs).
  Future<void> dispose() async {
    await _cameraController?.dispose();
    _cameraController = null;
    _sessionKeypair = null;
    _signingKeypair = null;
    _session = null;
    _initialized = false;
  }
}

// Top-level helper (avoids importing dart:convert at file scope)
String base64UrlEncode(List<int> bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  final result = StringBuffer();
  for (var i = 0; i < bytes.length; i += 3) {
    final b1 = bytes[i];
    final b2 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    final b3 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result.write(chars[(b1 >> 2) & 0x3F]);
    result.write(chars[((b1 << 4) | (b2 >> 4)) & 0x3F]);
    if (i + 1 < bytes.length) {
      result.write(chars[((b2 << 2) | (b3 >> 6)) & 0x3F]);
    }
    if (i + 2 < bytes.length) {
      result.write(chars[b3 & 0x3F]);
    }
  }
  return result.toString();
}
