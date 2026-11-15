package com.privatemessenger.app.webrtc

import com.privatemessenger.app.data.model.P2PTransfer
import com.privatemessenger.app.data.model.P2PTransferStatus
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.io.FileInputStream
import java.security.MessageDigest

class WebRtcTransferManager {

    companion object {
        const val CHUNK_SIZE = 64 * 1024 // 64 KB
        const val BUFFER_THRESHOLD = 4 * 1024 * 1024L // 4 MB
    }

    private val _transferState = MutableStateFlow<P2PTransfer?>(null)
    val transferState: StateFlow<P2PTransfer?> = _transferState.asStateFlow()

    @Volatile
    private var isPaused: Boolean = false

    @Volatile
    private var isCancelled: Boolean = false

    fun calculateSha256(file: File): String {
        if (!file.exists() || !file.isFile || !file.canRead()) {
            return ""
        }
        val digest = MessageDigest.getInstance("SHA-256")
        try {
            FileInputStream(file).use { fis ->
                val buffer = ByteArray(CHUNK_SIZE)
                var bytesRead: Int
                while (fis.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            val bytes = digest.digest()
            return bytes.joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            return ""
        }
    }

    suspend fun simulateChunkedStreaming(
        transfer: P2PTransfer,
        onProgress: (bytesSent: Long, percent: Int, speedBytesSec: Long) -> Unit
    ) {
        val totalBytes = transfer.fileSize
        if (totalBytes <= 0L) {
            _transferState.value = transfer.copy(
                status = P2PTransferStatus.COMPLETED,
                bytesTransferred = 0L,
                progressPercentage = 100,
                speedBytesPerSec = 0L
            )
            onProgress(0L, 100, 0L)
            return
        }

        _transferState.value = transfer.copy(status = P2PTransferStatus.TRANSFERRING)
        isPaused = false
        isCancelled = false

        var sentBytes = 0L
        var lastTime = System.currentTimeMillis()
        var bytesSinceCheck = 0L

        while (sentBytes < totalBytes) {
            if (isCancelled) {
                _transferState.value = _transferState.value?.copy(status = P2PTransferStatus.CANCELLED)
                return
            }

            while (isPaused) {
                kotlinx.coroutines.delay(200)
                if (isCancelled) return
            }

            val nextChunk = minOf(CHUNK_SIZE.toLong(), totalBytes - sentBytes)
            sentBytes += nextChunk
            bytesSinceCheck += nextChunk

            val now = System.currentTimeMillis()
            val timeDiff = (now - lastTime) / 1000.0
            var speed = 0L
            if (timeDiff >= 0.5) {
                speed = (bytesSinceCheck / timeDiff).toLong()
                bytesSinceCheck = 0
                lastTime = now
            }

            val percentage = ((sentBytes.toDouble() / totalBytes) * 100).toInt().coerceIn(0, 100)
            onProgress(sentBytes, percentage, speed)
            _transferState.value = _transferState.value?.copy(
                bytesTransferred = sentBytes,
                progressPercentage = percentage,
                speedBytesPerSec = speed
            )

            kotlinx.coroutines.delay(20) // Emulate network transit delay
        }

        _transferState.value = _transferState.value?.copy(
            status = P2PTransferStatus.COMPLETED,
            bytesTransferred = totalBytes,
            progressPercentage = 100
        )
    }

    fun pause() {
        isPaused = true
        _transferState.value = _transferState.value?.copy(status = P2PTransferStatus.PENDING)
    }

    fun resume() {
        isPaused = false
        _transferState.value = _transferState.value?.copy(status = P2PTransferStatus.TRANSFERRING)
    }

    fun cancel() {
        isCancelled = true
        _transferState.value = _transferState.value?.copy(status = P2PTransferStatus.CANCELLED)
    }
}
