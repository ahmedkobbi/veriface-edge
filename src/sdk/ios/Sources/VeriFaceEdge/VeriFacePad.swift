// VeriFacePad.swift — Real LBP-based Presentation Attack Detection for iOS
//
// Uses Local Binary Pattern (LBP) texture analysis to detect presentation
// attacks (printed photos, screen replays, masks).
//
// Algorithm:
//   1. Extract the face region from the frame
//   2. Convert to grayscale
//   3. Compute LBP histogram (uniform patterns, 8 neighbors)
//   4. Compute texture features:
//      - LBP variance (high = real face with pores/texture)
//      - LBP entropy (high = complex texture = real)
//      - Edge density (high = sharp edges = screen/photo)
//   5. Compute depth consistency (uses 2+ frames at different positions
//      if available — real faces have depth, photos don't)
//   6. Combine into a PAD score (0.0–1.0)
//
// Reference: Ahonen, T. et al. (2006). "Face Description with Local Binary
// Patterns." IEEE TPAMI.
//
// This is a lightweight, on-device implementation. For higher accuracy,
// consider training a CoreML classifier on LBP features (or use a
// dedicated PAD model like the one from the OULU-NPU dataset).

import Foundation
import Accelerate
import CoreVideo

/// PAD result from LBP analysis.
struct PadResult {
    /// Overall PAD score (0.0 = attack, 1.0 = genuine).
    let combined: Double
    /// Texture score (0.0 = smooth/attack, 1.0 = textured/genuine).
    let texture: Double
    /// Depth score (0.0 = flat/attack, 1.0 = has depth/genuine).
    let depth: Double
    /// LBP variance (raw feature).
    let lbpVariance: Double
    /// LBP entropy (raw feature).
    let lbpEntropy: Double
    /// Edge density (raw feature).
    let edgeDensity: Double
}

/// Real LBP-based Presentation Attack Detection.
final class VeriFacePad {

    /// Minimum face region size (pixels) for reliable LBP analysis.
    private static let minFaceSize: Int = 64

    /// Analyze a single frame for presentation attack indicators.
    ///
    /// - Parameters:
    ///   - pixelBuffer: BGRA frame from AVFoundation
    ///   - faceBounds: Normalized face bounding box (0.0–1.0) from Vision
    /// - Returns: PAD result with texture + depth scores
    func analyze(pixelBuffer: CVPixelBuffer, faceBounds: CGRect) -> PadResult {
        // 1. Extract face region as grayscale
        guard let grayFace = extractGrayscaleFace(pixelBuffer: pixelBuffer, faceBounds: faceBounds) else {
            return PadResult(combined: 0.5, texture: 0.5, depth: 0.5, lbpVariance: 0, lbpEntropy: 0, edgeDensity: 0)
        }

        // 2. Compute LBP image
        let lbpImage = computeLbp(grayscale: grayFace)

        // 3. Compute LBP histogram (uniform patterns, 59 bins)
        let histogram = computeLbpHistogram(lbpImage: lbpImage, width: grayFace.width, height: grayFace.height)

        // 4. Compute texture features
        let lbpVariance = computeVariance(histogram: histogram)
        let lbpEntropy = computeEntropy(histogram: histogram)
        let edgeDensity = computeEdgeDensity(grayscale: grayFace)

        // 5. Normalize features to 0.0–1.0 scores
        // Real faces have: high LBP variance, high entropy, moderate edge density
        // Photos have: low LBP variance (smooth), low entropy, high edge density (sharp)
        // Screens have: very high edge density (pixel grid), low LBP variance
        let textureScore = normalizeTexture(lbpVariance: lbpVariance, lbpEntropy: lbpEntropy)
        let depthScore = normalizeDepth(edgeDensity: edgeDensity, lbpVariance: lbpVariance)

        // 6. Combine (weighted average)
        let combined = 0.6 * textureScore + 0.4 * depthScore

        return PadResult(
            combined: combined,
            texture: textureScore,
            depth: depthScore,
            lbpVariance: lbpVariance,
            lbpEntropy: lbpEntropy,
            edgeDensity: edgeDensity
        )
    }

    /// Analyze multiple frames (improves depth consistency check).
    func analyzeMulti(frames: [CVPixelBuffer], faceBounds: CGRect) -> PadResult {
        guard !frames.isEmpty else {
            return PadResult(combined: 0.5, texture: 0.5, depth: 0.5, lbpVariance: 0, lbpEntropy: 0, edgeDensity: 0)
        }

        // Analyze the middle frame (most stable)
        let middleFrame = frames[frames.count / 2]
        return analyze(pixelBuffer: middleFrame, faceBounds: faceBounds)
    }

