package com.privatemessenger.app.telecom

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.privatemessenger.app.data.model.AudioRoute
import com.privatemessenger.app.data.model.Call
import com.privatemessenger.app.data.model.CallQuality
import com.privatemessenger.app.data.model.CallStatus
import com.privatemessenger.app.data.model.CallType
import com.privatemessenger.app.data.remote.SupabaseSyncClient
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.RoomOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.AudioTrackPublishDefaults
import io.livekit.android.room.participant.ConnectionQuality
import io.livekit.android.room.participant.VideoTrackPublishDefaults
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.LocalVideoTrackOptions
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoPreset169
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import livekit.org.webrtc.PeerConnection

/**
 * Shared call event bus synchronizing CallForegroundService notification actions,
 * IncomingCallActivity answer/decline, and MainActivity UI overlay state.
 */
object CallStateBus {
    sealed class Event {
        data class EndCallRequested(val callId: String? = null) : Event()
        data class AnswerCallRequested(val call: Call) : Event()
        data class DeclineCallRequested(val callId: String) : Event()
        object ToggleMuteRequested : Event()
    }

    private val _events = MutableSharedFlow<Event>(extraBufferCapacity = 16)
    val events: SharedFlow<Event> = _events.asSharedFlow()

    fun emit(event: Event) {
        _events.tryEmit(event)
    }
}

/**
 * Full-featured LiveKit SFU & hardware audio call manager matching the Web LiveKitManager
 * and GEMINI.md contracts:
 * - Canonical room name: `conversation-${conversationId}`
 * - AdaptiveStream + Dynacast + VP8 720p simulcast + Opus 48kHz (DTX off, RED on, AEC/NS/AGC on)
 * - Hardware CallAudioManager routing (Speaker, Earpiece, Bluetooth, Wired)
 * - Graceful local-preview fallback when LiveKit/Supabase keys are not configured
 */
class LiveKitCallManager(private val context: Context) {

    private val appContext = context.applicationContext
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioManager = CallAudioManager(appContext)

    private var room: Room? = null
    private var eventsJob: Job? = null
    private var timerJob: Job? = null

    private val _isConnectedToSfu = MutableStateFlow(false)
    val isConnectedToSfu: StateFlow<Boolean> = _isConnectedToSfu.asStateFlow()

    private val _connectionLabel = MutableStateFlow("Connecting...")
    val connectionLabel: StateFlow<String> = _connectionLabel.asStateFlow()

    private val _callQuality = MutableStateFlow(CallQuality.CONNECTING)
    val callQuality: StateFlow<CallQuality> = _callQuality.asStateFlow()

    private val _durationSeconds = MutableStateFlow(0)
    val durationSeconds: StateFlow<Int> = _durationSeconds.asStateFlow()

    private val _isMuted = MutableStateFlow(false)
    val isMuted: StateFlow<Boolean> = _isMuted.asStateFlow()

    private val _isCameraOff = MutableStateFlow(false)
    val isCameraOff: StateFlow<Boolean> = _isCameraOff.asStateFlow()

    private val _isFrontCamera = MutableStateFlow(true)
    val isFrontCamera: StateFlow<Boolean> = _isFrontCamera.asStateFlow()

    private val _audioRoute = MutableStateFlow(AudioRoute.EARPIECE)
    val audioRoute: StateFlow<AudioRoute> = _audioRoute.asStateFlow()

    private val _availableAudioRoutes = MutableStateFlow<List<AudioRoute>>(emptyList())
    val availableAudioRoutes: StateFlow<List<AudioRoute>> = _availableAudioRoutes.asStateFlow()

    private val _localVideoTrack = MutableStateFlow<VideoTrack?>(null)
    val localVideoTrack: StateFlow<VideoTrack?> = _localVideoTrack.asStateFlow()

    private val _remoteVideoTrack = MutableStateFlow<VideoTrack?>(null)
    val remoteVideoTrack: StateFlow<VideoTrack?> = _remoteVideoTrack.asStateFlow()

    private val _remoteParticipantName = MutableStateFlow<String?>(null)
    val remoteParticipantName: StateFlow<String?> = _remoteParticipantName.asStateFlow()

    val activeRoom: Room?
        get() = room

    fun hasAudioPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun hasCameraPermission(): Boolean =
        ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED

