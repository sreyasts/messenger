package com.privatemessenger.app.telecom

import android.Manifest
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

class CallForegroundService : Service() {

    private var currentRoomName: String = "conversation"
    private var currentCallerName: String = "Friend"
    private var currentCallType: String = "audio"
    private var currentCallId: String = ""
    private var isMuted: Boolean = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        when (intent.action) {
            "ACTION_DECLINE_CALL" -> {
                val callId = intent.getStringExtra("CALL_ID") ?: currentCallId
                if (callId.isNotBlank()) {
                    CallStateBus.emit(CallStateBus.Event.DeclineCallRequested(callId))
                }
                CallNotificationManager.dismissIncomingCallNotification(this)
                stopSelf()
                return START_NOT_STICKY
            }
            "ACTION_END_CALL" -> {
                val callId = intent.getStringExtra("CALL_ID") ?: currentCallId
                CallStateBus.emit(CallStateBus.Event.EndCallRequested(callId.ifBlank { null }))
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
                CallNotificationManager.dismissCallNotification(this)
                stopSelf()
                return START_NOT_STICKY
            }
            "ACTION_TOGGLE_MUTE" -> {
                isMuted = !isMuted
                CallStateBus.emit(CallStateBus.Event.ToggleMuteRequested)
                startForegroundServiceWithNotification()
                return START_NOT_STICKY
            }
        }

        currentRoomName = intent.getStringExtra("ROOM_NAME") ?: "conversation"
        currentCallerName = intent.getStringExtra("CALLER_NAME") ?: "Friend"
        currentCallType = intent.getStringExtra("CALL_TYPE") ?: "audio"
        currentCallId = intent.getStringExtra("CALL_ID") ?: ""
        isMuted = intent.getBooleanExtra("IS_MUTED", false)

        startForegroundServiceWithNotification()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        CallNotificationManager.dismissCallNotification(this)
    }

    private fun startForegroundServiceWithNotification() {
        val notification = CallNotificationManager.buildActiveCallNotification(
            context = this,
            callerName = currentCallerName,
            roomName = currentRoomName,
            callType = currentCallType,
            callId = currentCallId,
            isMuted = isMuted
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            var fgsType = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                fgsType = fgsType or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            }
            if (currentCallType.equals("video", ignoreCase = true) &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
            ) {
                fgsType = fgsType or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            }
            try {
                startForeground(CallNotificationManager.NOTIFICATION_ID_ACTIVE_CALL, notification, fgsType)
            } catch (_: SecurityException) {
                startForeground(
                    CallNotificationManager.NOTIFICATION_ID_ACTIVE_CALL,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                )
            }
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                CallNotificationManager.NOTIFICATION_ID_ACTIVE_CALL,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
            )
        } else {
            startForeground(CallNotificationManager.NOTIFICATION_ID_ACTIVE_CALL, notification)
        }
    }
}
