package com.privatemessenger.app.data.storage

import android.content.Context
import android.content.SharedPreferences
import com.privatemessenger.app.data.model.MediaType
import com.privatemessenger.app.data.model.Message
import com.privatemessenger.app.data.model.P2PTransferStatus
import com.privatemessenger.app.data.model.Reaction
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * Durable persistence for chat messages segregated by conversation ID.
 * Ensures that sent messages, received messages, attachments, voice notes, P2P transfers,
 * replies, reactions, and View-Once states are permanently preserved and re-loaded across
 * chat closures, navigation, and application restarts.
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
     * Once a view-once photo is opened, its viewedAt timestamp is permanently locked and local
     * mediaUri / mediaUrl / content are stripped from client cache while keeping the DB audit row.
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
                result.add(reconcileViewOnce(msg, viewOnceStorage))
            }
        } catch (_: Exception) {}
        return result
    }

    /**
     * Saves or updates a message in durable storage synchronously.
     */
    @Synchronized
    fun saveMessage(message: Message, viewOnceStorage: ViewOnceStorage) {
        val sanitized = reconcileViewOnce(message, viewOnceStorage)
        val current = getMessages(message.conversationId, viewOnceStorage).toMutableList()
        val idx = current.indexOfFirst { it.id == message.id }
        if (idx != -1) {
            current[idx] = sanitized
        } else {
            current.add(sanitized)
        }
        writeConversationMessages(message.conversationId, current)
    }

    /**
     * Permanently marks a view-once photo as viewed in both [viewOnceStorage] and [MessageStorage].
     * Returns the updated [Message] with locked viewedAt timestamp and cleared local ephemeral media.
     */
    @Synchronized
    fun markViewOnceOpened(
        conversationId: String,
        messageId: String,
        viewOnceStorage: ViewOnceStorage
    ): Message? {
        val timestampIso = viewOnceStorage.markAsViewed(messageId, Instant.now().toString())
        val current = getMessages(conversationId, viewOnceStorage).toMutableList()
        val idx = current.indexOfFirst { it.id == messageId }
        if (idx != -1) {
            val updated = current[idx].copy(
                viewedAt = current[idx].viewedAt ?: timestampIso,
                content = "",
                mediaUrl = "",
                localUri = ""
            )
            current[idx] = updated
            writeConversationMessages(conversationId, current)
            return updated
        }
        return null
    }

    /**
     * Updates P2P transfer progress/status on the associated message in durable storage.
     */
    @Synchronized
    fun updateTransferProgress(
        conversationId: String,
        transferId: String,
        status: P2PTransferStatus,
        progress: Int,
        viewOnceStorage: ViewOnceStorage,
        localUri: String? = null,
        fileHashSha256: String? = null
    ) {
        val current = getMessages(conversationId, viewOnceStorage).toMutableList()
        val idx = current.indexOfFirst { it.transferId == transferId }
        if (idx != -1) {
            val existing = current[idx]
            current[idx] = existing.copy(
                transferStatus = status,
                transferProgress = progress.coerceIn(0, 100),
                localUri = localUri ?: existing.localUri,
                fileHashSha256 = fileHashSha256 ?: existing.fileHashSha256
            )
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
            val reconciled = initial.map { reconcileViewOnce(it, viewOnceStorage) }
            writeConversationMessages(conversationId, reconciled)
        }
    }

    private fun reconcileViewOnce(msg: Message, viewOnceStorage: ViewOnceStorage): Message {
        if (!msg.isViewOnce) return msg
        val storedViewedAt = viewOnceStorage.getViewedAt(msg.id)
        val isViewed = storedViewedAt != null || msg.viewedAt != null
        return if (isViewed) {
            val lockedTimestamp = msg.viewedAt ?: storedViewedAt ?: "Opened"
            viewOnceStorage.markAsViewed(msg.id, lockedTimestamp)
            msg.copy(
                viewedAt = lockedTimestamp,
                content = "",
                mediaUrl = "",
                localUri = ""
            )
        } else {
            msg
        }
    }

    private fun writeConversationMessages(conversationId: String, list: List<Message>) {
        try {
            val array = JSONArray()
            for (msg in list) {
                array.put(messageToJson(msg))
            }
            prefs.edit().putString(KEY_PREFIX_CONV + conversationId, array.toString()).commit()
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
        obj.put("mimeType", m.mimeType)
        obj.put("localUri", m.localUri)
        obj.put("fileHashSha256", m.fileHashSha256)
        obj.put("isP2pTransfer", m.isP2pTransfer)
        obj.put("transferId", m.transferId ?: JSONObject.NULL)
        obj.put("transferStatus", m.transferStatus?.name ?: JSONObject.NULL)
        obj.put("transferProgress", m.transferProgress)
        obj.put("audioDurationSec", m.audioDurationSec)
        obj.put("isViewOnce", m.isViewOnce)
        obj.put("viewedAt", m.viewedAt ?: JSONObject.NULL)
        obj.put("replyToId", m.replyToId ?: JSONObject.NULL)
        obj.put("replyToContent", m.replyToContent ?: JSONObject.NULL)
        obj.put("replyToSenderName", m.replyToSenderName ?: JSONObject.NULL)
        obj.put("deletedForEveryone", m.deletedForEveryone)
        obj.put("deletedAt", m.deletedAt ?: JSONObject.NULL)
        obj.put("deletedBy", m.deletedBy ?: JSONObject.NULL)
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

        val transferStatusStr = if (obj.isNull("transferStatus")) null else obj.optString("transferStatus")
        val transferStatus = transferStatusStr?.let {
            try {
                P2PTransferStatus.valueOf(it)
            } catch (_: Exception) {
                null
            }
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
            mimeType = obj.optString("mimeType"),
            localUri = obj.optString("localUri"),
            fileHashSha256 = obj.optString("fileHashSha256"),
            isP2pTransfer = obj.optBoolean("isP2pTransfer", false),
            transferId = if (obj.isNull("transferId")) null else obj.optString("transferId"),
            transferStatus = transferStatus,
            transferProgress = obj.optInt("transferProgress", 0),
            audioDurationSec = obj.optInt("audioDurationSec", 0),
            isViewOnce = obj.optBoolean("isViewOnce", false),
            viewedAt = if (obj.isNull("viewedAt")) null else obj.optString("viewedAt"),
            replyToId = if (obj.isNull("replyToId")) null else obj.optString("replyToId"),
            replyToContent = if (obj.isNull("replyToContent")) null else obj.optString("replyToContent"),
            replyToSenderName = if (obj.isNull("replyToSenderName")) null else obj.optString("replyToSenderName"),
            deletedForEveryone = obj.optBoolean("deletedForEveryone", false),
            deletedAt = if (obj.isNull("deletedAt")) null else obj.optString("deletedAt"),
            deletedBy = if (obj.isNull("deletedBy")) null else obj.optString("deletedBy"),
            createdAt = obj.optString("createdAt"),
            senderName = obj.optString("senderName"),
            reactions = reactionsList
        )
    }
}
