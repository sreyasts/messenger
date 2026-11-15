package com.privatemessenger.app.data.storage

import android.content.Context
import android.content.SharedPreferences
import com.privatemessenger.app.data.model.MediaType
import com.privatemessenger.app.data.model.Message
import com.privatemessenger.app.data.model.Reaction
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Durable persistence for chat messages segregated by conversation ID.
 * Ensures that sent messages, received messages, replies, reactions, and
 * View-Once states are permanently preserved and re-loaded across chat
 * closures, navigation, and application restarts.
 */
class MessageStorage(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS_NAME = "messenger_chat_messages"
        private const val KEY_PREFIX_CONV = "conv_msgs_"
    }

    /**
     * Loads messages for a given [conversationId], reconciling View-Once statuses with [viewOnceStorage].
     * If a view-once message was viewed, its viewedAt is permanently locked to "Opened" and content cleared.
     */
    @Synchronized
    fun getMessages(conversationId: String, viewOnceStorage: ViewOnceStorage): List<Message> {
        val jsonString = prefs.getString(KEY_PREFIX_CONV + conversationId, null) ?: return emptyList()
        val result = mutableListOf<Message>()
        try {
            val array = JSONArray(jsonString)
            for (i in 0 until array.length()) {
                val obj = array.getJSONObject(i)
                val msg = jsonToMessage(obj)
                val isViewed = (msg.isViewOnce && (viewOnceStorage.isViewed(msg.id) || msg.viewedAt != null))
                val sanitized = if (isViewed) {
                    msg.copy(viewedAt = "Opened", content = "")
                } else {
                    msg
                }
                result.add(sanitized)
            }
        } catch (_: Exception) {}
        return result
    }

    /**
     * Saves or updates a message in durable storage.
     */
    @Synchronized
    fun saveMessage(message: Message, viewOnceStorage: ViewOnceStorage) {
        val current = getMessages(message.conversationId, viewOnceStorage).toMutableList()
        val idx = current.indexOfFirst { it.id == message.id }
        if (idx != -1) {
            current[idx] = message
        } else {
            current.add(message)
        }
        writeConversationMessages(message.conversationId, current)
    }

    /**
     * Permanently marks a view-once message as viewed in message storage.
     */
    @Synchronized
    fun markViewOnceOpened(conversationId: String, messageId: String, viewOnceStorage: ViewOnceStorage) {
        viewOnceStorage.markAsViewed(messageId)
        val current = getMessages(conversationId, viewOnceStorage).toMutableList()
        val idx = current.indexOfFirst { it.id == messageId }
        if (idx != -1) {
            val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
            current[idx] = current[idx].copy(viewedAt = time, content = "")
            writeConversationMessages(conversationId, current)
        }
    }

    /**
     * Seeds initial conversation messages if storage for [conversationId] is currently empty.
     */
    @Synchronized
    fun seedIfEmpty(conversationId: String, initial: List<Message>, viewOnceStorage: ViewOnceStorage) {
        val existing = prefs.getString(KEY_PREFIX_CONV + conversationId, null)
        if (existing.isNullOrBlank()) {
            val reconciled = initial.map { msg ->
                val isViewed = (msg.isViewOnce && (viewOnceStorage.isViewed(msg.id) || msg.viewedAt != null))
                if (isViewed) msg.copy(viewedAt = "Opened", content = "") else msg
            }
            writeConversationMessages(conversationId, reconciled)
        }
    }

    private fun writeConversationMessages(conversationId: String, list: List<Message>) {
        try {
            val array = JSONArray()
            for (msg in list) {
                array.put(messageToJson(msg))
            }
            prefs.edit().putString(KEY_PREFIX_CONV + conversationId, array.toString()).apply()
        } catch (_: Exception) {}
    }

    private fun messageToJson(m: Message): JSONObject {
        val obj = JSONObject()
        obj.put("id", m.id)
        obj.put("conversationId", m.conversationId)
        obj.put("senderId", m.senderId)
        obj.put("content", m.content)
        obj.put("mediaUrl", m.mediaUrl)
        obj.put("mediaType", m.mediaType.name)
        obj.put("fileName", m.fileName)
        obj.put("fileSize", m.fileSize)
        obj.put("isViewOnce", m.isViewOnce)
        obj.put("viewedAt", m.viewedAt ?: JSONObject.NULL)
        obj.put("replyToId", m.replyToId ?: JSONObject.NULL)
        obj.put("replyToContent", m.replyToContent ?: JSONObject.NULL)
        obj.put("replyToSenderName", m.replyToSenderName ?: JSONObject.NULL)
        obj.put("deletedForEveryone", m.deletedForEveryone)
        obj.put("createdAt", m.createdAt)
        obj.put("senderName", m.senderName)

        val reactionsArray = JSONArray()
        for (r in m.reactions) {
            val rObj = JSONObject()
            rObj.put("id", r.id)
            rObj.put("messageId", r.messageId)
            rObj.put("userId", r.userId)
            rObj.put("emoji", r.emoji)
            rObj.put("createdAt", r.createdAt)
            reactionsArray.put(rObj)
        }
        obj.put("reactions", reactionsArray)
        return obj
    }

    private fun jsonToMessage(obj: JSONObject): Message {
        val reactionsList = mutableListOf<Reaction>()
        val reactionsArray = obj.optJSONArray("reactions")
        if (reactionsArray != null) {
            for (i in 0 until reactionsArray.length()) {
                val rObj = reactionsArray.getJSONObject(i)
                reactionsList.add(
                    Reaction(
                        id = rObj.optString("id"),
                        messageId = rObj.optString("messageId"),
                        userId = rObj.optString("userId"),
                        emoji = rObj.optString("emoji"),
                        createdAt = rObj.optString("createdAt")
                    )
                )
            }
        }

        val mediaTypeString = obj.optString("mediaType", "TEXT")
        val mediaType = try {
            MediaType.valueOf(mediaTypeString)
        } catch (_: Exception) {
            MediaType.TEXT
        }

        return Message(
            id = obj.optString("id"),
            conversationId = obj.optString("conversationId"),
            senderId = obj.optString("senderId"),
            content = obj.optString("content"),
            mediaUrl = obj.optString("mediaUrl"),
            mediaType = mediaType,
            fileName = obj.optString("fileName"),
            fileSize = obj.optLong("fileSize", 0L),
            isViewOnce = obj.optBoolean("isViewOnce", false),
            viewedAt = if (obj.isNull("viewedAt")) null else obj.optString("viewedAt"),
            replyToId = if (obj.isNull("replyToId")) null else obj.optString("replyToId"),
            replyToContent = if (obj.isNull("replyToContent")) null else obj.optString("replyToContent"),
            replyToSenderName = if (obj.isNull("replyToSenderName")) null else obj.optString("replyToSenderName"),
            deletedForEveryone = obj.optBoolean("deletedForEveryone", false),
            createdAt = obj.optString("createdAt"),
            senderName = obj.optString("senderName"),
            reactions = reactionsList
        )
    }
}
