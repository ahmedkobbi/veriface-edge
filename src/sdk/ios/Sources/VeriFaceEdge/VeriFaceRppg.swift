// VeriFaceRppg.swift — Real CHROM rPPG implementation for iOS
//
// CHROM (CHrominance-based rPPG) algorithm by De Haan & Jeanne (2013).
// Extracts heart rate from skin pixel color variations across the green
// channel of captured video frames.
//
// Algorithm:
//   1. For each frame, extract the face region (from Vision face bounds)
//   2. Compute mean R, G, B values in the face region
//   3. Apply CHROM:
//        X = 3*R - 2*G
//        Y = 1.5*R + G - 1.5*B
//   4. Combine: S = X - αY where α = std(X) / std(Y)
//   5. Detrend S (remove low-frequency drift via moving average)
//   6. Bandpass filter (0.7–4 Hz = 42–240 BPM)
//   7. FFT to find dominant frequency → heart rate
//   8. SNR = peak_power / mean_power
//
// Reference: De Haan, G. & Jeanne, V. (2013). "Robust Pulse Rate From
// Chrominance-Based rPPG." IEEE Transactions on Biomedical Engineering.

import Foundation
import Accelerate

/// rPPG result from CHROM analysis.
struct RppgResult {
    /// Overall rPPG quality score (0.0–1.0). Higher = more reliable.
    let score: Double
    /// Detected heart rate in BPM (nil if SNR too low).
    let heartRateBpm: Double?
    /// Signal-to-noise ratio (higher = cleaner signal).
    let snr: Double
    /// Number of frames analyzed.
    let frameCount: Int
    /// Duration of signal in seconds.
    let durationSec: Double
}

/// Real CHROM rPPG analyzer.
final class VeriFaceRppg {

    /// Minimum SNR required to report a heart rate (below this = unreliable).
    private static let minSnr: Double = 2.0

    /// Minimum number of frames required for analysis.
    private static let minFrames: Int = 30

    /// Sampling rate (fps) — assumed from capture duration + frame count.
    private let assumedFps: Double

    init(assumedFps: Double = 30.0) {
        self.assumedFps = assumedFps
    }

    /// Run CHROM rPPG analysis on a sequence of frames.
    ///
    /// - Parameters:
    ///   - frames: Captured CVPixelBuffers (BGRA format from AVFoundation)
    ///   - timestamps: CMSample timestamps for each frame
    ///   - faceBounds: Normalized face bounding box (0.0–1.0) from Vision
    /// - Returns: rPPG result with score, heart rate, and SNR
    func analyze(
        frames: [CVPixelBuffer],
        timestamps: [CMTime],
        faceBounds: CGRect
    ) -> RppgResult {
        guard frames.count >= Self.minFrames else {
            return RppgResult(score: 0, heartRateBpm: nil, snr: 0, frameCount: frames.count, durationSec: 0)
        }

        // 1. Extract mean RGB from face region for each frame
        let rgbMeans = extractRgbMeans(frames: frames, faceBounds: faceBounds)

        // 2. Apply CHROM algorithm
        let chromSignal = computeChromSignal(rgbMeans: rgbMeans)

        // 3. Detrend (remove low-frequency drift)
        let detrended = detrend(signal: chromSignal, windowSize: 30)

        // 4. Bandpass filter (0.7–4 Hz = 42–240 BPM)
        let filtered = bandpassFilter(signal: detrended, lowFreq: 0.7, highFreq: 4.0)

        // 5. FFT to find dominant frequency
        let (dominantFreq, snr) = computeFftDominantFreq(signal: filtered)

        // 6. Convert frequency to BPM
        let heartRateBpm = dominantFreq * 60.0  // Hz → BPM

        // 7. Compute overall quality score
        // Score combines: SNR, signal amplitude, frame count adequacy
        let snrScore = min(1.0, snr / 10.0)  // SNR of 10+ = perfect score
        let frameScore = min(1.0, Double(frames.count) / 60.0)  // 60+ frames = perfect
        let hrPlausibility = (heartRateBpm >= 40 && heartRateBpm <= 200) ? 1.0 : 0.3
        let score = 0.5 * snrScore + 0.3 * frameScore + 0.2 * hrPlausibility

        // 8. Heart rate is only reported if SNR is sufficient
        let reportedHr = snr >= Self.minSnr ? heartRateBpm : nil

        // 9. Duration
        let durationSec: Double
        if timestamps.count >= 2 {
            durationSec = CMTimeGetSeconds(timestamps.last! - timestamps.first!)
        } else {
            durationSec = Double(frames.count) / assumedFps
        }

        return RppgResult(
            score: score,
            heartRateBpm: reportedHr,
            snr: snr,
            frameCount: frames.count,
            durationSec: durationSec
        )
    }

