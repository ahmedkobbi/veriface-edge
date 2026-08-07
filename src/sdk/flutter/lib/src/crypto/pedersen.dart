// VeriFace Edge — Pedersen commitment (Dart)
//
// The Pedersen commitment is the ZK public input that proves the SDK
// computed the embedding honestly without revealing the embedding itself:
//
//   commitment = BLAKE3(embedding_bytes || nonce_bytes)
//
// The backend stores only the commitment. On verification, the SDK sends
// the embedding (encrypted) + nonce, and the backend recomputes the
// commitment to check it matches.

import 'blake3.dart' show blake3Hash, utf8Encode;
import 'ed25519.dart' show bytesToHex, hexToBytes;

/// Compute the Pedersen commitment for an embedding.
///
/// [embedding] — Float32 list (e.g., 512-dim face embedding).
/// [nonce]     — 32 random bytes (ZK nonce, never reused).
///
/// Returns the commitment as a 64-char hex string.
Future<String> createCommitment({
  required List<double> embedding,
  required List<int> nonce,
}) async {
  // Encode embedding as little-endian float32 bytes
  final embeddingBytes = embeddingToBytes(embedding);
  final input = [...embeddingBytes, ...nonce];
  final hash = await blake3Hash(input);
  return bytesToHex(hash);
}

/// Verify a Pedersen commitment.
///
/// Returns true if the commitment matches BLAKE3(embedding || nonce).
Future<bool> verifyCommitment({
  required List<double> embedding,
  required List<int> nonce,
  required String expectedCommitmentHex,
}) async {
  final actual = await createCommitment(embedding: embedding, nonce: nonce);
  // Constant-time comparison
  if (actual.length != expectedCommitmentHex.length) return false;
  var diff = 0;
  for (var i = 0; i < actual.length; i++) {
    diff |= actual.codeUnitAt(i) ^ expectedCommitmentHex.codeUnitAt(i);
  }
  return diff == 0;
}

/// Encode a Float32 embedding as little-endian bytes.
/// Mirrors the web SDK's DataView.setFloat32(littleEndian=true).
List<int> embeddingToBytes(List<double> embedding) {
  final result = <int>[];
  for (final value in embedding) {
    final bytes = _float32ToBytes(value);
    result.addAll(bytes);
  }
  return result;
}

/// Decode little-endian float32 bytes back to a Float32 embedding.
List<double> bytesToEmbedding(List<int> bytes) {
  final result = <double>[];
  for (var i = 0; i < bytes.length; i += 4) {
    result.add(_bytesToFloat32(bytes.sublist(i, i + 4)));
  }
  return result;
}

// ---------------------------------------------------------------------------
// IEEE 754 float32 encoding (little-endian)
// ---------------------------------------------------------------------------

List<int> _float32ToBytes(double value) {
  final buffer = ByteData(4);
  buffer.setFloat32(0, value, Endian.little);
  return [buffer.getUint8(0), buffer.getUint8(1), buffer.getUint8(2), buffer.getUint8(3)];
}

double _bytesToFloat32(List<int> bytes) {
  final buffer = ByteData(4);
  buffer.setUint8(0, bytes[0]);
  buffer.setUint8(1, bytes[1]);
  buffer.setUint8(2, bytes[2]);
  buffer.setUint8(3, bytes[3]);
  return buffer.getFloat32(0, Endian.little);
}
