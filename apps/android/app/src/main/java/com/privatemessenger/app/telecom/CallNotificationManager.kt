package com.privatemessenger.app.telecom

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import com.privatemessenger.app.MainActivity
import com.privatemessenger.app.data.model.Call

object CallNotificationManager {
    const val CHANNEL_ID_CALLS = "calls_channel"
    const val CHANNEL_ID_ONGOING_CALLS = "ongoing_calls_channel"
    const val NOTIFICATION_ID_INCOMING_CALL = 1001
    const val NOTIFICATION_ID_ACTIVE_CALL = 1002

    fun createNotificationChannels(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            val incomingChannel = NotificationChannel(
                CHANNEL_ID_CALLS,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "High priority notifications for incoming audio and video calls"
                setSound(null, null)
                enableVibration(true)
            }
            notificationManager.createNotificationChannel(incomingChannel)

            val ongoingChannel = NotificationChannel(
                CHANNEL_ID_ONGOING_CALLS,
                "Active Calls",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Ongoing voice and video call controls"
                setSound(null, null)
                enableVibration(false)
            }
            notificationManager.createNotificationChannel(ongoingChannel)
        }
    }

    fun buildActiveCallNotification(
        context: Context,
        callerName: String,
        roomName: String,
        callType: String,
        callId: String,
        isMuted: Boolean = false
    ): Notification {
        createNotificationChannels(context)

        val returnIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val returnPendingIntent = PendingIntent.getActivity(
            context,
            10,
            returnIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val endCallIntent = Intent(context, CallForegroundService::class.java).apply {
            action = "ACTION_END_CALL"
            putExtra("CALL_ID", callId)
        }
        val endCallPendingIntent = PendingIntent.getService(
            context,
            11,
            endCallIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val muteIntent = Intent(context, CallForegroundService::class.java).apply {
            action = "ACTION_TOGGLE_MUTE"
            putExtra("CALL_ID", callId)
        }
        val mutePendingIntent = PendingIntent.getService(
            context,
            12,
            muteIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val person = Person.Builder()
            .setName(callerName.ifBlank { "Active Call" })
            .setImportant(true)
            .build()

        val builder = NotificationCompat.Builder(context, CHANNEL_ID_ONGOING_CALLS)
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setContentTitle("${callerName.ifBlank { "Friend" }} • ${callType.replaceFirstChar { it.uppercase() }} Call")
            .setContentText("HD low-latency audio active ($roomName)")
            .setContentIntent(returnPendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setUsesChronometer(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setStyle(NotificationCompat.CallStyle.forOngoingCall(person, endCallPendingIntent))
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                if (isMuted) "Unmute" else "Mute",
                mutePendingIntent
            )
        } else {
            builder.addAction(
                android.R.drawable.ic_btn_speak_now,
                if (isMuted) "Unmute" else "Mute",
                mutePendingIntent
            )
            builder.addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "End Call",
                endCallPendingIntent
            )
        }

        return builder.build()
    }

    fun showIncomingCallNotification(context: Context, call: Call) {
        createNotificationChannels(context)

        val callerPerson = Person.Builder()
            .setName(call.callerName.ifEmpty { "Friend" })
            .setImportant(true)
            .build()

        val fullScreenIntent = Intent(context, IncomingCallActivity::class.java).apply {
            putExtra("CALL_ID", call.id)
            putExtra("CONVERSATION_ID", call.conversationId)
            putExtra("CALLER_NAME", call.callerName)
            putExtra("CALL_TYPE", call.callType.key)
            putExtra("ROOM_NAME", call.roomName)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION
        }
        val fullScreenPendingIntent = PendingIntent.getActivity(
            context,
            20,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val answerIntent = Intent(context, MainActivity::class.java).apply {
            action = "ACTION_ANSWER_CALL"
            putExtra("CALL_ID", call.id)
            putExtra("CONVERSATION_ID", call.conversationId)
            putExtra("CALLER_NAME", call.callerName)
            putExtra("ROOM_NAME", call.roomName)
            putExtra("CALL_TYPE", call.callType.key)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val answerPendingIntent = PendingIntent.getActivity(
            context,
            21,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val declineIntent = Intent(context, CallForegroundService::class.java).apply {
            action = "ACTION_DECLINE_CALL"
            putExtra("CALL_ID", call.id)
        }
        val declinePendingIntent = PendingIntent.getService(
            context,
            22,
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
            .setContentText("${call.callerName.ifBlank { "Friend" }} is calling you...")
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
