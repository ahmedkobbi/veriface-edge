// VeriFaceCrypto.swift — Crypto primitives for iOS
//
// All crypto runs via Apple CryptoKit (hardware-accelerated on Apple Silicon):
//   - Ed25519 signing (CryptoKit.Curve25519.Signing)
//   - X25519 ECDH (CryptoKit.Curve25519.KeyAgreement)
//   - AES-256-GCM (CryptoKit.AES.GCM)
//   - HKDF-SHA256 (CryptoKit.HKDF<SHA256>)
//   - SHA-256 (CryptoKit.SHA256)
//
// BLAKE3 is NOT in CryptoKit — we use the BLAKE3.swift package.

import Foundation
import CryptoKit
import BLAKE3

final class VeriFaceCrypto {

    // Ephemeral session keys (rotated per session)
    private var signingKey: Curve25519.Signing.PrivateKey
    private var keyAgreementKey: Curve25519.KeyAgreement.PrivateKey

    init() {
        self.signingKey = Curve25519.Signing.PrivateKey()
        self.keyAgreementKey = Curve25519.KeyAgreement.PrivateKey()
    }

    // MARK: - Public key accessors (hex)

    var sessionPublicKeyHex: String {
        return keyAgreementKey.publicKey.rawRepresentation.hexString
    }

    var signingPublicKeyHex: String {
        return signingKey.publicKey.rawRepresentation.hexString
    }

    // MARK: - Random

    func secureRandom(_ count: Int) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        precondition(status == errSecSuccess, "SecRandomCopyBytes failed")
        return bytes
    }

    func secureRandomHex(_ count: Int) -> String {
        return secureRandom(count).hexString
    }

    // MARK: - Session key derivation (X25519 ECDH + HKDF)

    /// Derive the AES-256 session key from the backend's X25519 public key +
    /// the session challenge.
    func deriveSessionKey(backendPubKeyHex: String, challengeHex: String) throws -> SymmetricKey {
        let backendPubKeyBytes = try hexToBytes(backendPubKeyHex)
        let backendPubKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: backendPubKeyBytes)

        let sharedSecret = try keyAgreementKey.sharedSecretFromKeyAgreement(with: backendPubKey)

        let challengeBytes = try hexToBytes(challengeHex)
        let salt = SymmetricKey(data: Data(challengeBytes))
        let info = Data("veriface-session-v1".utf8)

        let derivedKey = sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: info,
            outputByteCount: 32
        )
        return derivedKey
    }

    // MARK: - Embedding encryption (AES-256-GCM)

    struct EncryptedEmbedding {
        let ciphertext: Data
        let iv: Data
        let authTag: Data

        var asDict: [String: String] {
            return [
                "ciphertext": ciphertext.hexString,
                "iv": iv.hexString,
                "authTag": authTag.hexString,
            ]
        }
    }

    func encryptEmbedding(
        embedding: [Float],
        key: SymmetricKey,
        aad: [UInt8]
    ) throws -> EncryptedEmbedding {
        let plaintext = embeddingToBytes(embedding)
        let nonce = AES.GCM.Nonce()
        let sealedBox = try AES.GCM.seal(
            Data(plaintext),
            using: key,
            nonce: nonce,
            authenticating: Data(aad)
        )
        return EncryptedEmbedding(
            ciphertext: sealedBox.ciphertext,
            iv: Data(sealedBox.nonce),
            authTag: Data(sealedBox.tag)
        )
    }

    // MARK: - Pedersen commitment (BLAKE3)

    /// commitment = BLAKE3(embedding_bytes || nonce)
    func createCommitment(embedding: [Float], nonce: [UInt8]) -> String {
        let embBytes = embeddingToBytes(embedding)
        var input = Data(embBytes)
        input.append(contentsOf: nonce)
        let hash = blake3(input)
        return hash.hexString
    }

    // MARK: - JWT signing (Ed25519)

    func signJwt(
        sessionId: String,
        tenantId: String,
        liveness: LivenessReport,
        antiInjection: AntiInjectionReport,
        commitment: String
    ) throws -> String {
        let header: [String: String] = ["alg": "EdDSA", "typ": "JWT"]
        let now = Int(Date().timeIntervalSince1970)
        let payload: [String: Any] = [
            "iss": "veriface-edge-sdk-ios",
            "sub": sessionId,
            "iat": now,
            "exp": now + 60,
            "jti": sessionId,
            "session_id": sessionId,
            "tenant_id": tenantId,
            "model_version": "v1.0.0",
            "liveness_score": liveness.overall,
            "commitment": commitment,
        ]

        let headerJson = try JSONSerialization.data(withJSONObject: header)
        let payloadJson = try JSONSerialization.data(withJSONObject: payload)
        let headerB64 = headerJson.base64URLEncodedString()
        let payloadB64 = payloadJson.base64URLEncodedString()
        let signingInput = "\(headerB64).\(payloadB64)"

        let signature = try signingKey.signature(for: Data(signingInput.utf8))
        let sigB64 = signature.rawRepresentation.base64URLEncodedString()
        return "\(signingInput).\(sigB64)"
    }

    // MARK: - Helpers

    private func embeddingToBytes(_ embedding: [Float]) -> [UInt8] {
        var bytes = [UInt8]()
        bytes.reserveCapacity(embedding.count * 4)
        for value in embedding {
            var littleEndian = value.bitPattern.littleEndian
            withUnsafeBytes(of: &littleEndian) { ptr in
                bytes.append(contentsOf: ptr)
            }
        }
        return bytes
    }

    func hexToBytes(_ hex: String) throws -> [UInt8] {
        precondition(hex.count % 2 == 0, "Hex string must have even length")
        var bytes = [UInt8]()
        bytes.reserveCapacity(hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else {
                throw VeriFaceError.unknown("Invalid hex character")
            }
            bytes.append(byte)
            index = next
        }
        return bytes
    }

    func hex(toBytes bytes: [UInt8]) -> String {
        return bytes.hexString
    }

    func bytes(fromHex hex: String) -> [UInt8] {
        return (try? hexToBytes(hex)) ?? []
    }
}

// MARK: - Data extensions

extension Data {
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }

    func base64URLEncodedString() -> String {
        return base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

extension Array where Element == UInt8 {
    var hexString: String {
        return map { String(format: "%02x", $0) }.joined()
    }
}
