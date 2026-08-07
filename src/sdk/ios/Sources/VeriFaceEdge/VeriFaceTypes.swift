// VeriFaceTypes.swift — API request/response types

import Foundation

struct SessionInitResponse: Codable {
    let success: Bool
    let sessionId: String
    let challenge: String
    let backendPubKey: String
    let expiresAt: Date
    let experiment: ExperimentContext?

    enum CodingKeys: String, CodingKey {
        case success, sessionId, challenge
        case backendPubKey
        case expiresAt
        case experiment
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.success = try c.decode(Bool.self, forKey: .success)
        self.sessionId = try c.decode(String.self, forKey: .sessionId)
        self.challenge = try c.decode(String.self, forKey: .challenge)
        self.backendPubKey = try c.decode(String.self, forKey: .backendPubKey)
        let expiresAtStr = try c.decode(String.self, forKey: .expiresAt)
        self.expiresAt = ISO8601DateFormatter().date(from: expiresAtStr) ?? Date()
        self.experiment = try c.decodeIfPresent(ExperimentContext.self, forKey: .experiment)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(success, forKey: .success)
        try c.encode(sessionId, forKey: .sessionId)
        try c.encode(challenge, forKey: .challenge)
        try c.encode(backendPubKey, forKey: .backendPubKey)
        try c.encode(ISO8601DateFormatter().string(from: expiresAt), forKey: .expiresAt)
        try c.encodeIfPresent(experiment, forKey: .experiment)
    }
}

struct ExperimentContext: Codable {
    let experimentId: String?
    let variant: String?
    let livenessThreshold: Double
}

struct SessionVerifyPayload: Codable {
    let sessionId: String
    let tenantId: String
    let jwt: String
    let sdkPubKey: String
    let encryptedEmbedding: [String: String]
    let commitment: String
    let commitmentNonce: String
    let liveness: LivenessReport
    let antiInjection: AntiInjectionReport
    let externalUserId: String?
}

struct SessionVerifyResponse: Codable {
    let success: Bool
    let token: String?
    let expiresAt: Int?
    let sessionId: String
    let flow: String
    let errorCode: String?
    let error: String?
}
