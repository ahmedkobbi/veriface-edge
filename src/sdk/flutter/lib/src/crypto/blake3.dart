// VeriFace Edge — BLAKE3 (Dart bindings)
//
// BLAKE3 is the default hash for:
//   - Replay protection (per-frame frameHash in the anti-injection module)
//   - Pedersen commitment (commitment = BLAKE3(embedding || nonce))
//   - Audit log chain integrity
//
// We use the `cryptography` package's Blake3 implementation.

import 'package:cryptography/cryptography.dart';
import 'ed25519.dart' show bytesToHex, hexToBytes;

/// Compute BLAKE3 hash of [input] and return 32 raw bytes.
Future<List<int>> blake3Hash(List<int> input) async {
  final algorithm = Blake3();
  final hash = await algorithm.hash(input);
  return hash.bytes;
}

/// Compute BLAKE3 hash of [input] and return hex (64 chars).
Future<String> blake3Hex(List<int> input) async {
  final bytes = await blake3Hash(input);
  return bytesToHex(bytes);
}

/// Compute BLAKE3 hash of a UTF-8 string and return hex.
Future<String> blake3String(String input) async {
  return blake3Hex(utf8Encode(input));
}

/// Compute BLAKE3 MAC (keyed hash) for message authentication.
Future<List<int>> blake3Mac({
  required List<int> key, // 32 bytes
  required List<int> message,
}) async {
  final algorithm = Blake3();
  final mac = await algorithm.mac(message, secretKey: SecretKey(key));
  return mac.bytes;
}

// ---------------------------------------------------------------------------
// UTF-8 helper (avoid dart:convert dependency for code that doesn't need it)
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

String utf8Decode(List<int> bytes) {
  return String.fromCharCodes(bytes);
}
