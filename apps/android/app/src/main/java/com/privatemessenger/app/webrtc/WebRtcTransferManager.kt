package com.privatemessenger.app.webrtc

import android.content.Context
import android.net.Uri
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.model.P2PTransfer
import com.privatemessenger.app.data.model.P2PTransferStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import livekit.org.webrtc.DataChannel
import livekit.org.webrtc.IceCandidate
import livekit.org.webrtc.MediaConstraints
import livekit.org.webrtc.MediaStream
import livekit.org.webrtc.PeerConnection
import livekit.org.webrtc.PeerConnectionFactory
import livekit.org.webrtc.RtpReceiver
import livekit.org.webrtc.SdpObserver
import livekit.org.webrtc.SessionDescription
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.coroutines.resume
import kotlin.coroutines.suspendCoroutine

/**
 * Shared registry of active and recent P2P/media file transfers so UI composables
 * and WorkManager workers stay synchronized in real time.
 */
object P2PTransferRegistry {
    private val _transfers = MutableStateFlow<Map<String, P2PTransfer>>(emptyMap())
    val transfers: StateFlow<Map<String, P2PTransfer>> = _transfers.asStateFlow()

    private val managers = ConcurrentHashMap<String, WebRtcTransferManager>()

    fun registerManager(transferId: String, manager: WebRtcTransferManager) {
        managers[transferId] = manager
    }

    fun getManager(transferId: String): WebRtcTransferManager? = managers[transferId]

    fun updateTransfer(transfer: P2PTransfer) {
        _transfers.value = _transfers.value.toMutableMap().apply {
            put(transfer.id, transfer)
        }
    }

    fun pauseTransfer(transferId: String) {
        managers[transferId]?.pause()
    }

    fun resumeTransfer(transferId: String) {
        managers[transferId]?.resume()
    }

    fun cancelTransfer(transferId: String) {
        managers[transferId]?.cancel()
    }
}

/**
 * High-performance WebRTC DataChannel 1 GB P2P binary chunk streaming engine with
 * 4 MB / 1 MB backpressure control, ICE candidate queuing, disk-buffered streaming,
 * and SHA-256 cryptographic integrity verification.
 *
 * Wire protocol matches `apps/web/src/lib/webrtc/p2pTransfer.ts`:
 * - Chunk Size: 64 KB (65,536 bytes)
 * - High Watermark: 4 MB (4,194,304 bytes)
 * - Low Watermark: 1 MB (1,048,576 bytes)
 * - Control frames: JSON { type: "HEADER", metadata: ... } and { type: "EOF", transferId }
 */
