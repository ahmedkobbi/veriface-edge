// VeriFace Edge — AES-256-GCM (Dart bindings)
//
// Used to encrypt the biometric embedding before sending it to the backend.
// The encryption key is derived via HKDF from the X25519 ECDH shared secret
// + the session challenge as salt/info.

import 'package:cryptography/cryptography.dart';
import 'ed25519.dart' show bytesToHex, hexToBytes;

class AesGcmCiphertext {
  final List<int> ciphertext;
  final List<int> iv; // 12 bytes
  final List<int> authTag; // 16 bytes

  AesGcmCiphertext(this.ciphertext, this.iv, this.authTag);

  String get ciphertextHex => bytesToHex(ciphertext);
  String get ivHex => bytesToHex(iv);
  String get authTagHex => bytesToHex(authTag);
}

/// Encrypt with AES-256-GCM.
/// [key] must be 32 bytes (256 bits). [iv] should be 12 bytes (random).
/// [plaintext] is the raw bytes to encrypt.
Future<AesGcmCiphertext> aesGcmEncrypt({
  required List<int> key,
  required List<int> plaintext,
  List<int>? aad,
  List<int>? iv,
}) async {
  final algorithm = AesGcm.with256bits();
  final nonce = Nonce(iv ?? algorithm.newNonce().bytes);
  final secretKey = SecretKey(key);

  final secretBox = await algorithm.encrypt(
    plaintext,
    secretKey: secretKey,
    nonce: nonce,
    aad: aad,
  );

  return AesGcmCiphertext(
    secretBox.cipherText,
    nonce.bytes,
    secretBox.mac.bytes,
  );
}

/// Decrypt with AES-256-GCM.
/// Throws SecretBoxAuthenticationError if the auth tag is invalid (tampering).
Future<List<int>> aesGcmDecrypt({
  required List<int> key,
  required List<int> ciphertext,
  required List<int> iv,
  required List<int> authTag,
  List<int>? aad,
}) async {
  final algorithm = AesGcm.with256bits();
  final secretKey = SecretKey(key);
  final secretBox = SecretBox(
    ciphertext,
    nonce: Nonce(iv),
    mac: Mac(authTag),
  );

  return algorithm.decrypt(
    secretBox,
    secretKey: secretKey,
    aad: aad,
  );
}

/// Generate a random 12-byte IV (suitable for AES-GCM).
Future<List<int>> generateIv() async {
  return AesGcm.with256bits().newNonce().bytes;
}
