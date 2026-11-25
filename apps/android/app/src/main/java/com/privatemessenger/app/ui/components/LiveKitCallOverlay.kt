package com.privatemessenger.app.ui.components

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.privatemessenger.app.data.model.AudioRoute
import com.privatemessenger.app.data.model.Call
import com.privatemessenger.app.data.model.CallQuality
import com.privatemessenger.app.data.model.CallType
import com.privatemessenger.app.telecom.CallStateBus
import com.privatemessenger.app.telecom.LiveKitCallManager
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon

@Composable
fun LiveKitCallOverlay(
    call: Call,
    participantIdentity: String,
    participantName: String,
    accessToken: String? = null,
    isInPiPMode: Boolean = false,
    onEndCall: () -> Unit,
    onEnterPiP: () -> Unit
) {
    val context = LocalContext.current
    val callManager = remember(call.id) { LiveKitCallManager(context) }

    val isMuted by callManager.isMuted.collectAsState()
    val isCameraOff by callManager.isCameraOff.collectAsState()
    val audioRoute by callManager.audioRoute.collectAsState()
    val durationSeconds by callManager.durationSeconds.collectAsState()
    val callQuality by callManager.callQuality.collectAsState()
    val connectionLabel by callManager.connectionLabel.collectAsState()
    val localVideoTrack by callManager.localVideoTrack.collectAsState()
    val remoteVideoTrack by callManager.remoteVideoTrack.collectAsState()
    val remoteName by callManager.remoteParticipantName.collectAsState()

    var permissionsGranted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
                (call.callType != CallType.VIDEO || ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        val audioGranted = results[Manifest.permission.RECORD_AUDIO] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val cameraGranted = results[Manifest.permission.CAMERA] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        permissionsGranted = audioGranted && (call.callType != CallType.VIDEO || cameraGranted)
        callManager.onPermissionsUpdated(
            audioGranted = audioGranted,
            cameraGranted = cameraGranted,
            isVideo = call.callType == CallType.VIDEO
        )
    }

    LaunchedEffect(call.id) {
        val needed = buildList {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                add(Manifest.permission.RECORD_AUDIO)
            }
            if (call.callType == CallType.VIDEO &&
                ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
            ) {
                add(Manifest.permission.CAMERA)
            }
        }
        if (needed.isNotEmpty()) {
            permissionLauncher.launch(needed.toTypedArray())
        }
        callManager.startCall(
            call = call,
            participantIdentity = participantIdentity,
            participantName = participantName,
            accessToken = accessToken
        )
    }

    LaunchedEffect(callManager) {
        CallStateBus.events.collect { event ->
            when (event) {
                is CallStateBus.Event.ToggleMuteRequested -> callManager.toggleMute()
                is CallStateBus.Event.EndCallRequested -> {
                    callManager.endCall(call.id, accessToken)
                    onEndCall()
                }
                else -> Unit
            }
        }
    }

    DisposableEffect(call.id) {
        onDispose {
            callManager.endCall(call.id, accessToken)
        }
    }

    val formattedTime = remember(durationSeconds) {
        val mins = durationSeconds / 60
        val secs = durationSeconds % 60
        "${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}"
    }

    val displayPartnerName = remoteName?.takeIf { it.isNotBlank() } ?: call.callerName.ifBlank { "Active Call" }

    // Compact Picture-in-Picture layout when minimized
    if (isInPiPMode) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black),
            contentAlignment = Alignment.Center
        ) {
            val activePiPTrack = remoteVideoTrack ?: localVideoTrack
            if (activePiPTrack != null && callManager.activeRoom != null) {
                LiveKitVideoSurface(
                    room = callManager.activeRoom!!,
                    videoTrack = activePiPTrack,
                    mirror = activePiPTrack == localVideoTrack,
                    modifier = Modifier.fillMaxSize()
                )
            } else {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF242424)),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = displayPartnerName.take(1).uppercase(),
                            color = Color.White,
                            fontSize = 24.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = displayPartnerName,
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        maxLines = 1
                    )
                    Text(
                        text = formattedTime,
                        color = Color(0xFF10B981),
                        fontSize = 11.sp
                    )
                }
            }
        }
        return
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .systemBarsPadding(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top Bar with PiP, Quality Indicator, and Audio Route Selector
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onEnterPiP) {
                    Icon(
                        imageVector = Icons.Default.PictureInPictureAlt,
                        contentDescription = "Minimize to PiP",
                        tint = Color.White
                    )
                }

                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = if (call.callType == CallType.VIDEO) "LiveKit Video Call" else "LiveKit Voice Call",
                        color = Color.White,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold
                    )
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(
                                    when (callQuality) {
                                        CallQuality.EXCELLENT -> Color(0xFF10B981)
                                        CallQuality.GOOD -> Color(0xFFF59E0B)
                                        CallQuality.POOR -> Color(0xFFEF4444)
                                        CallQuality.CONNECTING -> Color(0xFF0084FF)
                                    }
                                )
                        )
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "$connectionLabel • $formattedTime",
                            color = Color(0xFFA0A0A0),
                            fontSize = 12.sp
                        )
                    }
                }

                IconButton(onClick = { callManager.cycleAudioRoute() }) {
                    val routeIcon = when (audioRoute) {
                        AudioRoute.SPEAKER -> Icons.Default.VolumeUp
                        AudioRoute.BLUETOOTH -> Icons.Default.BluetoothAudio
                        AudioRoute.WIRED_HEADSET -> Icons.Default.Headset
                        AudioRoute.EARPIECE -> Icons.Default.PhoneInTalk
                    }
                    Icon(
                        imageVector = routeIcon,
                        contentDescription = "Audio Route: ${audioRoute.name}",
                        tint = if (audioRoute == AudioRoute.SPEAKER || audioRoute == AudioRoute.BLUETOOTH) {
                            Color(0xFF0084FF)
                        } else {
                            Color.White
                        }
                    )
                }
            }

            // Center Video / Audio Canvas
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .padding(vertical = 16.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0xFF101010))
                    .border(1.dp, Color(0xFF242424), RoundedCornerShape(24.dp)),
                contentAlignment = Alignment.Center
            ) {
                val activeRoom = callManager.activeRoom
                if (remoteVideoTrack != null && activeRoom != null) {
                    LiveKitVideoSurface(
                        room = activeRoom,
                        videoTrack = remoteVideoTrack!!,
                        mirror = false,
                        modifier = Modifier.fillMaxSize()
                    )
                } else if (call.callType == CallType.VIDEO && !isCameraOff && localVideoTrack != null && activeRoom != null) {
                    LiveKitVideoSurface(
                        room = activeRoom,
                        videoTrack = localVideoTrack!!,
                        mirror = true,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        modifier = Modifier.padding(24.dp)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(104.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF242424)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = displayPartnerName.take(1).uppercase(),
                                color = Color.White,
                                fontSize = 40.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = displayPartnerName,
                            color = Color.White,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = if (call.callType == CallType.VIDEO && !isCameraOff) {
                                "Adaptive VP8/H.264 Simulcast • $formattedTime"
                            } else {
                                "Connected • $formattedTime"
                            },
                            color = Color(0xFF10B981),
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Audio: ${audioRoute.name.lowercase().replace('_', ' ').replaceFirstChar { it.uppercase() }} • AEC + NS Active",
                            color = Color(0xFFA0A0A0),
                            fontSize = 12.sp
                        )
                    }
                }

                // Local camera PiP preview when remote video is also active
                if (remoteVideoTrack != null && localVideoTrack != null && activeRoom != null && !isCameraOff) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.TopEnd)
                            .padding(12.dp)
                            .size(width = 104.dp, height = 148.dp)
                            .clip(RoundedCornerShape(14.dp))
                            .border(1.5.dp, Color.White.copy(alpha = 0.4f), RoundedCornerShape(14.dp))
                    ) {
                        LiveKitVideoSurface(
                            room = activeRoom,
                            videoTrack = localVideoTrack!!,
                            mirror = true,
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                }
            }

            // Bottom Controls Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 12.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                FloatingActionButton(
                    onClick = { callManager.toggleMute() },
                    containerColor = if (isMuted) Color(0xFFEF4444) else Color(0xFF242424),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(58.dp)
                ) {
                    Icon(
                        imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = if (isMuted) "Unmute" else "Mute"
                    )
                }

                if (call.callType == CallType.VIDEO) {
                    FloatingActionButton(
                        onClick = { callManager.toggleCamera() },
                        containerColor = if (isCameraOff) Color(0xFFEF4444) else Color(0xFF242424),
                        contentColor = Color.White,
                        shape = CircleShape,
                        modifier = Modifier.size(58.dp)
                    ) {
                        Icon(
                            imageVector = if (isCameraOff) Icons.Default.VideocamOff else Icons.Default.Videocam,
                            contentDescription = "Camera Toggle"
                        )
                    }

                    FloatingActionButton(
                        onClick = { callManager.switchCamera() },
                        containerColor = Color(0xFF242424),
                        contentColor = Color.White,
                        shape = CircleShape,
                        modifier = Modifier.size(58.dp)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Cameraswitch,
                            contentDescription = "Switch Camera"
                        )
                    }
                }

                FloatingActionButton(
                    onClick = {
                        callManager.endCall(call.id, accessToken)
                        onEndCall()
                    },
                    containerColor = Color(0xFFEF4444),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(62.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.CallEnd,
                        contentDescription = "End Call"
                    )
                }
            }
        }
    }
}

@Composable
private fun LiveKitVideoSurface(
    room: Room,
    videoTrack: VideoTrack,
    mirror: Boolean,
    modifier: Modifier = Modifier
) {
    var rendererRef by remember { mutableStateOf<TextureViewRenderer?>(null) }

    DisposableEffect(videoTrack, rendererRef) {
        val renderer = rendererRef
        if (renderer != null) {
            videoTrack.addRenderer(renderer)
        }
        onDispose {
            if (renderer != null) {
                try {
                    videoTrack.removeRenderer(renderer)
                } catch (_: Exception) {}
            }
        }
    }

    AndroidView(
        factory = { ctx ->
            TextureViewRenderer(ctx).apply {
                room.initVideoRenderer(this)
                setScalingType(RendererCommon.ScalingType.SCALE_ASPECT_FILL)
                setMirror(mirror)
                rendererRef = this
            }
        },
        update = { view ->
            view.setMirror(mirror)
        },
        onRelease = { view ->
            try {
                videoTrack.removeRenderer(view)
                view.release()
            } catch (_: Exception) {}
        },
        modifier = modifier
    )
}
