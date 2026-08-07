// VeriFaceEdge.swift — Public API entry point
//
// Re-exports the public types + VeriFaceClient class.
// 100% of biometric computation (face detection, rPPG, PAD, embedding)
// runs natively on iOS — no WebView, no JS bridge.

import Foundation
import AVFoundation
import Vision
import CryptoKit

// Re-export sub-modules
@_exported import VeriFaceEdge

/// VeriFace Edge SDK for iOS.
///
/// Privacy contract:
///   - All biometric computation (face detection, rPPG, PAD, embedding) runs
///     natively on-device — no face data ever leaves the device.
///   - Only the encrypted embedding + ZK commitment + scalar scores are sent
///     to the backend, and they are end-to-end encrypted with the session ECDH key.
///   - The SDK never writes face frames or embeddings to disk.
///
/// Usage:
///   let client = VeriFaceClient(config: VeriFaceConfig(
///     tenantId: "tnt_...",
///     apiKey: "vf_live_...",
///     apiBaseUrl: URL(string: "https://api.veriface.io")!
///   ))
///   let result = try await client.authenticate(externalUserId: "user_123")
///   print("Token: \(result.token ?? "")")
public final class VeriFaceClient {

    public let config: VeriFaceConfig
    private let session: URLSession
    private let crypto: VeriFaceCrypto
    private let camera: VeriFaceCamera
    private let pipeline: VeriFacePipeline

    public init(config: VeriFaceConfig) {
        self.config = config
        self.session = URLSession(configuration: .default)
        self.crypto = VeriFaceCrypto()
        self.camera = VeriFaceCamera()
        self.pipeline = VeriFacePipeline()
    }

    /// Initialize a session with the backend.
    /// Returns the challenge + backend's ephemeral X25519 public key.
    public func initSession(
        flow: VeriFaceFlow,
        externalUserId: String? = nil
    ) async throws -> SessionInitResponse {
        let url = config.apiBaseUrl.appendingPathComponent("/api/session/init")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")

        var body: [String: Any] = [
            "tenantId": config.tenantId,
            "flow": flow.rawValue,
        ]
        if let uid = externalUserId { body["externalUserId"] = uid }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw VeriFaceError.networkError("Session init failed")
        }

        let decoded = try JSONDecoder().decode(SessionInitResponse.self, from: data)
        guard decoded.success else {
            throw VeriFaceError.networkError("Session init returned failure")
        }
        return decoded
    }

    /// Run the full authentication/enrollment flow.
    ///
    /// Steps:
    ///   1. Init session with backend (gets challenge + backend X25519 pubkey)
    ///   2. Open front camera (AVFoundation)
    ///   3. Capture frames for captureDurationMs (passive rPPG window)
    ///   4. Per frame: detect face (Vision), compute rPPG (CHROM), check replay
    ///   5. Compute final embedding + liveness + anti-injection report
    ///   6. Compute Pedersen commitment (BLAKE3)
    ///   7. Derive session key (X25519 ECDH + HKDF), encrypt embedding (AES-256-GCM)
    ///   8. Sign JWT (Ed25519) with all signals
    ///   9. POST verify payload to backend
    public func authenticate(
        externalUserId: String? = nil
    ) async throws -> SessionVerifyResponse {
        // 1. Init session
        let session = try await initSession(flow: .authenticate, externalUserId: externalUserId)

        // 2-5. Capture + AI pipeline
        let capture = try await camera.capture(durationMs: config.captureDurationMs)
        let processed = try await pipeline.process(capture)

        // 6. Pedersen commitment
        let nonce = crypto.secureRandom(32)
        let commitment = crypto.createCommitment(embedding: processed.embedding, nonce: nonce)

        // 7. Encrypt embedding
        let sessionKey = try crypto.deriveSessionKey(
            backendPubKeyHex: session.backendPubKey,
            challengeHex: session.challenge
        )
        let encrypted = try crypto.encryptEmbedding(
            embedding: processed.embedding,
            key: sessionKey,
            aad: crypto.hex(toBytes: session.challenge)
        )

        // 8. Sign JWT
        let jwt = try crypto.signJwt(
            sessionId: session.sessionId,
            tenantId: config.tenantId,
            liveness: processed.liveness,
            antiInjection: processed.antiInjection,
            commitment: commitment
        )

        // 9. Verify
        let payload = SessionVerifyPayload(
            sessionId: session.sessionId,
            tenantId: config.tenantId,
            jwt: jwt,
            sdkPubKey: crypto.sessionPublicKeyHex,
            encryptedEmbedding: encrypted,
            commitment: commitment,
            commitmentNonce: crypto.hex(toBytes: crypto.bytes(fromHex: nonce)),
            liveness: processed.liveness,
            antiInjection: processed.antiInjection,
            externalUserId: externalUserId
        )

        return try await verifySession(payload: payload)
    }

    /// Submit the verify payload to the backend.
    public func verifySession(payload: SessionVerifyPayload) async throws -> SessionVerifyResponse {
        let url = config.apiBaseUrl.appendingPathComponent("/api/session/verify")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(config.apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue(String(Int(Date().timeIntervalSince1970 * 1000)), forHTTPHeaderField: "X-VeriFace-Timestamp")
        request.setValue(crypto.secureRandomHex(16), forHTTPHeaderField: "X-VeriFace-Nonce")
        request.httpBody = try JSONEncoder().encode(payload)

        let (data, response) = try await self.session.data(for: request)
        guard let http = response as? HTTPURLResponse,
              http.statusCode == 200 || http.statusCode == 401 || http.statusCode == 403 else {
            throw VeriFaceError.networkError("Verify failed: HTTP \(http.statusCode)")
        }

        return try JSONDecoder().decode(SessionVerifyResponse.self, from: data)
    }
}

/// SDK configuration.
public struct VeriFaceConfig {
    public let tenantId: String
    public let apiKey: String
    public let apiBaseUrl: URL
    public let modelVersion: String
    public let captureDurationMs: Int
    public let livenessThreshold: Double
    public let telemetryOptIn: Bool

    public init(
        tenantId: String,
        apiKey: String,
        apiBaseUrl: URL,
        modelVersion: String = "v1.0.0",
        captureDurationMs: Int = 1800,
        livenessThreshold: Double = 0.78,
        telemetryOptIn: Bool = false
    ) {
        self.tenantId = tenantId
        self.apiKey = apiKey
        self.apiBaseUrl = apiBaseUrl
        self.modelVersion = modelVersion
        self.captureDurationMs = captureDurationMs
        self.livenessThreshold = livenessThreshold
        self.telemetryOptIn = telemetryOptIn
    }
}

public enum VeriFaceFlow: String {
    case enroll
    case authenticate
}

public enum VeriFaceError: Error {
    case noCamera
    case cameraDenied
    case noFace
    case multipleFaces
    case livenessFailed(score: Double, threshold: Double)
    case injectionSuspected(reasons: [String])
    case sessionExpired
    case networkError(String)
    case verificationFailed(code: String, message: String)
    case unknown(String)
}
