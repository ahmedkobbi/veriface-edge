// VeriFaceCamera.swift — AVFoundation camera capture for iOS
//
// Captures front-camera frames for the rPPG/liveness window. Uses
// AVCaptureSession with VideoDataOutput for frame-by-frame access.
//
// All frames are processed in-memory and immediately discarded —
// nothing is written to disk or sent off-device.

import Foundation
import AVFoundation

/// Captured camera data (frames + metadata).
struct CameraCapture {
    let frames: [CVImageBuffer]
    let timestamps: [CMTime]
    let duration: TimeInterval
}

final class VeriFaceCamera: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {

    private let captureSession = AVCaptureSession()
    private let videoOutput = AVCaptureVideoDataOutput()
    private let queue = DispatchQueue(label: "io.veriface.camera")
    private var frameBuffer: [CVImageBuffer] = []
    private var timestampBuffer: [CMTime] = []
    private var captureStartTime: CMTime?
    private let maxFrames = 90 // ~3 seconds at 30fps

    override init() {
        super.init()
    }

    /// Request camera permission (must be called before capture()).
    static func requestPermission() async throws {
        let status = AVCaptureDevice.authorizationStatus(for: .video)
        switch status {
        case .authorized: return
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            if !granted { throw VeriFaceError.cameraDenied }
        case .denied, .restricted:
            throw VeriFaceError.cameraDenied
        @unknown default:
            throw VeriFaceError.cameraDenied
        }
    }

    /// Capture frames for [durationMs] milliseconds.
    /// Returns the collected frames + timestamps.
    func capture(durationMs: Int) async throws -> CameraCapture {
        try await Self.requestPermission()

        // Configure session
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .high

        guard let camera = AVCaptureDevice.default(
            .builtInWideAngleCamera,
            for: .video,
            position: .front
        ) else {
            throw VeriFaceError.noCamera
        }

        let input = try AVCaptureDeviceInput(device: camera)
        if captureSession.canAddInput(input) {
            captureSession.addInput(input)
        }

        // Mirror the video (front camera should be mirrored)
        if let connection = videoOutput.connection(with: .video) {
            connection.automaticallyAdjustsVideoMirroring = false
            connection.videoOrientation = .portrait
            connection.isVideoMirrored = true
        }

        videoOutput.setSampleBufferDelegate(self, queue: queue)
        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        ]
        if captureSession.canAddOutput(videoOutput) {
            captureSession.addOutput(videoOutput)
        }

        captureSession.commitConfiguration()

        // Reset buffers
        frameBuffer.removeAll()
        timestampBuffer.removeAll()
        captureStartTime = nil

        // Start session
        captureSession.startRunning()

        // Wait for the capture duration
        try await Task.sleep(nanoseconds: UInt64(durationMs) * 1_000_000)

        // Stop session
        captureSession.stopRunning()

        // Copy buffers (caller owns them)
        let frames = frameBuffer
        let timestamps = timestampBuffer
        let startTime = captureStartTime ?? CMTime.zero
        let endTime = timestamps.last ?? startTime
        let duration = CMTimeGetSeconds(endTime - startTime)

        return CameraCapture(
            frames: frames,
            timestamps: timestamps,
            duration: duration
        )
    }

    // MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

    func captureOutput(
        _ output: AVCaptureOutput,
        didOutput sampleBuffer: CMSampleBuffer,
        from connection: AVCaptureConnection
    ) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let timestamp = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if captureStartTime == nil {
            captureStartTime = timestamp
        }

        // Retain the pixel buffer (otherwise it's released when the delegate returns)
        CVPixelBufferRetain(pixelBuffer)

        // Cap buffer size to prevent memory growth
        if frameBuffer.count >= maxFrames {
            let dropped = frameBuffer.removeFirst()
            CVPixelBufferRelease(dropped)
        }

        frameBuffer.append(pixelBuffer)
        timestampBuffer.append(timestamp)
    }
}
