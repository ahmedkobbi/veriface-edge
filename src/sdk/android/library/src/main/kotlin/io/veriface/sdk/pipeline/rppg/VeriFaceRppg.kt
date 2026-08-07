package io.veriface.sdk.pipeline.rppg

import android.graphics.Rect
import android.graphics.ImageFormat
import androidx.camera.core.ImageProxy
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Real CHROM (CHrominance-based rPPG) implementation for Android.
 *
 * Algorithm by De Haan & Jeanne (2013):
 *   1. For each frame, extract the face region (from ML Kit face bounds)
 *   2. Compute mean R, G, B values in the face region
 *   3. Apply CHROM:
 *        X = 3*R - 2*G
 *        Y = 1.5*R + G - 1.5*B
 *   4. Combine: S = X - αY where α = std(X) / std(Y)
 *   5. Detrend S (remove low-frequency drift via moving average)
 *   6. Bandpass filter (0.7–4 Hz = 42–240 BPM)
 *   7. FFT to find dominant frequency → heart rate
 *   8. SNR = peak_power / mean_power
 *
 * Reference: De Haan, G. & Jeanne, V. (2013). "Robust Pulse Rate From
 * Chrominance-Based rPPG." IEEE Transactions on Biomedical Engineering.
 *
 * Pure Kotlin — no native libraries. Uses a radix-2 Cooley-Tukey FFT.
 */
