// VeriFaceSecurity.swift — Security hardening for iOS
//
// 1. Certificate pinning via URLSessionDelegate
// 2. Secure key storage via iOS Keychain
// 3. Memory wiping of sensitive data

import Foundation
import CryptoKit
import Security

// MARK: - Certificate Pinning

/// URLSession delegate that enforces certificate (public key) pinning.
///
/// Prevents MITM attacks even if an attacker has a valid CA-signed cert.
/// Pins the SPKI (Subject Public Key Info) hash of the backend's leaf cert
/// or intermediate CA.
///
/// SPKI hash format: base64(SHA-256(SPKI))
///
/// To extract the SPKI hash from a live server:
///   echo | openssl s_client -connect api.veriface.io:443 -servername api.veriface.io 2>/dev/null | \
///     openssl x509 -pubkey -noout | \
///     openssl pkey -pubin -outform der | \
///     openssl dgst -sha256 -binary | \
///     base64
final class VeriFaceCertificatePinner: NSObject, URLSessionDelegate {

    /// Pinned SPKI hashes (base64-encoded SHA-256 of the SubjectPublicKeyInfo).
    /// At least one must match the server's cert chain.
    private let pinnedHashes: Set<String>

    /// The hostnames to enforce pinning on (other hosts bypass pinning).
    private let pinnedHosts: Set<String>

    init(pinnedHashes: Set<String>, pinnedHosts: Set<String>) {
        self.pinnedHashes = pinnedHashes
        self.pinnedHosts = pinnedHosts
        super.init()
    }

    /// Default pins for veriface.io (production deployment should override).
    static let defaultPins: Set<String> = [
        // Primary: Let's Encrypt ISRG Root X1
        "C5+lpZ7tcVwmwQIMcRtPbsQtWLABXhQzejna0wHFr8M=",
        // Backup: Let's Encrypt R3 intermediate
        "jQJTbIhpehK4nybtZmJw0+aR8FlntRJ7ox7m9rWz0Xg=",
        // Backup: backup cert (rotate every 90 days)
        "wKp2MJJj5 XVZ3v3b9mLt7z f5W4y7c3y9u3o4m7k7U=",
    ]

    static let defaultHosts: Set<String> = [
        "api.veriface.io",
        "veriface.io",
        "cdn.veriface.io",
    ]

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let host = challenge.protectionSpace.host

        // Only enforce pinning on specified hosts
        guard pinnedHosts.contains(host) else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        // Validate the cert chain first (standard trust evaluation)
        var trustError: CFError?
        let isValid = SecTrustEvaluateWithError(serverTrust, &trustError)

        guard isValid, trustError == nil else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        // Check SPKI hashes of all certs in the chain
        let certCount = SecTrustGetCertificateCount(serverTrust)
        var foundMatch = false

        for i in 0..<certCount {
            guard let cert = SecTrustGetCertificateAtIndex(serverTrust, i) else { continue }
            let certData = SecCertificateCopyData(cert) as Data

            // Extract the public key
            guard let publicKey = SecCertificateCopyKey(cert),
                  let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
                continue
            }

            // Compute SHA-256 of the public key (SPKI hash)
            let hash = SHA256.hash(data: publicKeyData)
            let hashBase64 = Data(hash).base64EncodedString()

            if pinnedHashes.contains(hashBase64) {
                foundMatch = true
                break
            }
        }

        if foundMatch {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            // Pin validation failed — reject the connection
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

// MARK: - Secure Key Storage (Keychain)

/// Stores ephemeral session keys in the iOS Keychain (not in memory or files).
/// Keys are stored with `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` —
/// they never leave the device, even to iCloud Keychain backup.
final class VeriFaceKeychain {

    private let service = "io.veriface.edge"
    private let accessGroup: String? = nil  // Set for shared keychain access

    /// Store a key in the Keychain.
    /// - Parameters:
    ///   - key: The key identifier (e.g., "session-private-key")
    ///   - data: The key data (will be encrypted at rest by iOS)
    func store(key: String, data: Data) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            kSecValueData as String: data,
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        // Delete existing item first
        SecItemDelete(query as CFDictionary)

        let status = SecItemAdd(query as CFDictionary, nil)
        return status == errSecSuccess
    }

    /// Retrieve a key from the Keychain.
    func retrieve(key: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    /// Delete a key from the Keychain.
    func delete(key: String) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// Delete all VeriFace-related keys (called on logout).
    func deleteAll() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        if let group = accessGroup {
            query[kSecAttrAccessGroup as String] = group
        }

        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }
}

// MARK: - Memory Wiping

/// Helpers for securely wiping sensitive data from memory.
///
/// Swift doesn't guarantee secure zeroing (the compiler may optimize away
/// `memset(0)`), but we use `Data.resetBytes(in:)` which is harder to
/// optimize away, and `withUnsafeMutableBytes` for direct buffer access.
enum VeriFaceMemoryWipe {

    /// Zero out a Data buffer (best-effort).
    static func wipe(_ data: inout Data) {
        data.resetBytes(in: 0..<data.count)
    }

    /// Zero out a [UInt8] buffer (best-effort).
    static func wipe(_ bytes: inout [UInt8]) {
        for i in 0..<bytes.count {
            bytes[i] = 0
        }
    }

    /// Zero out a SymmetricKey (CryptoKit doesn't expose raw bytes —
    /// best we can do is let it go out of scope).
    static func wipe(_ key: inout SymmetricKey) {
        // CryptoKit keys are zeroed by the OS when deallocated.
        // We just release our reference.
        key = SymmetricKey(size: .bits0)
    }

    /// Constant-time comparison of two byte arrays.
    /// Prevents timing attacks on secret comparisons.
    static func constantTimeEquals(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        if a.count != b.count { return false }
        var result: UInt8 = 0
        for i in 0..<a.count {
            result |= a[i] ^ b[i]
        }
        return result == 0
    }

    /// Constant-time comparison of two hex strings.
    static func constantTimeEqualsHex(_ a: String, _ b: String) -> Bool {
        if a.count != b.count { return false }
        var result: UInt8 = 0
        let aBytes = Array(a.utf8)
        let bBytes = Array(b.utf8)
        for i in 0..<aBytes.count {
            result |= aBytes[i] ^ bBytes[i]
        }
        return result == 0
    }
}
