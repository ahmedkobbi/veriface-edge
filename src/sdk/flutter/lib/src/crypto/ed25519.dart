// VeriFace Edge — Ed25519 signing (Dart bindings)
//
// Uses the `cryptography` Flutter package (which delegates to BoringSSL on
// native platforms and WebCrypto on web). Ed25519 is used to sign the
// session JWT that the SDK sends to the backend — proving the SDK holds
// the tenant's signing key without revealing it.

import 'package:cryptography/cryptography.dart';

class Ed25519KeyPair {
  final SimplePublicKey publicKey;
  final SimplePrivateKey privateKey;

  Ed25519KeyPair(this.publicKey, this.privateKey);

  /// Public key as hex string (32 bytes → 64 hex chars).
  Future<String> get publicKeyHex async {
    final bytes = await publicKey.extractBytes();
    return bytesToHex(bytes);
  }

  /// Private key as hex string (32 bytes → 64 hex chars).
  Future<String> get privateKeyHex async {
    final bytes = await privateKey.extractBytes();
    return bytesToHex(bytes);
  }
}

/// Generate a new Ed25519 keypair.
Future<Ed25519KeyPair> generateEd25519KeyPair() async {
  final algorithm = Ed25519();
  final pair = await algorithm.newKeyPair();
  final publicKey = await pair.extractPublicKey();
  return Ed25519KeyPair(publicKey as SimplePublicKey, pair as SimplePrivateKey);
}

/// Sign a message with Ed25519. Returns the signature as hex (128 hex chars).
Future<String> signEd25519({
  required String messageHex,
  required SimplePrivateKey privateKey,
}) async {
  final algorithm = Ed25519();
  final signature = await algorithm.sign(
    hexToBytes(messageHex),
    keyPair: privateKey,
  );
  return bytesToHex(signature.bytes);
}

/// Verify an Ed25519 signature. Returns true if valid.
Future<bool> verifyEd25519({
  required String messageHex,
  required String signatureHex,
  required SimplePublicKey publicKey,
}) async {
  final algorithm = Ed25519();
  return algorithm.verify(
    hexToBytes(messageHex),
    signature: Signature(hexToBytes(signatureHex), publicKey: publicKey),
  );
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

String bytesToHex(List<int> bytes) {
  return bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
}

List<int> hexToBytes(String hex) {
  final result = <int>[];
  for (var i = 0; i < hex.length; i += 2) {
    result.add(int.parse(hex.substring(i, i + 2), radix: 16));
  }
  return result;
}
