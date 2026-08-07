// VeriFaceCameraView.swift — SwiftUI camera view component
//
// Drop-in SwiftUI view that shows the camera preview + capture button +
// liveness progress indicator. Wraps VeriFaceClient.
//
// Usage:
//   VeriFaceCameraView(
//     config: VeriFaceConfig(tenantId: "...", apiKey: "...", apiBaseUrl: URL(string: "...")!),
//     flow: .authenticate,
//     externalUserId: "user_123",
//     onSuccess: { result in print("Token: \(result.token ?? "")") },
//     onFailure: { error in print("Failed: \(error)") }
//   )

import SwiftUI
import AVFoundation

public struct VeriFaceCameraView: View {
    let config: VeriFaceConfig
    let flow: VeriFaceFlow
    let externalUserId: String?
    let onSuccess: (SessionVerifyResponse) -> Void
    let onFailure: (VeriFaceError) -> Void

    @StateObject private var viewModel: VeriFaceViewModel

    public init(
        config: VeriFaceConfig,
        flow: VeriFaceFlow = .authenticate,
        externalUserId: String? = nil,
        onSuccess: @escaping (SessionVerifyResponse) -> Void,
        onFailure: @escaping (VeriFaceError) -> Void
    ) {
        self.config = config
        self.flow = flow
        self.externalUserId = externalUserId
        self.onSuccess = onSuccess
        self.onFailure = onFailure
        _viewModel = StateObject(wrappedValue: VeriFaceViewModel(config: config))
    }

    public var body: some View {
        ZStack {
            // Camera preview (would be AVCaptureVideoPreviewLayer wrapped in UIViewRepresentable)
            Color.black.opacity(0.9)
                .ignoresSafeArea()

            VStack {
                // Status badge
                HStack {
                    StatusBadge(status: viewModel.status)
                    Spacer()
                    if viewModel.status == .capturing {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                    }
                }
                .padding()

                Spacer()

                // Capture button
                if viewModel.status == .idle || viewModel.status == .failed {
                    Button(action: viewModel.startCapture) {
                        Text(flow == .enroll ? "Enroll Face" : "Verify Identity")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(.horizontal, 32)
                            .padding(.vertical, 14)
                            .background(
                                LinearGradient(
                                    colors: [Color(red: 0.063, green: 0.725, blue: 0.506),
                                             Color(red: 0.024, green: 0.714, blue: 0.831)],
                                    startPoint: .leading,
                                    endPoint: .trailing
                                )
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    .padding(.bottom, 32)
                }

                // Error message
                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundColor(.red)
                        .padding()
                        .background(Color.red.opacity(0.2))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .padding(.bottom, 24)
                }

                // Success overlay
                if viewModel.status == .success {
                    VStack {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 64))
                            .foregroundColor(Color(red: 0.063, green: 0.725, blue: 0.506))
                        Text("Verified")
                            .font(.system(size: 20, weight: .semibold))
                            .foregroundColor(.white)
                    }
                    .transition(.scale.combined(with: .opacity))
                }
            }
        }
        .onAppear { viewModel.flow = flow; viewModel.externalUserId = externalUserId }
        .onChange(of: viewModel.result) { _, newResult in
            if let r = newResult {
                if r.success { onSuccess(r) }
                else { onFailure(.verificationFailed(code: r.errorCode ?? "UNKNOWN", message: r.error ?? "")) }
            }
        }
        .onChange(of: viewModel.error) { _, newError in
            if let e = newError { onFailure(e) }
        }
    }
}

@MainActor
final class VeriFaceViewModel: ObservableObject {
    enum Status: String { case idle, initializing, capturing, processing, success, failed }

    @Published var status: Status = .idle
    @Published var errorMessage: String?
    @Published var result: SessionVerifyResponse?
    @Published var error: VeriFaceError?

    var flow: VeriFaceFlow = .authenticate
    var externalUserId: String?

    private let client: VeriFaceClient

    init(config: VeriFaceConfig) {
        self.client = VeriFaceClient(config: config)
    }

    func startCapture() {
        Task {
            status = .capturing
            errorMessage = nil
            result = nil
            error = nil

            do {
                status = .processing
                let response = try await client.authenticate(externalUserId: externalUserId)
                result = response
                status = response.success ? .success : .failed
                if !response.success {
                    errorMessage = response.error ?? "Verification failed"
                }
            } catch let e as VeriFaceError {
                self.error = e
                status = .failed
                errorMessage = errorMessage(for: e)
            } catch {
                self.error = .unknown(error.localizedDescription)
                status = .failed
                errorMessage = error.localizedDescription
            }
        }
    }

    private func errorMessage(for error: VeriFaceError) -> String {
        switch error {
        case .noCamera: return "No camera available"
        case .cameraDenied: return "Camera permission denied"
        case .noFace: return "No face detected"
        case .multipleFaces: return "Multiple faces detected"
        case .livenessFailed(let score, let threshold):
            return "Liveness \(String(format: "%.3f", score)) below threshold \(String(format: "%.2f", threshold))"
        case .injectionSuspected(let reasons):
            return "Anti-injection failed: \(reasons.joined(separator: ", "))"
        case .sessionExpired: return "Session expired"
        case .networkError(let msg): return msg
        case .verificationFailed(_, let msg): return msg
        case .unknown(let msg): return msg
        }
    }
}

struct StatusBadge: View {
    let status: VeriFaceViewModel.Status

    var body: some View {
        Text(status.rawValue.uppercased())
            .font(.system(size: 10, weight: .semibold))
            .tracking(0.5)
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(color.opacity(0.2))
            .foregroundColor(color)
            .clipShape(Capsule())
            .overlay(Capsule().stroke(color, lineWidth: 1))
    }

    private var color: Color {
        switch status {
        case .idle: return .gray
        case .initializing, .processing: return .orange
        case .capturing: return .cyan
        case .success: return Color(red: 0.063, green: 0.725, blue: 0.506)
        case .failed: return .red
        }
    }
}