    suspend fun startCall(
        call: Call,
        participantIdentity: String,
        participantName: String,
        accessToken: String?
    ) {
        val isVideo = call.callType == CallType.VIDEO
        _isCameraOff.value = !isVideo
        _isMuted.value = false
        _durationSeconds.value = 0
        _callQuality.value = CallQuality.CONNECTING
        _connectionLabel.value = "Setting up HD audio..."

        // Start hardware-accelerated MODE_IN_COMMUNICATION audio routing immediately
        _availableAudioRoutes.value = audioManager.getAvailableRoutes()
        _audioRoute.value = audioManager.startCallAudio(preferSpeaker = isVideo)

        // Start live call duration clock
        timerJob?.cancel()
        timerJob = scope.launch {
            while (true) {
                delay(1000L)
                _durationSeconds.value += 1
            }
        }

        val canonicalRoomName = call.roomName.ifBlank { "conversation-${call.conversationId}" }

        // Sync outgoing call record to Supabase if live session is active
        scope.launch(Dispatchers.IO) {
            SupabaseSyncClient.upsertCallRecord(
                accessToken = accessToken,
                callId = call.id,
                conversationId = call.conversationId,
                callerId = participantIdentity,
                callType = call.callType,
                roomName = canonicalRoomName,
                status = CallStatus.ONGOING
            )
        }

        // Fetch LiveKit JWT from Supabase Edge Function
        val tokenResult = SupabaseSyncClient.fetchLiveKitToken(
            accessToken = accessToken,
            roomName = canonicalRoomName,
            participantIdentity = participantIdentity,
            participantName = participantName
        )

        tokenResult.fold(
            onSuccess = { lkToken ->
                connectToLiveKitRoom(
                    wsUrl = lkToken.livekitUrl,
                    token = lkToken.token,
                    enableVideo = isVideo
                )
            },
            onFailure = {
                // Clean offline / local preview mode when keys are unset — zero crashes
                _isConnectedToSfu.value = false
                _callQuality.value = CallQuality.EXCELLENT
                _connectionLabel.value = buildLocalAudioStatusLabel()
            }
        )
    }

    private suspend fun connectToLiveKitRoom(
        wsUrl: String,
        token: String,
        enableVideo: Boolean
    ) {
        try {
            val roomOptions = RoomOptions(
                adaptiveStream = true,
                dynacast = true,
                audioTrackCaptureDefaults = LocalAudioTrackOptions(
                    noiseSuppression = true,
                    echoCancellation = true,
                    autoGainControl = true,
                    highPassFilter = true,
                    typingNoiseDetection = true
                ),
                videoTrackCaptureDefaults = LocalVideoTrackOptions(
                    position = CameraPosition.FRONT,
                    captureParams = VideoPreset169.H720.capture
                ),
                audioTrackPublishDefaults = AudioTrackPublishDefaults(
                    audioBitrate = 96_000,
                    dtx = false,
                    red = true
                ),
                videoTrackPublishDefaults = VideoTrackPublishDefaults(
                    videoEncoding = VideoPreset169.H720.encoding,
                    simulcast = true,
                    videoCodec = "vp8"
                )
            )

            val createdRoom = LiveKit.create(appContext, roomOptions)
            room = createdRoom
            observeRoomEvents(createdRoom)

            val connectOptions = ConnectOptions(
                autoSubscribe = true,
                iceServers = listOf(
                    PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
                    PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer()
                )
            )

            createdRoom.connect(url = wsUrl, token = token, options = connectOptions)
            _isConnectedToSfu.value = true
            _callQuality.value = CallQuality.EXCELLENT
            _connectionLabel.value = "LiveKit HD • Opus 48kHz"

            if (hasAudioPermission()) {
                try {
                    createdRoom.localParticipant.setMicrophoneEnabled(true)
                } catch (_: Exception) {
                    _isMuted.value = true
                }
            } else {
                _isMuted.value = true
            }

            if (enableVideo && hasCameraPermission()) {
                try {
                    createdRoom.localParticipant.setCameraEnabled(true)
                    refreshLocalVideoTrack(createdRoom)
                } catch (_: Exception) {
                    _isCameraOff.value = true
                }
            }
        } catch (e: Exception) {
            _isConnectedToSfu.value = false
            _callQuality.value = CallQuality.GOOD
            _connectionLabel.value = "Audio Ready (${e.localizedMessage?.take(24) ?: "Local"})"
        }
    }