    // MARK: - RGB extraction

    /// Extract mean R, G, B values from the face region of each frame.
    private func extractRgbMeans(
        frames: [CVPixelBuffer],
        faceBounds: CGRect
    ) -> [(r: Double, g: Double, b: Double)] {
        var means: [(r: Double, g: Double, b: Double)] = []
        means.reserveCapacity(frames.count)

        for buffer in frames {
            if let mean = computeMeanRgb(pixelBuffer: buffer, faceBounds: faceBounds) {
                means.append(mean)
            }
        }

        return means
    }

    /// Compute mean R, G, B in the face region of a single CVPixelBuffer (BGRA format).
    private func computeMeanRgb(
        pixelBuffer: CVPixelBuffer,
        faceBounds: CGRect
    ) -> (r: Double, g: Double, b: Double)? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else {
            return nil
        }

        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        // Convert normalized face bounds to pixel coordinates
        let faceRect = CGRect(
            x: faceBounds.minX * CGFloat(width),
            y: faceBounds.minY * CGFloat(height),
            width: faceBounds.width * CGFloat(width),
            height: faceBounds.height * CGFloat(height)
        )

        // Sample a sub-region of the face (forehead + cheeks — best rPPG signal)
        // Use the center 60% of the face to avoid eyes/mouth
        let sampleRect = faceRect.insetBy(dx: faceRect.width * 0.2, dy: faceRect.height * 0.25)
        let startX = max(0, Int(sampleRect.minX))
        let endX = min(width, Int(sampleRect.maxX))
        let startY = max(0, Int(sampleRect.minY))
        let endY = min(height, Int(sampleRect.maxY))

        guard endX > startX && endY > startY else { return nil }

        // Use Accelerate for fast mean computation
        var totalR: UInt64 = 0
        var totalG: UInt64 = 0
        var totalB: UInt64 = 0
        var pixelCount: UInt64 = 0

        let ptr = baseAddress.assumingMemoryBound(to: UInt8.self)

        // Sample every 4th pixel for speed (still statistically valid)
        let stride = 4
        for y in stride(from: startY, to: endY, by: stride) {
            for x in stride(from: startX, to: endX, by: stride) {
                let offset = y * bytesPerRow + x * 4
                // BGRA format: B at offset 0, G at 1, R at 2, A at 3
                totalB += UInt64(ptr[offset])
                totalG += UInt64(ptr[offset + 1])
                totalR += UInt64(ptr[offset + 2])
                pixelCount += 1
            }
        }

        guard pixelCount > 0 else { return nil }

