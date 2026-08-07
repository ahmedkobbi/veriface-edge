package io.veriface.sdk.pipeline.pad

import android.graphics.Rect
import android.graphics.ImageFormat
import androidx.camera.core.ImageProxy
import kotlin.math.log2
import kotlin.math.pow
import kotlin.math.sqrt

/**
 * Real LBP-based Presentation Attack Detection for Android.
 *
 * Uses Local Binary Pattern (LBP) texture analysis to detect presentation
 * attacks (printed photos, screen replays, masks).
 *
 * Algorithm:
 *   1. Extract the face region from the YUV frame
 *   2. Convert to grayscale (Y channel is already grayscale in YUV)
 *   3. Compute LBP histogram (uniform patterns, 8 neighbors)
 *   4. Compute texture features: LBP variance, LBP entropy, edge density
 *   5. Combine into a PAD score (0.0–1.0)
 *
 * Reference: Ahonen, T. et al. (2006). "Face Description with Local Binary
 * Patterns." IEEE TPAMI.
 */
class VeriFacePad {

    companion object {
        private const val MIN_FACE_SIZE = 64
    }

    data class Result(
        val combined: Double,
        val texture: Double,
        val depth: Double,
        val lbpVariance: Double,
        val lbpEntropy: Double,
        val edgeDensity: Double
    )

    fun analyze(image: ImageProxy, faceBounds: Rect): Result {
        val grayFace = extractGrayscaleFace(image, faceBounds) ?: return Result(0.5, 0.5, 0.5, 0.0, 0.0, 0.0)

        val lbpImage = computeLbp(grayFace.data, grayFace.width, grayFace.height)
        val histogram = computeLbpHistogram(lbpImage, grayFace.width, grayFace.height)

        val lbpVariance = computeVariance(histogram)
        val lbpEntropy = computeEntropy(histogram)
        val edgeDensity = computeEdgeDensity(grayFace.data, grayFace.width, grayFace.height)

        val textureScore = normalizeTexture(lbpVariance, lbpEntropy)
        val depthScore = normalizeDepth(edgeDensity, lbpVariance)
        val combined = 0.6 * textureScore + 0.4 * depthScore

        return Result(combined, textureScore, depthScore, lbpVariance, lbpEntropy, edgeDensity)
    }

    private data class GrayscaleFace(val data: ByteArray, val width: Int, val height: Int)

    private fun extractGrayscaleFace(image: ImageProxy, faceBounds: Rect): GrayscaleFace? {
        if (image.format != ImageFormat.YUV_420_888) return null

        val yPlane = image.planes[0]
        val yBuffer = yPlane.buffer
        val yRowStride = yPlane.rowStride
        val yPixelStride = yPlane.pixelStride

        val fullWidth = image.width
        val fullHeight = image.height

        val faceWidth = faceBounds.width()
        val faceHeight = faceBounds.height()

        if (faceWidth < MIN_FACE_SIZE || faceHeight < MIN_FACE_SIZE) return null

        val startX = maxOf(0, faceBounds.left)
        val startY = maxOf(0, faceBounds.top)
        val endX = minOf(fullWidth, faceBounds.right)
        val endY = minOf(fullHeight, faceBounds.bottom)

        val actualWidth = endX - startX
        val actualHeight = endY - startY

        val grayData = ByteArray(faceWidth * faceHeight)

        for (y in 0 until actualHeight) {
            for (x in 0 until actualWidth) {
                val yIndex = (startY + y) * yRowStride + (startX + x) * yPixelStride
                if (yIndex < yBuffer.capacity()) {
                    grayData[y * faceWidth + x] = yBuffer.get(yIndex)
                }
            }
        }

        return GrayscaleFace(grayData, faceWidth, faceHeight)
    }

