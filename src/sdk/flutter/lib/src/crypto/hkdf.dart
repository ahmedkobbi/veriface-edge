// VeriFace Edge — HKDF-SHA256 (Dart bindings)
//
// HKDF is used to derive the AES-256 session key from the X25519 shared
// secret + the backend's challenge nonce:
//   sessionKey = HKDF(sharedSecret, salt=challenge, info='veriface-session-v1', length=32)
//
// Also used to derive the tenant DEK (Data Encryption Key) — though DEK
// derivation happens server-side, not in the SDK.

import 'package:cryptography/cryptography.dart';
import 'ed25519.dart' show bytesToHex, hexToBytes;

/// HKDF-SHA256 extract+expand.
///
/// [ikm]  — Input Keying Material (e.g., X25519 shared secret, 32 bytes).
/// [salt] — Optional salt (e.g., session challenge nonce). If empty, defaults to a zero string of HashLen zeros.
/// [info] — Optional context info (e.g., 'veriface-session-v1').
/// [length] — Output length in bytes (max 255 * 32 = 8160).
Future<List<int>> hkdfSha256({
  required List<int> ikm,
  List<int>? salt,
  List<int>? info,
  required int length,
}) async {
  final algorithm = HkdfSha256();
  final secretKey = SecretKey(ikm);
  final derived = await algorithm.deriveKey(
    secretKey: secretKey,
    nonce: salt != null ? Nonce(salt) : null,
    info: info,
    length: length,
  );
  return derived.extractBytes();
}

/// Convenience: derive the AES-256 session key from an X25519 shared secret.
/// Mirrors the web SDK's `deriveSessionKey()` function.
///
/// Formula: HKDF(sharedSecret, salt=challengeBytes, info='veriface-session-v1', length=32)
Future<List<int>> deriveSessionKey({
  required List<int> sharedSecret,
  required List<int> challengeBytes,
}) async {
  return hkdfSha256(
    ikm: sharedSecret,
    salt: challengeBytes,
    info: utf8Encode('veriface-session-v1'),
    length: 32,
  );
}

// ---------------------------------------------------------------------------
// UTF-8 helper (re-exported for convenience)
// ---------------------------------------------------------------------------

List<int> utf8Encode(String s) {
  return s.codeUnits.expand((c) {
    if (c < 0x80) return [c];
    if (c < 0x800) return [0xC0 | (c >> 6), 0x80 | (c & 0x3F)];
    if (c < 0x10000) {
      return [0xE0 | (c >> 12), 0x80 | ((c >> 6) & 0x3F), 0x80 | (c & 0x3F)];
    }
    return [
      0xF0 | (c >> 18),
      0x80 | ((c >> 12) & 0x3F),
      0x80 | ((c >> 6) & 0x3F),
      0x80 | (c & 0x3F),
    ];
  }).toList();
}
