// VeriFace Edge SDK for Flutter — Public API entry point.
//
// Exports:
//   - VeriFaceClient: API client for /api/session/init + /api/session/verify
//   - Crypto: Ed25519 signing, X25519 ECDH, AES-256-GCM, BLAKE3, HKDF-SHA256
//   - VeriFaceWidget: Drop-in UI widget (camera preview + capture button)
//   - Types: All shared types (config, result, errors)

library veriface_edge;

export 'src/crypto/ed25519.dart';
export 'src/crypto/x25519.dart';
export 'src/crypto/aes_gcm.dart';
export 'src/crypto/blake3.dart';
export 'src/crypto/hkdf.dart';
export 'src/crypto/pedersen.dart';

export 'src/api/client.dart';
export 'src/api/types.dart';
export 'src/api/errors.dart';

export 'src/widget/veriface_widget.dart';
export 'src/widget/veriface_controller.dart';