    private fun computeLbp(grayscale: ByteArray, width: Int, height: Int): ByteArray {
        val lbp = ByteArray(width * height)

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val center = grayscale[y * width + x].toInt() and 0xFF
                var pattern = 0

                val neighbors = intArrayOf(
                    grayscale[(y - 1) * width + (x - 1)].toInt() and 0xFF,
                    grayscale[(y - 1) * width + x].toInt() and 0xFF,
                    grayscale[(y - 1) * width + (x + 1)].toInt() and 0xFF,
                    grayscale[y * width + (x + 1)].toInt() and 0xFF,
                    grayscale[(y + 1) * width + (x + 1)].toInt() and 0xFF,
                    grayscale[(y + 1) * width + x].toInt() and 0xFF,
                    grayscale[(y + 1) * width + (x - 1)].toInt() and 0xFF,
                    grayscale[y * width + (x - 1)].toInt() and 0xFF
                )

                for (i in neighbors.indices) {
                    if (neighbors[i] >= center) {
                        pattern = pattern or (1 shl i)
                    }
                }

                lbp[y * width + x] = mapToUniformLbp(pattern.toByte())
            }
        }

        return lbp
    }

    private fun mapToUniformLbp(pattern: Byte): Byte {
        val p = pattern.toInt() and 0xFF
        var transitions = 0
        for (i in 0 until 8) {
            val bit1 = (p shr i) and 1
            val bit2 = (p shr ((i + 1) % 8)) and 1
            if (bit1 != bit2) transitions++
        }

        return if (transitions <= 2) (p % 58).toByte() else 58
    }

    private fun computeLbpHistogram(lbpImage: ByteArray, width: Int, height: Int): DoubleArray {
        val histogram = DoubleArray(59)
        var count = 0

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val code = lbpImage[y * width + x].toInt() and 0xFF
                if (code < 59) {
                    histogram[code] += 1.0
                    count++
                }
            }
        }

        if (count > 0) {
            for (i in 0 until 59) histogram[i] /= count
        }

        return histogram
    }

    private fun computeVariance(histogram: DoubleArray): Double {
        val mean = histogram.average()
        val variance = histogram.map { (it - mean).pow(2) }.sum() / histogram.size
        return variance
    }

    private fun computeEntropy(histogram: DoubleArray): Double {
        var entropy = 0.0
        for (p in histogram) {
            if (p > 0) entropy -= p * log2(p)
        }
        return entropy
    }

    private fun computeEdgeDensity(grayscale: ByteArray, width: Int, height: Int): Double {
        var edgeCount = 0
        var totalCount = 0
        val threshold = 50

        for (y in 1 until height - 1) {
            for (x in 1 until width - 1) {
                val gx = (grayscale[(y - 1) * width + (x + 1)].toInt() and 0xFF) +
                    2 * (grayscale[y * width + (x + 1)].toInt() and 0xFF) +
                    (grayscale[(y + 1) * width + (x + 1)].toInt() and 0xFF) -
                    (grayscale[(y - 1) * width + (x - 1)].toInt() and 0xFF) -
                    2 * (grayscale[y * width + (x - 1)].toInt() and 0xFF) -
                    (grayscale[(y + 1) * width + (x - 1)].toInt() and 0xFF)

                val gy = (grayscale[(y + 1) * width + (x - 1)].toInt() and 0xFF) +
                    2 * (grayscale[(y + 1) * width + x].toInt() and 0xFF) +
                    (grayscale[(y + 1) * width + (x + 1)].toInt() and 0xFF) -
                    (grayscale[(y - 1) * width + (x - 1)].toInt() and 0xFF) -
                    2 * (grayscale[(y - 1) * width + x].toInt() and 0xFF) -
                    (grayscale[(y - 1) * width + (x + 1)].toInt() and 0xFF)

                val magnitude = sqrt((gx * gx + gy * gy).toDouble()).toInt().coerceAtMost(255)
                if (magnitude > threshold) edgeCount++
                totalCount++
            }
        }

        return if (totalCount > 0) edgeCount.toDouble() / totalCount else 0.0
    }

    private fun normalizeTexture(lbpVariance: Double, lbpEntropy: Double): Double {
        val varianceScore = minOf(1.0, lbpVariance / 0.015)
        val entropyScore = minOf(1.0, lbpEntropy / 4.0)
        return 0.5 * varianceScore + 0.5 * entropyScore
    }

    private fun normalizeDepth(edgeDensity: Double, lbpVariance: Double): Double {
        val edgeScore = when {
            edgeDensity <= 0.05 -> 1.0
            edgeDensity >= 0.3 -> 0.0
            else -> 1.0 - (edgeDensity - 0.05) / 0.25
        }
        val varianceScore = minOf(1.0, lbpVariance / 0.015)
        return 0.6 * edgeScore + 0.4 * varianceScore
    }
}