class WebRtcTransferManager(
    private val context: Context? = null,
    private val signalSender: ((JSONObject) -> Unit)? = null
) {

    companion object {
        const val CHUNK_SIZE = 64 * 1024 // 64 KB
        const val BUFFER_THRESHOLD = 4 * 1024 * 1024L // 4 MB high watermark
        const val BUFFER_LOW_WATERMARK = 1 * 1024 * 1024L // 1 MB low watermark
        const val MAX_FILE_SIZE = 1024L * 1024L * 1024L // 1 GB

        @Volatile
        private var factoryInitialized = false

        private fun ensureWebRtcFactory(context: Context): PeerConnectionFactory {
            if (!factoryInitialized) {
                synchronized(this) {
                    if (!factoryInitialized) {
                        PeerConnectionFactory.initialize(
                            PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                                .createInitializationOptions()
                        )
                        factoryInitialized = true
                    }
                }
            }
            return PeerConnectionFactory.builder().createPeerConnectionFactory()
        }

        fun defaultIceServers(): List<PeerConnection.IceServer> = listOf(
            PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
            PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
        )
    }

    private val _transferState = MutableStateFlow<P2PTransfer?>(null)
    val transferState: StateFlow<P2PTransfer?> = _transferState.asStateFlow()

    @Volatile
    private var isPaused: Boolean = false

    @Volatile
    private var isCancelled: Boolean = false

    @Volatile
    private var remoteDescriptionSet: Boolean = false

    private var peerConnectionFactory: PeerConnectionFactory? = null
    private var peerConnection: PeerConnection? = null
    private var dataChannel: DataChannel? = null
    private val pendingIceCandidates = CopyOnWriteArrayList<IceCandidate>()

    fun calculateSha256(file: File): String {
        if (!file.exists() || !file.isFile || !file.canRead()) {
            return ""
        }
        val digest = MessageDigest.getInstance("SHA-256")
        return try {
            FileInputStream(file).use { fis ->
                val buffer = ByteArray(CHUNK_SIZE)
                var bytesRead: Int
                while (fis.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            ""
        }
    }

    fun calculateSha256(context: Context, uri: Uri): String {
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            context.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(CHUNK_SIZE)
                var bytesRead: Int
                while (input.read(buffer).also { bytesRead = it } != -1) {
                    digest.update(buffer, 0, bytesRead)
                }
            } ?: return ""
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * Streams a real file from Android [ContentResolver] [uri] in 64 KB chunks.
     * If a real WebRTC [DataChannel] is open, streams binary frames over WebRTC with 4MB/1MB
     * backpressure control; otherwise streams locally with real disk I/O + SHA-256 verification.
     */
    suspend fun streamFromUri(
        context: Context,
        uri: Uri,
        transfer: P2PTransfer,
        onProgress: (bytesSent: Long, percent: Int, speedBytesSec: Long) -> Unit
    ): Result<String> = withContext(Dispatchers.IO) {
        if (transfer.fileSize > MAX_FILE_SIZE) {
            val failed = transfer.copy(status = P2PTransferStatus.FAILED)
            emitState(failed)
            return@withContext Result.failure(IllegalArgumentException("File exceeds 1 GB P2P limit"))
        }

        isPaused = false
        isCancelled = false
        P2PTransferRegistry.registerManager(transfer.id, this@WebRtcTransferManager)

        val totalBytes = transfer.fileSize
        if (totalBytes <= 0L) {
            val sha = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            val done = transfer.copy(
                status = P2PTransferStatus.COMPLETED,
                bytesTransferred = 0L,
                progressPercentage = 100,
                speedBytesPerSec = 0L,
                fileHashSha256 = sha
            )
            emitState(done)
            onProgress(0L, 100, 0L)
            return@withContext Result.success(sha)
        }

        emitState(transfer.copy(status = P2PTransferStatus.TRANSFERRING, progressPercentage = 0))

        try {
            val digest = MessageDigest.getInstance("SHA-256")
            val channel = dataChannel?.takeIf { it.state() == DataChannel.State.OPEN }

            if (channel != null) {
                val headerJson = JSONObject().apply {
                    put("type", "HEADER")
                    put("metadata", JSONObject().apply {
                        put("transferId", transfer.id)
                        put("fileName", transfer.fileName)
                        put("fileSize", transfer.fileSize)
                        put("fileType", transfer.fileType)
                        put("fileHashSha256", transfer.fileHashSha256)
                        put("senderId", transfer.senderId)
                        put("receiverId", transfer.receiverId)
                        put("conversationId", transfer.conversationId)
                    })
                }
                channel.send(DataChannel.Buffer(ByteBuffer.wrap(headerJson.toString().toByteArray(Charsets.UTF_8)), false))
            }

            var sentBytes = 0L
            var lastSpeedCheck = System.currentTimeMillis()
            var bytesSinceCheck = 0L
            var currentSpeed = 0L
            var lastUiNotify = 0L

            context.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(CHUNK_SIZE)
                var bytesRead: Int
                while (input.read(buffer).also { bytesRead = it } != -1) {
                    if (isCancelled) {
                        emitState(_transferState.value?.copy(status = P2PTransferStatus.CANCELLED))
                        return@withContext Result.failure(IllegalStateException("Transfer cancelled"))
                    }

                    while (isPaused) {
                        delay(150)
                        if (isCancelled) {
                            emitState(_transferState.value?.copy(status = P2PTransferStatus.CANCELLED))
                            return@withContext Result.failure(IllegalStateException("Transfer cancelled"))
                        }
                    }

                    // WebRTC DataChannel backpressure control
                    if (channel != null && channel.bufferedAmount() > BUFFER_THRESHOLD) {
                        while (channel.bufferedAmount() > BUFFER_LOW_WATERMARK &&
                            channel.state() == DataChannel.State.OPEN &&
                            !isCancelled
                        ) {
                            delay(25)
                        }
                    }

                    digest.update(buffer, 0, bytesRead)

                    if (channel != null && channel.state() == DataChannel.State.OPEN) {
                        val copy = buffer.copyOf(bytesRead)
                        channel.send(DataChannel.Buffer(ByteBuffer.wrap(copy), true))
                    } else {
                        // Gentle pacing for local verification when peer channel isn't attached
                        if (totalBytes > 50 * 1024 * 1024L) {
                            // No artificial sleep for huge files beyond I/O
                        } else {
                            delay(2)
                        }
                    }

                    sentBytes += bytesRead
                    bytesSinceCheck += bytesRead

                    val now = System.currentTimeMillis()
                    val elapsedSec = (now - lastSpeedCheck) / 1000.0
                    if (elapsedSec >= 0.4) {
                        currentSpeed = (bytesSinceCheck / elapsedSec).toLong()
                        bytesSinceCheck = 0L
                        lastSpeedCheck = now
                    }

                    if (now - lastUiNotify >= 80 || sentBytes >= totalBytes) {
                        lastUiNotify = now
                        val pct = ((sentBytes.toDouble() / totalBytes) * 100.0).toInt().coerceIn(0, 100)
                        onProgress(sentBytes, pct, currentSpeed)
                        emitState(
                            _transferState.value?.copy(
                                status = P2PTransferStatus.TRANSFERRING,
                                bytesTransferred = sentBytes,
                                progressPercentage = pct,
                                speedBytesPerSec = currentSpeed
                            )
                        )
                    }
                }
            } ?: run {
                emitState(transfer.copy(status = P2PTransferStatus.FAILED))
                return@withContext Result.failure(IllegalStateException("Cannot open file stream"))
            }

            val computedSha256 = digest.digest().joinToString("") { "%02x".format(it) }
            if (transfer.fileHashSha256.isNotBlank() &&
                !computedSha256.equals(transfer.fileHashSha256, ignoreCase = true)
            ) {
                emitState(transfer.copy(status = P2PTransferStatus.FAILED))
                return@withContext Result.failure(SecurityException("SHA-256 checksum mismatch"))
            }

            if (channel != null && channel.state() == DataChannel.State.OPEN) {
                val eofJson = JSONObject().apply {
                    put("type", "EOF")
                    put("transferId", transfer.id)
                    put("receivedSha256", computedSha256)
                }
                channel.send(DataChannel.Buffer(ByteBuffer.wrap(eofJson.toString().toByteArray(Charsets.UTF_8)), false))
            }

            val completed = transfer.copy(
                status = P2PTransferStatus.COMPLETED,
                bytesTransferred = sentBytes,
                progressPercentage = 100,
                speedBytesPerSec = currentSpeed,
                fileHashSha256 = computedSha256
            )
            emitState(completed)
            onProgress(sentBytes, 100, currentSpeed)
            Result.success(computedSha256)
        } catch (e: Exception) {
            if (!isCancelled) {
                emitState(transfer.copy(status = P2PTransferStatus.FAILED))
            }
            Result.failure(e)
        }
    }

    /**
     * Initializes a WebRTC PeerConnection + DataChannel (`p2p-file-transfer`) as the offerer
     * and emits `p2p_offer` + `p2p_ice` signaling frames compatible with Web `P2PFileSender`.
     */
    suspend fun startSenderPeerConnection(transfer: P2PTransfer): Boolean = withContext(Dispatchers.IO) {
        val ctx = context ?: return@withContext false
        try {
            val factory = ensureWebRtcFactory(ctx).also { peerConnectionFactory = it }
            val rtcConfig = PeerConnection.RTCConfiguration(defaultIceServers())
            remoteDescriptionSet = false
            pendingIceCandidates.clear()

            peerConnection = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate?) {
                    candidate ?: return
                    signalSender?.invoke(JSONObject().apply {
                        put("type", "p2p_ice")
                        put("transferId", transfer.id)
                        put("candidate", JSONObject().apply {
                            put("candidate", candidate.sdp)
                            put("sdpMid", candidate.sdpMid)
                            put("sdpMLineIndex", candidate.sdpMLineIndex)
                        })
                    })
                }

                override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) {}
                override fun onIceConnectionReceivingChange(p0: Boolean) {}
                override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
                override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
                override fun onAddStream(p0: MediaStream?) {}
                override fun onRemoveStream(p0: MediaStream?) {}
                override fun onDataChannel(p0: DataChannel?) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(p0: RtpReceiver?, p1: Array<out MediaStream>?) {}
            })

            val init = DataChannel.Init().apply { ordered = true }
            dataChannel = peerConnection?.createDataChannel("p2p-file-transfer", init)

            val offer = suspendCoroutine<SessionDescription?> { cont ->
                peerConnection?.createOffer(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) {
                        cont.resume(sdp)
                    }
                    override fun onCreateFailure(err: String?) {
                        cont.resume(null)
                    }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(p0: String?) {}
                }, MediaConstraints()) ?: cont.resume(null)
            } ?: return@withContext false

            val localSet = suspendCoroutine<Boolean> { cont ->
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() { cont.resume(true) }
                    override fun onSetFailure(p0: String?) { cont.resume(false) }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, offer) ?: cont.resume(false)
            }
            if (!localSet) return@withContext false

            signalSender?.invoke(JSONObject().apply {
                put("type", "p2p_offer")
                put("transferId", transfer.id)
                put("sdp", JSONObject().apply {
                    put("type", offer.type.canonicalForm())
                    put("sdp", offer.description)
                })
                put("metadata", JSONObject().apply {
                    put("transferId", transfer.id)
                    put("fileName", transfer.fileName)
                    put("fileSize", transfer.fileSize)
                    put("fileType", transfer.fileType)
                    put("fileHashSha256", transfer.fileHashSha256)
                    put("senderId", transfer.senderId)
                    put("receiverId", transfer.receiverId)
                    put("conversationId", transfer.conversationId)
                })
            })
            true
        } catch (_: Exception) {
            false
        }
    }

    /**
     * Handles incoming WebRTC SDP answer and flushes any queued ICE candidates.
     */
    suspend fun handleRemoteAnswer(sdpString: String): Boolean {
        val pc = peerConnection ?: return false
        val answer = SessionDescription(SessionDescription.Type.ANSWER, sdpString)
        val ok = suspendCoroutine<Boolean> { cont ->
            pc.setRemoteDescription(object : SdpObserver {
                override fun onSetSuccess() { cont.resume(true) }
                override fun onSetFailure(p0: String?) { cont.resume(false) }
                override fun onCreateSuccess(p0: SessionDescription?) {}
                override fun onCreateFailure(p0: String?) {}
            }, answer)
        }
        if (ok) {
            remoteDescriptionSet = true
            pendingIceCandidates.forEach { pc.addIceCandidate(it) }
            pendingIceCandidates.clear()
        }
        return ok
    }

    /**
     * Initializes a receiver PeerConnection to stream incoming 64 KB DataChannel chunks directly
     * to disk in `filesDir/p2p_downloads/` and verify SHA-256 upon `EOF`.
     */
    suspend fun handleRemoteOfferAsReceiver(
        offerSdp: String,
        transfer: P2PTransfer,
        onComplete: (Result<File>) -> Unit
    ): Boolean = withContext(Dispatchers.IO) {
        val ctx = context ?: return@withContext false
        try {
            val factory = ensureWebRtcFactory(ctx).also { peerConnectionFactory = it }
            val rtcConfig = PeerConnection.RTCConfiguration(defaultIceServers())
            remoteDescriptionSet = false
            pendingIceCandidates.clear()

            val downloadsDir = File(ctx.filesDir, "p2p_downloads").apply { mkdirs() }
            val safeTransferId = MediaFileInspector.sanitizeFileName(transfer.id)
            val safeFileName = MediaFileInspector.sanitizeFileName(transfer.fileName)
            val outFile = File(downloadsDir, "${safeTransferId}_$safeFileName")
            val canonicalParent = downloadsDir.canonicalPath + File.separator
            if (!outFile.canonicalPath.startsWith(canonicalParent)) {
                return@withContext false
            }
            val fos = FileOutputStream(outFile)
            val digest = MessageDigest.getInstance("SHA-256")
            var receivedBytes = 0L

            peerConnection = factory.createPeerConnection(rtcConfig, object : PeerConnection.Observer {
                override fun onIceCandidate(candidate: IceCandidate?) {
                    candidate ?: return
                    signalSender?.invoke(JSONObject().apply {
                        put("type", "p2p_ice")
                        put("transferId", transfer.id)
                        put("candidate", JSONObject().apply {
                            put("candidate", candidate.sdp)
                            put("sdpMid", candidate.sdpMid)
                            put("sdpMLineIndex", candidate.sdpMLineIndex)
                        })
                    })
                }

                override fun onDataChannel(channel: DataChannel?) {
                    channel ?: return
                    dataChannel = channel
                    channel.registerObserver(object : DataChannel.Observer {
                        override fun onBufferedAmountChange(previousAmount: Long) {}
                        override fun onStateChange() {}
                        override fun onMessage(buffer: DataChannel.Buffer?) {
                            buffer ?: return
                            val bytes = ByteArray(buffer.data.remaining())
                            buffer.data.get(bytes)
                            if (!buffer.binary) {
                                try {
                                    val payload = JSONObject(String(bytes, Charsets.UTF_8))
                                    if (payload.optString("type") == "EOF") {
                                        fos.flush()
                                        fos.close()
                                        val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
                                        if (transfer.fileHashSha256.isNotBlank() &&
                                            !actualHash.equals(transfer.fileHashSha256, ignoreCase = true)
                                        ) {
                                            outFile.delete()
                                            emitState(transfer.copy(status = P2PTransferStatus.FAILED))
                                            onComplete(Result.failure(SecurityException("SHA-256 verification failed")))
                                        } else {
                                            emitState(
                                                transfer.copy(
                                                    status = P2PTransferStatus.COMPLETED,
                                                    bytesTransferred = receivedBytes,
                                                    progressPercentage = 100
                                                )
                                            )
                                            onComplete(Result.success(outFile))
                                        }
                                    }
                                } catch (e: Exception) {
                                    onComplete(Result.failure(e))
                                }
                                return
                            }
                            fos.write(bytes)
                            digest.update(bytes)
                            receivedBytes += bytes.size
                            val pct = if (transfer.fileSize > 0) {
                                ((receivedBytes.toDouble() / transfer.fileSize) * 100.0).toInt().coerceIn(0, 100)
                            } else 100
                            emitState(
                                transfer.copy(
                                    status = P2PTransferStatus.TRANSFERRING,
                                    bytesTransferred = receivedBytes,
                                    progressPercentage = pct
                                )
                            )
                        }
                    })
                }

                override fun onSignalingChange(p0: PeerConnection.SignalingState?) {}
                override fun onIceConnectionChange(p0: PeerConnection.IceConnectionState?) {}
                override fun onIceConnectionReceivingChange(p0: Boolean) {}
                override fun onIceGatheringChange(p0: PeerConnection.IceGatheringState?) {}
                override fun onIceCandidatesRemoved(p0: Array<out IceCandidate>?) {}
                override fun onAddStream(p0: MediaStream?) {}
                override fun onRemoveStream(p0: MediaStream?) {}
                override fun onRenegotiationNeeded() {}
                override fun onAddTrack(p0: RtpReceiver?, p1: Array<out MediaStream>?) {}
            })

            val remoteOffer = SessionDescription(SessionDescription.Type.OFFER, offerSdp)
            val remoteSet = suspendCoroutine<Boolean> { cont ->
                peerConnection?.setRemoteDescription(object : SdpObserver {
                    override fun onSetSuccess() { cont.resume(true) }
                    override fun onSetFailure(p0: String?) { cont.resume(false) }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, remoteOffer) ?: cont.resume(false)
            }
            if (!remoteSet) return@withContext false

            remoteDescriptionSet = true
            pendingIceCandidates.forEach { peerConnection?.addIceCandidate(it) }
            pendingIceCandidates.clear()

            val answer = suspendCoroutine<SessionDescription?> { cont ->
                peerConnection?.createAnswer(object : SdpObserver {
                    override fun onCreateSuccess(sdp: SessionDescription?) { cont.resume(sdp) }
                    override fun onCreateFailure(p0: String?) { cont.resume(null) }
                    override fun onSetSuccess() {}
                    override fun onSetFailure(p0: String?) {}
                }, MediaConstraints()) ?: cont.resume(null)
            } ?: return@withContext false

            suspendCoroutine<Boolean> { cont ->
                peerConnection?.setLocalDescription(object : SdpObserver {
                    override fun onSetSuccess() { cont.resume(true) }
                    override fun onSetFailure(p0: String?) { cont.resume(false) }
                    override fun onCreateSuccess(p0: SessionDescription?) {}
                    override fun onCreateFailure(p0: String?) {}
                }, answer) ?: cont.resume(false)
            }

            signalSender?.invoke(JSONObject().apply {
                put("type", "p2p_answer")
                put("transferId", transfer.id)
                put("sdp", JSONObject().apply {
                    put("type", answer.type.canonicalForm())
                    put("sdp", answer.description)
                })
            })
            true
        } catch (_: Exception) {
            false
        }
    }

    fun addIceCandidate(sdpMid: String?, sdpMLineIndex: Int, candidateSdp: String) {
        val candidate = IceCandidate(sdpMid ?: "0", sdpMLineIndex, candidateSdp)
        if (remoteDescriptionSet && peerConnection != null) {
            peerConnection?.addIceCandidate(candidate)
        } else {
            pendingIceCandidates.add(candidate)
        }
    }

    /**
     * Kept for unit-test and single-device simulation compatibility.
     */
    suspend fun simulateChunkedStreaming(
        transfer: P2PTransfer,
        onProgress: (bytesSent: Long, percent: Int, speedBytesSec: Long) -> Unit
    ) {
        val totalBytes = transfer.fileSize
        if (totalBytes <= 0L) {
            emitState(
                transfer.copy(
                    status = P2PTransferStatus.COMPLETED,
                    bytesTransferred = 0L,
                    progressPercentage = 100,
                    speedBytesPerSec = 0L
                )
            )
            onProgress(0L, 100, 0L)
            return
        }

        emitState(transfer.copy(status = P2PTransferStatus.TRANSFERRING))
        isPaused = false
        isCancelled = false

        var sentBytes = 0L
        var lastTime = System.currentTimeMillis()
        var bytesSinceCheck = 0L

        while (sentBytes < totalBytes) {
            if (isCancelled) {
                emitState(_transferState.value?.copy(status = P2PTransferStatus.CANCELLED))
                return
            }

            while (isPaused) {
                delay(200)
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
            emitState(
                _transferState.value?.copy(
                    bytesTransferred = sentBytes,
                    progressPercentage = percentage,
                    speedBytesPerSec = speed
                )
            )

            delay(20)
        }

        emitState(
            _transferState.value?.copy(
                status = P2PTransferStatus.COMPLETED,
                bytesTransferred = totalBytes,
                progressPercentage = 100
            )
        )
    }

    fun pause() {
        isPaused = true
        emitState(_transferState.value?.copy(status = P2PTransferStatus.PENDING))
    }

    fun resume() {
        isPaused = false
        emitState(_transferState.value?.copy(status = P2PTransferStatus.TRANSFERRING))
    }

    fun cancel() {
        isCancelled = true
        emitState(_transferState.value?.copy(status = P2PTransferStatus.CANCELLED))
        close()
    }

    fun close() {
        try {
            dataChannel?.close()
            dataChannel = null
            peerConnection?.close()
            peerConnection = null
        } catch (_: Exception) {}
    }

    private fun emitState(transfer: P2PTransfer?) {
        _transferState.value = transfer
        if (transfer != null) {
            P2PTransferRegistry.updateTransfer(transfer)
        }
    }
}
