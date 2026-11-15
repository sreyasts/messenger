package com.privatemessenger.app.telecom

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.privatemessenger.app.MainActivity
import com.privatemessenger.app.data.model.Call

object CallNotificationManager {
    const val CHANNEL_ID_CALLS = "calls_channel"
    const val NOTIFICATION_ID_CALL = 1001
    const val NOTIFICATION_ID_INCOMING_CALL = 1001
    const val NOTIFICATION_ID_ACTIVE_CALL = 1002

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val name = "Voice and Video Calls"
            val descriptionText = "High priority notifications for incoming audio and video calls"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(CHANNEL_ID_CALLS, name, importance).apply {
                description = descriptionText
                setSound(null, null) // In a real app custom ringtone can be specified
                enableVibration(true)
            }
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showIncomingCallNotification(context: Context, call: Call) {
        createNotificationChannels(context)

        val callerPerson = Person.Builder()
            .setName(call.callerName.ifEmpty { "Friend" })
            .setImportant(true)
            .build()

        // Full screen lock-screen intent
        val fullScreenIntent = Intent(context, IncomingCallActivity::class.java).apply {
            putExtra("CALL_ID", call.id)
            putExtra("CALLER_NAME", call.callerName)
            putExtra("CALL_TYPE", call.callType.key)
            putExtra("ROOM_NAME", call.roomName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            context,
            0,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Answer action
        val answerIntent = Intent(context, MainActivity::class.java).apply {
            action = "ACTION_ANSWER_CALL"
            putExtra("CALL_ID", call.id)
            putExtra("ROOM_NAME", call.roomName)
            putExtra("CALL_TYPE", call.callType.key)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val answerPendingIntent = PendingIntent.getActivity(
            context,
            1,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Decline action
        val declineIntent = Intent(context, CallForegroundService::class.java).apply {
            action = "ACTION_DECLINE_CALL"
            putExtra("CALL_ID", call.id)
        }
        val declinePendingIntent = PendingIntent.getService(
            context,
            2,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val callStyle = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            NotificationCompat.CallStyle.forIncomingCall(
                callerPerson,
                declinePendingIntent,
                answerPendingIntent
            )
        } else {
            null
        }

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_CALLS)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("Incoming ${call.callType.key.replaceFirstChar { it.uppercase() }} Call")
            .setContentText("${call.callerName} is calling you...")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(false)
            .setOngoing(true)
            .setFullScreenIntent(fullScreenPendingIntent, true)

        if (callStyle != null) {
            builder.setStyle(callStyle)
        } else {
            builder.addAction(android.R.drawable.ic_menu_call, "Answer", answerPendingIntent)
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declinePendingIntent)
        }

        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(NOTIFICATION_ID_INCOMING_CALL, builder.build())
    }

    fun dismissIncomingCallNotification(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(NOTIFICATION_ID_INCOMING_CALL)
    }

    fun dismissCallNotification(context: Context) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.cancel(NOTIFICATION_ID_INCOMING_CALL)
        notificationManager.cancel(NOTIFICATION_ID_ACTIVE_CALL)
    }
}
