package com.privatemessenger.app.telecom

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.privatemessenger.app.MainActivity

class CallForegroundService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null) {
            stopSelf()
            return START_NOT_STICKY
        }

        val action = intent.action
        if (action == "ACTION_DECLINE_CALL") {
            CallNotificationManager.dismissCallNotification(this)
            stopSelf()
            return START_NOT_STICKY
        } else if (action == "ACTION_END_CALL") {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            CallNotificationManager.dismissCallNotification(this)
            stopSelf()
            return START_NOT_STICKY
        }

        val roomName = intent.getStringExtra("ROOM_NAME") ?: "Call"
        val callType = intent.getStringExtra("CALL_TYPE") ?: "audio"

        startForegroundServiceWithNotification(roomName, callType)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        CallNotificationManager.dismissCallNotification(this)
    }

    private fun startForegroundServiceWithNotification(roomName: String, callType: String) {
        CallNotificationManager.createNotificationChannels(this)

        val returnIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val returnPendingIntent = PendingIntent.getActivity(
            this,
            0,
            returnIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val endCallIntent = Intent(this, CallForegroundService::class.java).apply {
            action = "ACTION_END_CALL"
        }
        val endCallPendingIntent = PendingIntent.getService(
            this,
            1,
            endCallIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification: Notification = NotificationCompat.Builder(this, CallNotificationManager.CHANNEL_ID_CALLS)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("Active ${callType.replaceFirstChar { it.uppercase() }} Call")
            .setContentText("Connected to $roomName")
            .setContentIntent(returnPendingIntent)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "End Call", endCallPendingIntent)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
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