class VeriFaceRppg(
    private val assumedFps: Double = 30.0
) {

    companion object {
        private const val MIN_SNR = 2.0
        private const val MIN_FRAMES = 30
    }

    data class Result(
        val score: Double,
        val heartRateBpm: Double?,
        val snr: Double,
        val frameCount: Int,
        val durationSec: Double
    )

    fun analyze(
        frames: List<ImageProxy>,
        timestamps: List<Long>,
        faceBounds: Rect,
        imageWidth: Int,
        imageHeight: Int
    ): Result {
        if (frames.size < MIN_FRAMES) {
            return Result(0.0, null, 0.0, frames.size, 0.0)
        }

        val rgbMeans = extractRgbMeans(frames, faceBounds)
        if (rgbMeans.size < MIN_FRAMES) {
            return Result(0.0, null, 0.0, rgbMeans.size, 0.0)
        }

        val chromSignal = computeChromSignal(rgbMeans)
        val detrended = detrend(chromSignal, 30)
        val filtered = bandpassFilter(detrended, 0.7, 4.0)
        val (dominantFreq, snr) = computeFftDominantFreq(filtered)

        val heartRateBpm = dominantFreq * 60.0
        val snrScore = minOf(1.0, snr / 10.0)
        val frameScore = minOf(1.0, frames.size.toDouble() / 60.0)
        val hrPlausibility = if (heartRateBpm in 40.0..200.0) 1.0 else 0.3
        val score = 0.5 * snrScore + 0.3 * frameScore + 0.2 * hrPlausibility

        val reportedHr = if (snr >= MIN_SNR) heartRateBpm else null
        val durationSec = if (timestamps.size >= 2) {
            (timestamps.last() - timestamps.first()) / 1_000_000_000.0
        } else {
            frames.size / assumedFps
        }

        return Result(score, reportedHr, snr, frames.size, durationSec)
    }

    private fun extractRgbMeans(frames: List<ImageProxy>, faceBounds: Rect): List<Triple<Double, Double, Double>> {
        val means = mutableListOf<Triple<Double, Double, Double>>()
        for (frame in frames) {
            computeMeanRgb(frame, faceBounds)?.let { means.add(it) }
        }
        return means
    }

    private fun computeMeanRgb(image: ImageProxy, faceBounds: Rect): Triple<Double, Double, Double>? {
        if (image.format != ImageFormat.YUV_420_888) return null

        val yPlane = image.planes[0]
        val uPlane = image.planes[1]
        val vPlane = image.planes[2]

        val yBuffer = yPlane.buffer
        val uBuffer = uPlane.buffer
        val vBuffer = vPlane.buffer

        val yRowStride = yPlane.rowStride
        val yPixelStride = yPlane.pixelStride
        val uRowStride = uPlane.rowStride
        val uPixelStride = uPlane.pixelStride
        val vRowStride = vPlane.rowStride
        val vPixelStride = vPlane.pixelStride

        val width = image.width
        val height = image.height

        val sampleLeft = maxOf(0, faceBounds.left + faceBounds.width() / 5)
        val sampleRight = minOf(width, faceBounds.right - faceBounds.width() / 5)
        val sampleTop = maxOf(0, faceBounds.top + faceBounds.height() / 4)
        val sampleBottom = minOf(height, faceBounds.bottom - faceBounds.height() / 4)

        if (sampleRight <= sampleLeft || sampleBottom <= sampleTop) return null

        var totalR = 0L
        var totalG = 0L
        var totalB = 0L
        var pixelCount = 0L

        val stride = 4
        var y = sampleTop
        while (y < sampleBottom) {
            var x = sampleLeft
            while (x < sampleRight) {
                val yIndex = y * yRowStride + x * yPixelStride
                val yVal = yBuffer.get(yIndex).toInt() and 0xFF

                val uvX = x / 2
                val uvY = y / 2
                val uIndex = uvY * uRowStride + uvX * uPixelStride
                val vIndex = uvY * vRowStride + uvX * vPixelStride

                val uVal = uBuffer.get(uIndex).toInt() and 0xFF
                val vVal = vBuffer.get(vIndex).toInt() and 0xFF

                val r = (yVal + 1.402 * (vVal - 128)).coerceIn(0.0, 255.0)
                val g = (yVal - 0.344 * (uVal - 128) - 0.714 * (vVal - 128)).coerceIn(0.0, 255.0)
                val b = (yVal + 1.772 * (uVal - 128)).coerceIn(0.0, 255.0)

                totalR += r.toLong()
                totalG += g.toLong()
                totalB += b.toLong()
                pixelCount++
                x += stride
            }
            y += stride
        }

        if (pixelCount == 0L) return null
        val n = pixelCount.toDouble()
        return Triple(totalR / n / 255.0, totalG / n / 255.0, totalB / n / 255.0)
    }

    private fun computeChromSignal(rgbMeans: List<Triple<Double, Double, Double>>): DoubleArray {
        if (rgbMeans.size <= 1) return DoubleArray(0)

        val xSignal = DoubleArray(rgbMeans.size) { 3.0 * rgbMeans[it].first - 2.0 * rgbMeans[it].second }
        val ySignal = DoubleArray(rgbMeans.size) { 1.5 * rgbMeans[it].first + rgbMeans[it].second - 1.5 * rgbMeans[it].third }

        val xStd = standardDeviation(xSignal)
        val yStd = standardDeviation(ySignal)
        val alpha = if (yStd > 0) xStd / yStd else 1.0

        return DoubleArray(rgbMeans.size) { xSignal[it] - alpha * ySignal[it] }
    }

    private fun detrend(signal: DoubleArray, windowSize: Int): DoubleArray {
        if (signal.size <= windowSize) return signal
        val n = signal.size
        val result = DoubleArray(n)
        val halfWindow = windowSize / 2
        val movingAvg = DoubleArray(n)
        for (i in 0 until n) {
            val start = maxOf(0, i - halfWindow)
            val end = minOf(n, i + halfWindow + 1)
            var sum = 0.0
            for (j in start until end) sum += signal[j]
            movingAvg[i] = sum / (end - start)
        }
        for (i in 0 until n) result[i] = signal[i] - movingAvg[i]
        return result
    }

    private fun bandpassFilter(signal: DoubleArray, lowFreq: Double, highFreq: Double): DoubleArray {
        val lowPassWindow = maxOf(3, (assumedFps / highFreq).toInt())
        return movingAverage(signal, lowPassWindow)
    }

    private fun movingAverage(signal: DoubleArray, windowSize: Int): DoubleArray {
        if (windowSize <= 1 || signal.size < windowSize) return signal
        val n = signal.size
        val result = DoubleArray(n)
        val halfWindow = windowSize / 2
        for (i in 0 until n) {
            val start = maxOf(0, i - halfWindow)
            val end = minOf(n, i + halfWindow + 1)
            var sum = 0.0
            for (j in start until end) sum += signal[j]
            result[i] = sum / (end - start)
        }
        return result
    }

    private fun computeFftDominantFreq(signal: DoubleArray): Pair<Double, Double> {
        if (signal.size < 16) return Pair(0.0, 0.0)

        val fftN = nextPowerOfTwo(signal.size)
        val padded = DoubleArray(fftN)
        for (i in signal.indices) padded[i] = signal[i]

        val windowed = applyHannWindow(padded)
        val (real, imag) = fft(windowed)

        val halfSize = fftN / 2
        val magnitudes = DoubleArray(halfSize) { sqrt(real[it] * real[it] + imag[it] * imag[it]) }

        val binWidth = assumedFps / fftN
        val lowBin = (0.7 / binWidth).toInt()
        val highBin = (4.0 / binWidth).toInt()

        if (highBin <= lowBin || highBin >= magnitudes.size) return Pair(0.0, 0.0)

        var peakBin = lowBin
        var peakMag = 0.0
        for (i in lowBin..highBin) {
            if (magnitudes[i] > peakMag) {
                peakMag = magnitudes[i]
                peakBin = i
            }
        }

        var meanMag = 0.0
        for (i in lowBin..highBin) meanMag += magnitudes[i]
        meanMag /= (highBin - lowBin + 1)
        val snr = if (meanMag > 0) (peakMag * peakMag) / (meanMag * meanMag) else 0.0

        return Pair(peakBin * binWidth, snr)
    }

    private fun applyHannWindow(signal: DoubleArray): DoubleArray {
        val n = signal.size
        val result = DoubleArray(n)
        for (i in 0 until n) {
            val w = 0.5 * (1.0 - cos(2.0 * Math.PI * i / (n - 1)))
            result[i] = signal[i] * w
        }
        return result
    }

    private fun fft(input: DoubleArray): Pair<DoubleArray, DoubleArray> {
        val n = input.size
        require(n and (n - 1) == 0) { "FFT size must be power of 2" }

        val real = input.copyOf()
        val imag = DoubleArray(n)

        var j = 0
        for (i in 1 until n) {
            var bit = n shr 1
            while (j and bit != 0) {
                j = j xor bit
                bit = bit shr 1
            }
            j = j or bit
            if (i < j) {
                real[i] = real[j].also { real[j] = real[i] }
                imag[i] = imag[j].also { imag[j] = imag[i] }
            }
        }

        var len = 2
        while (len <= n) {
            val angle = -2.0 * Math.PI / len
            val wReal = cos(angle)
            val wImag = sin(angle)
            var i = 0
            while (i < n) {
                var curReal = 1.0
                var curImag = 0.0
                val halfLen = len / 2
                for (k in 0 until halfLen) {
                    val idx1 = i + k
                    val idx2 = i + k + halfLen
                    val tReal = curReal * real[idx2] - curImag * imag[idx2]
                    val tImag = curReal * imag[idx2] + curImag * real[idx2]
                    real[idx2] = real[idx1] - tReal
                    imag[idx2] = imag[idx1] - tImag
                    real[idx1] = real[idx1] + tReal
                    imag[idx1] = imag[idx1] + tImag
                    val newReal = curReal * wReal - curImag * wImag
                    curImag = curReal * wImag + curImag * wReal
                    curReal = newReal
                }
                i += len
            }
            len *= 2
        }

        return Pair(real, imag)
    }

    private fun standardDeviation(values: DoubleArray): Double {
        if (values.size <= 1) return 0.0
        val mean = values.average()
        val variance = values.map { (it - mean).pow(2) }.sum() / (values.size - 1)
        return sqrt(variance)
    }

    private fun nextPowerOfTwo(n: Int): Int {
        var power = 1
        while (power < n) power *= 2
        return power
    }
}
