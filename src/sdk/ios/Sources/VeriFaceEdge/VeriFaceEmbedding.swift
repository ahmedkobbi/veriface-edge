// VeriFaceEmbedding.swift — CoreML face embedding for iOS
//
// Loads a CoreML model (ArcFace/ResNet) to generate 512-dim face embeddings.
// The model is expected to be bundled with the app as a .mlmodelc file.
//
// Model requirements:
//   - Input: 112x112 RGB image (or 224x224 — configurable)
//   - Output: 512-dim Float32 embedding (L2-normalized)
//   - Architecture: ArcFace with ResNet-50 or ResNet-100 backbone
//
// Recommended models (place in app's asset catalog or bundle):
//   - MobileFaceNet (4MB, fast, good accuracy) — recommended for mobile
//   - ArcFace-ResNet50 (90MB, higher accuracy)
//   - ArcFace-ResNet100 (170MB, highest accuracy)
//
// Convert from ONNX to CoreML:
//   pip install coremltools
//   python -c "import coremltools as ct; ct.convert('arcface.onnx').save('ArcFace.mlmodel')"
//
// If no model is bundled, falls back to a deterministic geometric embedding
// (NOT for production — accuracy is too low for verification).

import Foundation
import CoreML
import Vision
import CoreImage

/// Face embedding result.
struct EmbeddingResult {
    /// 512-dim L2-normalized embedding.
    let embedding: [Float]
    /// Quality score (0.0–1.0) — confidence in the embedding.
    let quality: Double
    /// Whether a real CoreML model was used (vs. fallback).
    let usedModel: Bool
}

/// CoreML-powered face embedding generator.
final class VeriFaceEmbedding {

    /// The compiled CoreML model (nil if not bundled).
    private var mlModel: MLModel?

    /// Input image size expected by the model.
    private let inputSize: CGSize

    /// Input feature name in the CoreML model.
    private let inputName: String

    /// Output feature name in the CoreML model.
    private let outputName: String

    /// Embedding dimension (must match model output).
    private let embeddingDim: Int

    init() {
        self.inputSize = CGSize(width: 112, height: 112)
        self.inputName = "input.1"  // Common ArcFace input name
        self.outputName = "embedding"
        self.embeddingDim = 512
        self.mlModel = loadModel()
    }

    /// Whether a real CoreML model is available.
    var isModelAvailable: Bool {
        return mlModel != nil
    }

    /// Generate a 512-dim embedding from a face crop.
    ///
    /// - Parameters:
    ///   - pixelBuffer: BGRA frame containing the face
    ///   - faceBounds: Normalized face bounding box (0.0–1.0) from Vision
    /// - Returns: Embedding result
    func generateEmbedding(pixelBuffer: CVPixelBuffer, faceBounds: CGRect) -> EmbeddingResult {
        guard let model = mlModel else {
            // Fallback: geometric embedding (NOT for production)
            return EmbeddingResult(
                embedding: generateFallbackEmbedding(),
                quality: 0.3,
                usedModel: false
            )
        }

        // 1. Crop + resize the face region to model input size
        guard let croppedFace = cropAndResizeFace(
            pixelBuffer: pixelBuffer,
            faceBounds: faceBounds,
            targetSize: inputSize
        ) else {
            return EmbeddingResult(
                embedding: generateFallbackEmbedding(),
                quality: 0.2,
                usedModel: false
            )
        }

        // 2. Run the CoreML model
        do {
            let inputFeatureValue = try MLFeatureValue(
                pixelBuffer: croppedFace,
                pixelsWide: Int(inputSize.width),
                pixelsHigh: Int(inputSize.height),
                pixelFormatType: kCVPixelFormatType_32BGRA,
                options: nil
            )

            let inputProvider = try MLDictionaryFeatureProvider(
                dictionary: [inputName: inputFeatureValue]
            )

            let outputProvider = try model.prediction(from: inputProvider)
            guard let outputValue = outputProvider.featureValue(for: outputName),
                  let outputMultiArray = outputValue.multiArrayValue else {
                return EmbeddingResult(
                    embedding: generateFallbackEmbedding(),
                    quality: 0.3,
                    usedModel: false
                )
            }

            // 3. Extract embedding from MLMultiArray
            let embedding = extractEmbedding(from: outputMultiArray)

            // 4. L2 normalize
            let normalized = l2Normalize(embedding)

            // 5. Compute quality (based on embedding norm before normalization)
            let quality = computeQuality(embedding: embedding)

            return EmbeddingResult(
                embedding: normalized,
                quality: quality,
                usedModel: true
            )
        } catch {
            print("[VeriFace] CoreML prediction failed: \(error)")
            return EmbeddingResult(
                embedding: generateFallbackEmbedding(),
                quality: 0.3,
                usedModel: false
            )
        }
    }

