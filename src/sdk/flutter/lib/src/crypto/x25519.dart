// VeriFace Edge — X25519 ECDH (Dart bindings)
//
// Used for session key agreement: the SDK generates an ephemeral X25519
// keypair, sends the public key to the backend, and derives a shared
// session key (via HKDF-SHA256) that encrypts the biometric embedding
// for transit.

import 'package:cryptography/cryptography.dart';
import 'ed25519.dart' show bytesToHex, hexToBytes;

class X25519KeyPair {
  final SimplePublicKey publicKey;
  final SimplePrivateKey privateKey;

  X25519KeyPair(this.publicKey, this.privateKey);

  Future<String> get publicKeyHex async {
    final bytes = await publicKey.extractBytes();
    return bytesToHex(bytes);
  }
}

/// Generate a new X25519 keypair.
Future<X25519KeyPair> generateX25519KeyPair() async {
  final algorithm = X25519();
  final pair = await algorithm.newKeyPair();
  final publicKey = await pair.extractPublicKey();
  return X25519KeyPair(publicKey as SimplePublicKey, pair as SimplePrivateKey);
}

/// Compute the shared secret via X25519 ECDH.
/// Returns the raw 32-byte shared secret (use HKDF to derive the AES key).
Future<List<int>> computeSharedSecret({
  required SimplePrivateKey privateKey,
  required SimplePublicKey peerPublicKey,
}) async {
  final algorithm = X25519();
  return algorithm.sharedSecretKey(
    keyPair: privateKey,
    remotePublicKey: peerPublicKey,
  ).then((k) => k.extractBytes());
}

/// Parse an X25519 public key from hex.
Future<SimplePublicKey> parseX25519PublicKey(String hex) async {
  return SimplePublicKey(hexToBytes(hex), type: KeyPairType.x25519);
}