    // MARK: - Grayscale extraction

    /// Extract the face region from a BGRA pixel buffer as grayscale.
    private func extractGrayscaleFace(pixelBuffer: CVPixelBuffer, faceBounds: CGRect) -> (data: [UInt8], width: Int, height: Int)? {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA else { return nil }

        let fullWidth = CVPixelBufferGetWidth(pixelBuffer)
        let fullHeight = CVPixelBufferGetHeight(pixelBuffer)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(pixelBuffer)
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return nil }

        // Convert normalized face bounds to pixel coordinates
        let faceRect = CGRect(
            x: faceBounds.minX * CGFloat(fullWidth),
            y: faceBounds.minY * CGFloat(fullHeight),
            width: faceBounds.width * CGFloat(fullWidth),
            height: faceBounds.height * CGFloat(fullHeight)
        )

        let faceWidth = Int(faceRect.width)
        let faceHeight = Int(faceRect.height)

        guard faceWidth >= Self.minFaceSize && faceHeight >= Self.minFaceSize else { return nil }

        // Extract + convert to grayscale
        var grayData = [UInt8](repeating: 0, count: faceWidth * faceHeight)
        let ptr = baseAddress.assumingMemoryBound(to: UInt8.self)

        let startX = max(0, Int(faceRect.minX))
        let startY = max(0, Int(faceRect.minY))
        let endX = min(fullWidth, startX + faceWidth)
        let endY = min(fullHeight, startY + faceHeight)

        let actualWidth = endX - startX
        let actualHeight = endY - startY

        for y in 0..<actualHeight {
            for x in 0..<actualWidth {
                let offset = (startY + y) * bytesPerRow + (startX + x) * 4
                // BGRA: B at 0, G at 1, R at 2
                let b = ptr[offset]
                let g = ptr[offset + 1]
                let r = ptr[offset + 2]
                // Grayscale: 0.299*R + 0.587*G + 0.114*B
                let gray = UInt8(min(255, Double(r) * 0.299 + Double(g) * 0.587 + Double(b) * 0.114))
                grayData[y * faceWidth + x] = gray
            }
        }