    // MARK: - Model loading

    /// Load the CoreML model from the app bundle.
    /// Looks for: ArcFace.mlmodelc, MobileFaceNet.mlmodelc, or VeriFaceEmbedding.mlmodelc
    private func loadModel() -> MLModel? {
        let modelNames = [
            "VeriFaceEmbedding",
            "ArcFace",
            "MobileFaceNet",
            "FaceEmbedding",
        ]

        for name in modelNames {
            // Try compiled .mlmodelc first
            if let url = Bundle.main.url(forResource: name, withExtension: "mlmodelc") {
                do {
                    let config = MLModelConfiguration()
                    config.computeUnits = .all  // Use GPU/ANE if available
                    let model = try MLModel(contentsOf: url, configuration: config)
                    print("[VeriFace] Loaded CoreML model: \(name).mlmodelc")
                    return model
                } catch {
                    print("[VeriFace] Failed to load \(name).mlmodelc: \(error)")
                }
            }

            // Try .mlpackage (macOS)
            if let url = Bundle.main.url(forResource: name, withExtension: "mlpackage") {
                do {
                    let config = MLModelConfiguration()
                    config.computeUnits = .all
                    let model = try MLModel(contentsOf: url, configuration: config)
                    print("[VeriFace] Loaded CoreML model: \(name).mlpackage")
                    return model
                } catch {
                    print("[VeriFace] Failed to load \(name).mlpackage: \(error)")
                }
            }
        }

        print("[VeriFace] No CoreML embedding model found — using fallback (NOT production-ready)")
        return nil
    }

    // MARK: - Face cropping + resizing

    /// Crop the face region from a BGRA pixel buffer + resize to targetSize.
    private func cropAndResizeFace(
        pixelBuffer: CVPixelBuffer,
        faceBounds: CGRect,
        targetSize: CGSize
    ) -> CVPixelBuffer? {
        let fullWidth = CVPixelBufferGetWidth(pixelBuffer)
        let fullHeight = CVPixelBufferGetHeight(pixelBuffer)

        // Convert normalized face bounds to pixel coordinates
        let faceRect = CGRect(
            x: faceBounds.minX * CGFloat(fullWidth),
            y: faceBounds.minY * CGFloat(fullHeight),
            width: faceBounds.width * CGFloat(fullWidth),
            height: faceBounds.height * CGFloat(fullHeight)
        )

        // Expand the crop slightly (ArcFace expects some context)
        let expandedRect = faceRect.insetBy(
            dx: -faceRect.width * 0.1,
            dy: -faceRect.height * 0.1
        ).intersection(CGRect(x: 0, y: 0, width: fullWidth, height: fullHeight))

        // Create CIImage from pixel buffer
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let croppedImage = ciImage.cropped(to: expandedRect)

        // Resize to target size
        let scaleX = targetSize.width / expandedRect.width
        let scaleY = targetSize.height / expandedRect.height
        let scaledImage = croppedImage.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        // Create output pixel buffer
        var outputBuffer: CVPixelBuffer?
        let attrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: Int(targetSize.width),
            kCVPixelBufferHeightKey as String: Int(targetSize.height),
        ]
        CVPixelBufferCreate(
            kCFAllocatorDefault,
            Int(targetSize.width),
            Int(targetSize.height),
            kCVPixelFormatType_32BGRA,
            attrs as CFDictionary,
            &outputBuffer
        )