    private fun observeRoomEvents(lkRoom: Room) {
        eventsJob?.cancel()
        eventsJob = scope.launch {
            lkRoom.events.collect { event ->
                when (event) {
                    is RoomEvent.TrackSubscribed -> {
                        val track = event.track
                        if (track is VideoTrack) {
                            _remoteVideoTrack.value = track
                            _remoteParticipantName.value = event.participant.name ?: event.participant.identity?.value
                        }
                    }
                    is RoomEvent.TrackUnsubscribed -> {
                        val track = event.track
                        if (track is VideoTrack && _remoteVideoTrack.value == track) {
                            _remoteVideoTrack.value = null
                        }
                    }
                    is RoomEvent.TrackPublished -> {
                        refreshLocalVideoTrack(lkRoom)
                    }
                    is RoomEvent.ConnectionQualityChanged -> {
                        if (event.participant == lkRoom.localParticipant) {
                            _callQuality.value = when (event.quality) {
                                ConnectionQuality.EXCELLENT -> CallQuality.EXCELLENT
                                ConnectionQuality.GOOD -> CallQuality.GOOD
                                ConnectionQuality.POOR, ConnectionQuality.LOST -> CallQuality.POOR
                                else -> CallQuality.GOOD
                            }
                        }
                    }
                    is RoomEvent.ParticipantDisconnected -> {
                        if (lkRoom.remoteParticipants.isEmpty()) {
                            _remoteVideoTrack.value = null
                            _remoteParticipantName.value = null
                        }
                    }
                    is RoomEvent.Disconnected -> {
                        _isConnectedToSfu.value = false
                        _remoteVideoTrack.value = null
                        _localVideoTrack.value = null
                    }
                    else -> Unit
                }
            }
        }
    }

    private fun refreshLocalVideoTrack(lkRoom: Room) {
        val pub = lkRoom.localParticipant.getTrackPublication(Track.Source.CAMERA)
        _localVideoTrack.value = pub?.track as? VideoTrack
    }

    private fun buildLocalAudioStatusLabel(): String {
        val features = buildList {
            add("Opus HD")
            if (audioManager.isHardwareAecSupported) add("AEC")
            if (audioManager.isHardwareNsSupported) add("NS")
        }
        return features.joinToString(" • ")
    }

    fun onPermissionsUpdated(
        audioGranted: Boolean,
        cameraGranted: Boolean,
        isVideo: Boolean
    ) {
        scope.launch {
            val lkRoom = room ?: return@launch
            if (audioGranted && _isMuted.value) {
                try {
                    lkRoom.localParticipant.setMicrophoneEnabled(true)
                    _isMuted.value = false
                } catch (_: Exception) {}
            }
            if (isVideo && cameraGranted && !_isCameraOff.value) {
                try {
                    lkRoom.localParticipant.setCameraEnabled(true)
                    refreshLocalVideoTrack(lkRoom)
                } catch (_: Exception) {
                    _isCameraOff.value = true
                }
            }
        }
    }

    fun toggleMute() {
        val nextMuted = !_isMuted.value
        _isMuted.value = nextMuted
        scope.launch {
            try {
                room?.localParticipant?.setMicrophoneEnabled(!nextMuted)
            } catch (_: Exception) {}
        }
    }

    fun toggleCamera() {
        val nextOff = !_isCameraOff.value
        _isCameraOff.value = nextOff
        scope.launch {
            try {
                val lkRoom = room
                if (lkRoom != null && hasCameraPermission()) {
                    lkRoom.localParticipant.setCameraEnabled(!nextOff)
                    refreshLocalVideoTrack(lkRoom)
                }
            } catch (_: Exception) {}
        }
    }

    fun switchCamera() {
        val nextFront = !_isFrontCamera.value
        _isFrontCamera.value = nextFront
        scope.launch {
            try {
                val track = _localVideoTrack.value as? LocalVideoTrack
                val newPos = if (nextFront) CameraPosition.FRONT else CameraPosition.BACK
                track?.restartTrack(
                    LocalVideoTrackOptions(
                        position = newPos,
                        captureParams = VideoPreset169.H720.capture
                    )
                )
            } catch (_: Exception) {}
        }
    }

    fun cycleAudioRoute() {
        val routes = audioManager.getAvailableRoutes().also { _availableAudioRoutes.value = it }
        if (routes.isEmpty()) return
        val idx = routes.indexOf(_audioRoute.value)
        val nextRoute = routes[(idx + 1) % routes.size]
        selectAudioRoute(nextRoute)
    }

    fun selectAudioRoute(route: AudioRoute) {
        _audioRoute.value = route
        audioManager.setAudioRoute(route)
    }

    fun endCall(callId: String? = null, accessToken: String? = null) {
        timerJob?.cancel()
        eventsJob?.cancel()
        try {
            room?.disconnect()
            room?.release()
        } catch (_: Exception) {}
        room = null
        _localVideoTrack.value = null
        _remoteVideoTrack.value = null
        _isConnectedToSfu.value = false
        audioManager.release()

        if (!callId.isNullOrBlank()) {
            scope.launch(Dispatchers.IO) {
                SupabaseSyncClient.updateCallStatus(accessToken, callId, CallStatus.ENDED)
            }
        }
    }
}