        let n = Double(pixelCount)
        return (
            r: Double(totalR) / n / 255.0,
            g: Double(totalG) / n / 255.0,
            b: Double(totalB) / n / 255.0
        )
    }

    // MARK: - CHROM signal computation

    /// Compute the CHROM signal from RGB means.
    /// S_n = X_n - α * Y_n where:
    ///   X_n = 3*R_n - 2*G_n
    ///   Y_n = 1.5*R_n + G_n - 1.5*B_n
    ///   α = std(X) / std(Y)
    private func computeChromSignal(
        rgbMeans: [(r: Double, g: Double, b: Double)]
    ) -> [Double] {
        guard rgbMeans.count > 1 else { return [] }

        // Compute X and Y signals
        let xSignal = rgbMeans.map { 3.0 * $0.r - 2.0 * $0.g }
        let ySignal = rgbMeans.map { 1.5 * $0.r + $0.g - 1.5 * $0.b }

        // Compute α = std(X) / std(Y)
        let xStd = standardDeviation(xSignal)
        let yStd = standardDeviation(ySignal)
        let alpha = yStd > 0 ? xStd / yStd : 1.0

        // Combine: S = X - α * Y
        return zip(xSignal, ySignal).map { x, y in x - alpha * y }
    }

    // MARK: - Detrending

    /// Remove low-frequency drift using a moving average filter.
    /// This isolates the pulsatile component (heart rate) from
    /// slow changes in illumination.
    private func detrend(signal: [Double], windowSize: Int) -> [Double] {
        guard signal.count > windowSize else { return signal }

        let n = signal.count
        var result = [Double](repeating: 0.0, count: n)
        let halfWindow = windowSize / 2

        // Compute moving average
        var movingAvg = [Double](repeating: 0.0, count: n)
        for i in 0..<n {
            let start = max(0, i - halfWindow)
            let end = min(n, i + halfWindow + 1)
            let window = signal[start..<end]
            movingAvg[i] = window.reduce(0.0, +) / Double(window.count)
        }

        // Subtract moving average from original signal
        for i in 0..<n {
            result[i] = signal[i] - movingAvg[i]
        }

        return result
    }

    // MARK: - Bandpass filter

    /// Apply a simple bandpass filter (0.7–4 Hz = 42–240 BPM).
    /// Uses a combination of moving average filters to approximate
    /// a bandpass response. For production, replace with a proper
    /// Butterworth filter via vDSP.
    private func bandpassFilter(
        signal: [Double],
        lowFreq: Double,
        highFreq: Double
    ) -> [Double] {
        // Simple approach: high-pass via detrending (already done),
        // low-pass via short moving average
        let lowPassWindow = max(3, Int(assumedFps / highFreq))
        return movingAverage(signal: signal, windowSize: lowPassWindow)
    }

    /// Simple moving average filter.
    private func movingAverage(signal: [Double], windowSize: Int) -> [Double] {
        guard windowSize > 1 && signal.count >= windowSize else { return signal }

        let n = signal.count
        var result = [Double](repeating: 0.0, count: n)
        let halfWindow = windowSize / 2

        for i in 0..<n {
            let start = max(0, i - halfWindow)
            let end = min(n, i + halfWindow + 1)
            let window = signal[start..<end]
            result[i] = window.reduce(0.0, +) / Double(window.count)
        }

        return result
    }

    // MARK: - FFT

    /// Compute the dominant frequency via FFT + SNR.
    /// Returns (dominantFreqHz, snr).
    private func computeFftDominantFreq(signal: [Double]) -> (Double, Double) {
        guard signal.count >= 16 else { return (0, 0) }

        // Find next power of 2 for FFT
        let n = signal.count
        let fftN = nextPowerOfTwo(n)

        // Pad signal to fftN with zeros
        var padded = [Double](repeating: 0.0, count: fftN)
        for i in 0..<n { padded[i] = signal[i] }

        // Apply Hann window (reduces spectral leakage)
        let windowed = applyHannWindow(padded)

        // Compute FFT using vDSP
        let magnitudes = computeFftMagnitudes(signal: windowed, fftSize: fftN)

        // Find the frequency range corresponding to 0.7–4 Hz (42–240 BPM)
        let binWidth = assumedFps / Double(fftN)
        let lowBin = Int(0.7 / binWidth)
        let highBin = Int(4.0 / binWidth)

        guard highBin > lowBin && highBin < magnitudes.count else {
            return (0, 0)
        }

        // Find peak in the valid frequency range
        var peakBin = lowBin
        var peakMag: Double = 0
        for i in lowBin...highBin {
            if magnitudes[i] > peakMag {
                peakMag = magnitudes[i]
                peakBin = i
            }
        }

        // Compute SNR: peak power / mean power in the valid range
        let validMags = Array(magnitudes[lowBin...highBin])
        let meanMag = validMags.reduce(0.0, +) / Double(validMags.count)
        let snr = meanMag > 0 ? (peakMag * peakMag) / (meanMag * meanMag) : 0

        let dominantFreq = Double(peakBin) * binWidth

        return (dominantFreq, snr)
    }

    /// Apply a Hann window to reduce spectral leakage.
    private func applyHannWindow(_ signal: [Double]) -> [Double] {
        let n = signal.count
        var result = [Double](repeating: 0.0, count: n)
        for i in 0..<n {
            let w = 0.5 * (1.0 - cos(2.0 * .pi * Double(i) / Double(n - 1)))
            result[i] = signal[i] * w
        }
        return result
    }

    /// Compute FFT magnitudes using Accelerate (vDSP).
    private func computeFftMagnitudes(signal: [Double], fftSize: Int) -> [Double] {
        let halfSize = fftSize / 2
        var magnitudes = [Double](repeating: 0.0, count: halfSize)

        // Split complex representation
        var realPart = [Double](repeating: 0.0, count: halfSize)
        var imagPart = [Double](repeating: 0.0, count: halfSize)

        var signalCopy = signal

        // Setup FFT
        guard let fftSetup = vDSP_create_fftsetupD(vDSP_Length(log2(Double(fftSize))), FFTRadix(kFFTRadix2)) else {
            return magnitudes
        }
        defer { vDSP_destroy_fftsetupD(fftSetup) }

        // Convert real signal to split complex
        var tempReal = [Double](repeating: 0.0, count: fftSize / 2)
        var tempImag = [Double](repeating: 0.0, count: fftSize / 2)
        tempReal.withUnsafeMutableBufferPointer { realPtr in
            tempImag.withUnsafeMutableBufferPointer { imagPtr in
                signalCopy.withUnsafeMutableBufferPointer { signalPtr in
                    var splitComplex = DSPDoubleSplitComplex(
                        realp: realPtr.baseAddress!,
                        imagp: imagPtr.baseAddress!
                    )
                    vDSP_ctozD(
                        UnsafePointer(signalPtr.baseAddress!).withMemoryRebound(to: DSPDoubleComplex.self, capacity: fftSize / 2) { $0 },
                        2,
                        &splitComplex,
                        1,
                        vDSP_Length(fftSize / 2)
                    )
                }
            }
        }

        // Perform FFT
        tempReal.withUnsafeMutableBufferPointer { realPtr in
            tempImag.withUnsafeMutableBufferPointer { imagPtr in
                var splitComplex = DSPDoubleSplitComplex(
                    realp: realPtr.baseAddress!,
                    imagp: imagPtr.baseAddress!
                )
                vDSP_fft_zripD(fftSetup, &splitComplex, 1, vDSP_Length(log2(Double(fftSize))), FFTDirection(FFT_FORWARD))
            }
        }

        // Compute magnitudes
        tempReal.withUnsafeMutableBufferPointer { realPtr in
            tempImag.withUnsafeMutableBufferPointer { imagPtr in
                magnitudes.withUnsafeMutableBufferPointer { magPtr in
                    var splitComplex = DSPDoubleSplitComplex(
                        realp: realPtr.baseAddress!,
                        imagp: imagPtr.baseAddress!
                    )
                    vDSP_zvabsD(&splitComplex, 1, magPtr.baseAddress!, 1, vDSP_Length(halfSize))
                }
            }
        }

        return magnitudes
    }

    // MARK: - Statistics helpers

    /// Compute standard deviation.
    private func standardDeviation(_ values: [Double]) -> Double {
        guard values.count > 1 else { return 0 }
        let mean = values.reduce(0.0, +) / Double(values.count)
        let variance = values.map { pow($0 - mean, 2) }.reduce(0.0, +) / Double(values.count - 1)
        return sqrt(variance)
    }

    /// Find next power of 2 ≥ n.
    private func nextPowerOfTwo(_ n: Int) -> Int {
        var power = 1
        while power < n { power *= 2 }
        return power
    }
}