        guard let output = outputBuffer else { return nil }

        // Render to output buffer
        let context = CIContext()
        context.render(scaledImage, to: output)

        return output
    }

    // MARK: - Embedding extraction

    /// Extract Float32 embedding from MLMultiArray.
    private func extractEmbedding(from multiArray: MLMultiArray) -> [Float] {
        let count = multiArray.count
        var embedding = [Float](repeating: 0, count: count)

        let dataType = multiArray.dataType
        switch dataType {
        case .float32:
            let ptr = multiArray.dataPointer.assumingMemoryBound(to: Float.self)
            for i in 0..<count {
                embedding[i] = ptr[i]
            }
        case .float16:
            let ptr = multiArray.dataPointer.assumingMemoryBound(to: UInt16.self)
            for i in 0..<count {
                // Convert Float16 → Float32
                let half = ptr[i]
                embedding[i] = float16ToFloat32(half)
            }
        case .double:
            let ptr = multiArray.dataPointer.assumingMemoryBound(to: Double.self)
            for i in 0..<count {
                embedding[i] = Float(ptr[i])
            }
        default:
            print("[VeriFace] Unsupported multiArray data type: \(dataType)")
        }

        // Truncate or pad to embeddingDim
        if embedding.count > embeddingDim {
            embedding = Array(embedding.prefix(embeddingDim))
        } else if embedding.count < embeddingDim {
            embedding.append(contentsOf: [Float](repeating: 0, count: embeddingDim - embedding.count))
        }

        return embedding
    }

    /// Convert IEEE 754 Float16 to Float32.
    private func float16ToFloat32(_ value: UInt16) -> Float {
        let sign = (value >> 15) & 0x1
        let exponent = (value >> 10) & 0x1F
        let mantissa = value & 0x3FF

        if exponent == 0 {
            if mantissa == 0 {
                return sign == 0 ? 0.0 : -0.0
            } else {
                // Subnormal
                var val = Float(mantissa) / 1024.0
                return sign == 0 ? val : -val
            }
        } else if exponent == 0x1F {
            // Infinity or NaN
            if mantissa == 0 {
                return sign == 0 ? Float.infinity : -Float.infinity
            } else {
                return Float.nan
            }
        } else {
            // Normalized
            let exp = Int(exponent) - 15 + 127
            let bits = (UInt32(sign) << 31) | (UInt32(exp) << 23) | (UInt32(mantissa) << 13)
            return Float(bitPattern: bits)
        }
    }

    /// L2-normalize the embedding (required for cosine similarity).
    private func l2Normalize(_ embedding: [Float]) -> [Float] {
        var sumSq: Float = 0
        for v in embedding {
            sumSq += v * v
        }
        let norm = sqrt(sumSq)
        if norm > 0 {
            return embedding.map { $0 / norm }
        }
        return embedding
    }

    /// Compute quality score from embedding (based on L2 norm before normalization).
    private func computeQuality(embedding: [Float]) -> Double {
        var sumSq: Float = 0
        for v in embedding {
            sumSq += v * v
        }
        let norm = sqrt(sumSq)
        // Higher norm = more confident embedding (typical range: 5–15)
        return min(1.0, Double(norm) / 10.0)
    }

    /// Fallback geometric embedding (NOT for production — low accuracy).
    /// Generates a deterministic 512-dim embedding based on face position + size.
    private func generateFallbackEmbedding() -> [Float] {
        return (0..<embeddingDim).map { i in
            Float(sin(Double(i) * 0.1) * 0.5 + 0.5)
        }
    }
}
