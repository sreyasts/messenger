package com.privatemessenger.app.telecom

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatemessenger.app.MainActivity
import com.privatemessenger.app.ui.theme.OledBackground
import com.privatemessenger.app.ui.theme.PrivateMessengerTheme
import com.privatemessenger.app.ui.theme.TextPrimary
import com.privatemessenger.app.ui.theme.TextSecondary

class IncomingCallActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Wake screen and show over lock screen
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
            val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
            keyguardManager.requestDismissKeyguard(this, null)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or
                WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
            )
        }

        val callerName = intent.getStringExtra("CALLER_NAME") ?: "Friend"
        val callType = intent.getStringExtra("CALL_TYPE") ?: "audio"
        val roomName = intent.getStringExtra("ROOM_NAME") ?: ""
        val callId = intent.getStringExtra("CALL_ID") ?: ""

        setContent {
            PrivateMessengerTheme {
                IncomingCallContent(
                    callerName = callerName,
                    callType = callType,
                    onAnswer = {
                        val mainIntent = Intent(this, MainActivity::class.java).apply {
                            action = "ACTION_ANSWER_CALL"
                            putExtra("CALL_ID", callId)
                            putExtra("ROOM_NAME", roomName)
                            putExtra("CALL_TYPE", callType)
                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                        }
                        startActivity(mainIntent)
                        CallNotificationManager.dismissCallNotification(this)
                        finish()
                    },
                    onDecline = {
                        CallNotificationManager.dismissCallNotification(this)
                        finish()
                    }
                )
            }
        }
    }
}

@Composable
fun IncomingCallContent(
    callerName: String,
    callType: String,
    onAnswer: () -> Unit,
    onDecline: () -> Unit
) {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(OledBackground),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(32.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(110.dp)
                    .clip(CircleShape)
                    .background(Color(0xFF242424)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = callerName.take(1).uppercase(),
                    color = Color.White,
                    fontSize = 44.sp
                )
            }

            Spacer(modifier = Modifier.height(24.dp))

            Text(
                text = callerName,
                style = MaterialTheme.typography.headlineMedium,
                color = TextPrimary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Incoming ${callType.replaceFirstChar { it.uppercase() }} Call...",
                style = MaterialTheme.typography.bodyLarge,
                color = TextSecondary
            )

            Spacer(modifier = Modifier.height(96.dp))

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly,
                verticalAlignment = Alignment.CenterVertically
            ) {
                // Decline Button
                FloatingActionButton(
                    onClick = onDecline,
                    containerColor = Color(0xFFEF4444),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(72.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.CallEnd,
                        contentDescription = "Decline Call",
                        modifier = Modifier.size(32.dp)
                    )
                }

                // Answer Button
                FloatingActionButton(
                    onClick = onAnswer,
                    containerColor = Color(0xFF10B981),
                    contentColor = Color.White,
                    shape = CircleShape,
                    modifier = Modifier.size(72.dp)
                ) {
                    Icon(
                        imageVector = if (callType == "video") Icons.Default.Videocam else Icons.Default.Call,
                        contentDescription = "Answer Call",
                        modifier = Modifier.size(32.dp)
                    )
                }
            }
        }
    }
}
