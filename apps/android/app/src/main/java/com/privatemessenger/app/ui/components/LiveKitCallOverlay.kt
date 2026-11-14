package com.privatemessenger.app.ui.components

import androidx.compose.foundation.background
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatemessenger.app.data.model.Call
import com.privatemessenger.app.data.model.CallType

@Composable
fun LiveKitCallOverlay(
    call: Call,
    onEndCall: () -> Unit,
    onEnterPiP: () -> Unit
) {
    var isMuted by remember { mutableStateOf(false) }
    var isCameraOff by remember { mutableStateOf(call.callType == CallType.AUDIO) }
    var isSpeakerOn by remember { mutableStateOf(true) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween
        ) {
            // Top Bar with PiP button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 16.dp),
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

                Text(
                    text = if (call.callType == CallType.VIDEO) "LiveKit Video Call" else "LiveKit Voice Call",
                    color = Color.White,
                    style = MaterialTheme.typography.titleMedium
                )

                IconButton(onClick = { isSpeakerOn = !isSpeakerOn }) {
                    Icon(
                        imageVector = if (isSpeakerOn) Icons.Default.VolumeUp else Icons.Default.VolumeOff,
                        contentDescription = "Speaker Toggle",
                        tint = if (isSpeakerOn) Color(0xFF0084FF) else Color.White
                    )
                }
            }

            // Center: Participant Video or Avatar
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF121212)),
                contentAlignment = Alignment.Center
            ) {
                if (call.callType == CallType.VIDEO && !isCameraOff) {
                    // Video stream canvas
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            imageVector = Icons.Default.Videocam,
                            contentDescription = null,
                            tint = Color(0xFF0084FF),
                            modifier = Modifier.size(64.dp)
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Adaptive Bitrate Video (VP8/H.264)",
                            color = Color.White,
                            style = MaterialTheme.typography.titleMedium
                        )
                        Text(
                            text = "Opus Echo Cancellation & Noise Suppression Active",
                            color = Color(0xFFA0A0A0),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                } else {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            modifier = Modifier
                                .size(96.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF242424)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = call.callerName.take(1).uppercase().ifEmpty { "C" },
                                color = Color.White,
                                fontSize = 36.sp
                            )
                        }
                        Spacer(modifier = Modifier.height(16.dp))
                        Text(
                            text = call.callerName.ifEmpty { "Active Call" },
                            color = Color.White,
                            style = MaterialTheme.typography.titleLarge
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Connected • 00:45",
                            color = Color(0xFF10B981),
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                }
            }

            // Bottom Controls Bar
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 24.dp),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Mic Mute Toggle
                FloatingActionButton(
                    onClick = { isMuted = !isMuted },
                    containerColor = if (isMuted) Color(0xFFEF4444) else Color(0xFF242424),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(60.dp)
                ) {
                    Icon(
                        imageVector = if (isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = "Mute"
                    )
                }

                // Camera Toggle (if video call)
                if (call.callType == CallType.VIDEO) {
                    FloatingActionButton(
                        onClick = { isCameraOff = !isCameraOff },
                        containerColor = if (isCameraOff) Color(0xFFEF4444) else Color(0xFF242424),
                        contentColor = Color.White,
                        shape = CircleShape,
                        modifier = Modifier.size(60.dp)
                    ) {
                        Icon(
                            imageVector = if (isCameraOff) Icons.Default.VideocamOff else Icons.Default.Videocam,
                            contentDescription = "Camera"
                        )
                    }
                }

                // End Call Button
                FloatingActionButton(
                    onClick = onEndCall,
                    containerColor = Color(0xFFEF4444),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(60.dp)
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
