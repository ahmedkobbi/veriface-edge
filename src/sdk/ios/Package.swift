// swift-tools-version:5.9
// VeriFace Edge — Swift Package
//
// Privacy-first facial authentication SDK for iOS.
// Uses AVFoundation for camera capture, Vision for face detection,
// CryptoKit for Ed25519/X25519/AES-GCM/BLAKE3/HKDF.

import PackageDescription

let package = Package(
    name: "VeriFaceEdge",
    platforms: [
        .iOS(.v15),
        .macOS(.v12),
    ],
    products: [
        .library(
            name: "VeriFaceEdge",
            targets: ["VeriFaceEdge"]),
    ],
    dependencies: [
        // BLAKE3 — CryptoKit doesn't ship BLAKE3, so we use a pure-Swift port
        .package(url: "https://github.com/lorentey/BLAKE3.swift.git", from: "1.0.0"),
    ],
    targets: [
        .target(
            name: "VeriFaceEdge",
            dependencies: ["BLAKE3"],
            path: "Sources/VeriFaceEdge"),
        .testTarget(
            name: "VeriFaceEdgeTests",
            dependencies: ["VeriFaceEdge"],
            path: "Tests/VeriFaceEdgeTests"),
    ]
)