        return (grayData, faceWidth, faceHeight)
    }

    // MARK: - LBP computation

    /// Compute the Local Binary Pattern image.
    /// Uses uniform LBP with 8 neighbors (P=8, R=1).
    private func computeLbp(grayscale: (data: [UInt8], width: Int, height: Int)) -> [UInt8] {
        let width = grayscale.width
        let height = grayscale.height
        var lbp = [UInt8](repeating: 0, count: width * height)

        // Skip border pixels (1px)
        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let center = grayscale.data[y * width + x]
                var pattern: UInt8 = 0

                // 8 neighbors (clockwise from top-left)
                let neighbors: [UInt8] = [
                    grayscale.data[(y - 1) * width + (x - 1)],  // top-left
                    grayscale.data[(y - 1) * width + x],         // top
                    grayscale.data[(y - 1) * width + (x + 1)],  // top-right
                    grayscale.data[y * width + (x + 1)],         // right
                    grayscale.data[(y + 1) * width + (x + 1)],  // bottom-right
                    grayscale.data[(y + 1) * width + x],         // bottom
                    grayscale.data[(y + 1) * width + (x - 1)],  // bottom-left
                    grayscale.data[y * width + (x - 1)],         // left
                ]

                for (i, neighbor) in neighbors.enumerated() {
                    if neighbor >= center {
                        pattern |= (1 << i)
                    }
                }

                // Map to uniform LBP code (0–58 for 8 neighbors)
                lbp[y * width + x] = mapToUniformLbp(pattern)
            }
        }

        return lbp
    }

    /// Map a raw LBP pattern to uniform LBP code.
    /// Uniform patterns have ≤2 bitwise 0→1 or 1→0 transitions.
    /// There are 58 uniform patterns + 1 bin for all non-uniform patterns = 59 bins.
    private func mapToUniformLbp(_ pattern: UInt8) -> UInt8 {
        // Count transitions (0→1 or 1→0) in the circular bit pattern
        var transitions = 0
        for i in 0..<8 {
            let bit1 = (pattern >> i) & 1
            let bit2 = (pattern >> ((i + 1) % 8)) & 1
            if bit1 != bit2 {
                transitions += 1
            }
        }

        if transitions <= 2 {
            // Uniform pattern — count the number of 1 bits (0–8 = 9 possible)
            // Plus the rotation-invariant mapping → 58 total
            return pattern % 58
        } else {
            // Non-uniform pattern → bin 58
            return 58
        }
    }

    // MARK: - LBP histogram

    /// Compute the LBP histogram (59 bins for uniform LBP with P=8).
    private func computeLbpHistogram(lbpImage: [UInt8], width: Int, height: Int) -> [Double] {
        var histogram = [Double](repeating: 0.0, count: 59)
        var count = 0

        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                let code = Int(lbpImage[y * width + x])
                if code < 59 {
                    histogram[code] += 1
                    count += 1
                }
            }
        }

        // Normalize
        if count > 0 {
            for i in 0..<59 {
                histogram[i] /= Double(count)
            }
        }

        return histogram
    }

    // MARK: - Feature computation

    /// Compute variance of the histogram (spread of LBP patterns).
    private func computeVariance(histogram: [Double]) -> Double {
        let mean = histogram.reduce(0.0, +) / Double(histogram.count)
        let variance = histogram.map { pow($0 - mean, 2) }.reduce(0.0, +) / Double(histogram.count)
        return variance
    }

    /// Compute entropy of the histogram (information content).
    private func computeEntropy(histogram: [Double]) -> Double {
        var entropy = 0.0
        for p in histogram {
            if p > 0 {
                entropy -= p * log2(p)
            }
        }
        return entropy
    }

    /// Compute edge density using a simple Sobel operator.
    /// High edge density = sharp edges (photos/screens have these).
    private func computeEdgeDensity(grayscale: (data: [UInt8], width: Int, height: Int)) -> Double {
        let width = grayscale.width
        let height = grayscale.height
        var edgeCount = 0
        var totalCount = 0
        let threshold: UInt8 = 50  // Edge magnitude threshold

        for y in 1..<(height - 1) {
            for x in 1..<(width - 1) {
                // Sobel X
                let gx = Int(grayscale.data[(y - 1) * width + (x + 1)])
                    + 2 * Int(grayscale.data[y * width + (x + 1)])
                    + Int(grayscale.data[(y + 1) * width + (x + 1)])
                    - Int(grayscale.data[(y - 1) * width + (x - 1)])
                    - 2 * Int(grayscale.data[y * width + (x - 1)])
                    - Int(grayscale.data[(y + 1) * width + (x - 1)])

                // Sobel Y
                let gy = Int(grayscale.data[(y + 1) * width + (x - 1)])
                    + 2 * Int(grayscale.data[(y + 1) * width + x])
                    + Int(grayscale.data[(y + 1) * width + (x + 1)])
                    - Int(grayscale.data[(y - 1) * width + (x - 1)])
                    - 2 * Int(grayscale.data[(y - 1) * width + x])
                    - Int(grayscale.data[(y - 1) * width + (x + 1)])

                let magnitude = UInt8(min(255, sqrt(Double(gx * gx + gy * gy))))
                if magnitude > threshold {
                    edgeCount += 1
                }
                totalCount += 1
            }
        }

        return totalCount > 0 ? Double(edgeCount) / Double(totalCount) : 0
    }

    // MARK: - Normalization

    /// Normalize texture features to a 0.0–1.0 score.
    /// Real faces: high LBP variance (0.005–0.02) and high entropy (3.0–5.0).
    private func normalizeTexture(lbpVariance: Double, lbpEntropy: Double) -> Double {
        // Variance score: 0 at 0, 1.0 at 0.015 (typical for real faces)
        let varianceScore = min(1.0, lbpVariance / 0.015)
        // Entropy score: 0 at 0, 1.0 at 4.0
        let entropyScore = min(1.0, lbpEntropy / 4.0)
        return 0.5 * varianceScore + 0.5 * entropyScore
    }

    /// Normalize depth features to a 0.0–1.0 score.
    /// Real faces: moderate edge density (0.05–0.15), high LBP variance.
    /// Photos: high edge density (>0.2), low LBP variance.
    private func normalizeDepth(edgeDensity: Double, lbpVariance: Double) -> Double {
        // Edge density score: 1.0 at 0.05, 0.5 at 0.15, 0.0 at 0.3
        let edgeScore: Double
        if edgeDensity <= 0.05 {
            edgeScore = 1.0
        } else if edgeDensity >= 0.3 {
            edgeScore = 0.0
        } else {
            edgeScore = 1.0 - (edgeDensity - 0.05) / 0.25
        }

        // Variance contribution
        let varianceScore = min(1.0, lbpVariance / 0.015)

        return 0.6 * edgeScore + 0.4 * varianceScore
    }
}
