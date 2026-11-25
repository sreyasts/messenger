package com.privatemessenger.app.data.remote

import android.content.Context
import android.net.Uri
import com.privatemessenger.app.BuildConfig
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.model.CallStatus
import com.privatemessenger.app.data.model.CallType
import com.privatemessenger.app.data.model.Message
import com.privatemessenger.app.data.model.P2PTransfer
import com.privatemessenger.app.data.model.P2PTransferStatus
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.time.Instant

data class LiveKitTokenResponse(
    val token: String,
    val livekitUrl: String,
    val roomName: String,
    val participantIdentity: String
)

/**
 * Lightweight Supabase REST, Storage, and Edge Function client.
 * Matches the backend contracts in GEMINI.md and gracefully operates in offline/local mode
 * when SUPABASE_URL / SUPABASE_ANON_KEY are unset or placeholder values.
 */
object SupabaseSyncClient {

    private fun supabaseUrl(): String = BuildConfig.SUPABASE_URL.trim().trimEnd('/')
    private fun supabaseAnonKey(): String = BuildConfig.SUPABASE_ANON_KEY.trim()
    private fun defaultLiveKitUrl(): String = BuildConfig.LIVEKIT_URL.trim()

    fun isConfigured(): Boolean {
        val url = supabaseUrl()
        val key = supabaseAnonKey()
        return url.startsWith("https://") &&
            !url.contains("your-project-id") &&
            key.isNotBlank() &&
            !key.contains("your-anon-key")
    }

    /**
     * Fetches a LiveKit room JWT from `/functions/v1/livekit-token`.
     */
    suspend fun fetchLiveKitToken(
        accessToken: String?,
        roomName: String,
        participantIdentity: String,
        participantName: String
    ): Result<LiveKitTokenResponse> = withContext(Dispatchers.IO) {
        if (!isConfigured()) {
            return@withContext Result.failure(IllegalStateException("Supabase backend not configured"))
        }
        var conn: HttpURLConnection? = null
        try {
            val endpoint = "${supabaseUrl()}/functions/v1/livekit-token"
            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 8_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("apikey", supabaseAnonKey())
                val bearer = if (!accessToken.isNullOrBlank()) accessToken else supabaseAnonKey()
                setRequestProperty("Authorization", "Bearer $bearer")
            }

            val payload = JSONObject().apply {
                put("roomName", roomName)
                put("participantIdentity", participantIdentity)
                put("participantName", participantName)
            }
            conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }

            val code = conn.responseCode
            val stream = if (code in 200..299) conn.inputStream else conn.errorStream
            val bodyText = stream?.let { BufferedReader(InputStreamReader(it)).use { r -> r.readText() } } ?: ""

            if (code !in 200..299) {
                return@withContext Result.failure(IllegalStateException("LiveKit token HTTP $code: $bodyText"))
            }

            val json = JSONObject(bodyText)
            val token = json.optString("token", "")
            val lkUrl = json.optString("livekitUrl", defaultLiveKitUrl())
            if (token.isBlank() || lkUrl.isBlank()) {
                return@withContext Result.failure(IllegalStateException("Empty LiveKit token or URL"))
            }
            Result.success(
                LiveKitTokenResponse(
                    token = token,
                    livekitUrl = lkUrl,
                    roomName = json.optString("roomName", roomName),
                    participantIdentity = json.optString("participantIdentity", participantIdentity)
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Streams a <= 50 MB file directly to Supabase Storage bucket (`chat-attachments`, `avatars`, etc.)
     * with chunked upload progress callbacks.
     */
    suspend fun uploadToStorage(
        context: Context,
        accessToken: String?,
        bucket: String,
        folder: String,
        fileName: String,
        mimeType: String,
        fileUri: Uri,
        fileSize: Long,
        onProgress: (Int) -> Unit = {}
    ): Result<String> = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) {
            return@withContext Result.failure(IllegalStateException("Supabase storage requires live session"))
        }
        if (fileSize > MediaFileInspector.MAX_SUPABASE_STORAGE_BYTES) {
            return@withContext Result.failure(IllegalArgumentException("File exceeds 50 MB storage limit"))
        }

        var conn: HttpURLConnection? = null
        try {
            val safeName = MediaFileInspector.sanitizeFileName(fileName)
            val cleanFolder = folder.trim('/').replace(Regex("[^a-zA-Z0-9/_-]"), "_")
            val objectPath = "$cleanFolder/${System.currentTimeMillis()}_$safeName"
            val encodedPath = objectPath.split('/').joinToString("/") {
                URLEncoder.encode(it, "UTF-8").replace("+", "%20")
            }

            val uploadUrl = "${supabaseUrl()}/storage/v1/object/$bucket/$encodedPath"
            conn = (URL(uploadUrl).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 15_000
                readTimeout = 60_000
                doOutput = true
                if (fileSize > 0) {
                    setFixedLengthStreamingMode(fileSize)
                } else {
                    setChunkedStreamingMode(64 * 1024)
                }
                setRequestProperty("Authorization", "Bearer $accessToken")
                setRequestProperty("apikey", supabaseAnonKey())
                setRequestProperty("Content-Type", mimeType.ifBlank { "application/octet-stream" })
                setRequestProperty("x-upsert", "false")
            }

            context.contentResolver.openInputStream(fileUri)?.use { rawIn ->
                BufferedInputStream(rawIn, 64 * 1024).use { input ->
                    BufferedOutputStream(conn.outputStream, 64 * 1024).use { output ->
                        val buffer = ByteArray(64 * 1024)
                        var sent = 0L
                        var read: Int
                        while (input.read(buffer).also { read = it } != -1) {
                            output.write(buffer, 0, read)
                            sent += read
                            if (fileSize > 0) {
                                val pct = ((sent.toDouble() / fileSize) * 100.0).toInt().coerceIn(1, 99)
                                onProgress(pct)
                            }
                        }
                        output.flush()
                    }
                }
            } ?: return@withContext Result.failure(IllegalStateException("Could not read file stream"))

            val code = conn.responseCode
            if (code !in 200..299) {
                val err = conn.errorStream?.let { BufferedReader(InputStreamReader(it)).use { r -> r.readText() } } ?: ""
                return@withContext Result.failure(IllegalStateException("Storage upload failed ($code): $err"))
            }

            onProgress(100)
            val publicUrl = "${supabaseUrl()}/storage/v1/object/public/$bucket/$encodedPath"
            Result.success(publicUrl)
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            conn?.disconnect()
        }
    }

    /**
     * Inserts a message row into `public.messages`.
     */
    suspend fun insertMessage(accessToken: String?, message: Message): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("id", message.id)
            put("conversation_id", message.conversationId)
            put("sender_id", message.senderId)
            put("content", message.content)
            put("media_url", message.mediaUrl)
            put("media_type", message.mediaType.key)
            put("file_name", message.fileName)
            put("file_size", message.fileSize)
            put("is_view_once", message.isViewOnce)
            if (message.replyToId != null) put("reply_to_id", message.replyToId)
        }
        executeRestRequest("POST", "/rest/v1/messages", accessToken, body)
    }

    /**
     * Updates ONLY `viewed_at` on `public.messages` when a View Once photo is opened.
     * Preserves the DB row and storage object permanently for abuse/moderation audit.
     */
    suspend fun markViewOnceViewed(
        accessToken: String?,
        messageId: String,
        viewedAtIso: String = Instant.now().toString()
    ): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("viewed_at", viewedAtIso)
        }
        val encodedId = URLEncoder.encode(messageId, "UTF-8")
        executeRestRequest("PATCH", "/rest/v1/messages?id=eq.$encodedId", accessToken, body)
    }

    /**
     * Soft-deletes a message via Delete for Everyone, preserving original content & media_url.
     */
    suspend fun softDeleteMessage(
        accessToken: String?,
        messageId: String,
        deletedBy: String,
        deletedAtIso: String = Instant.now().toString()
    ): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("deleted_for_everyone", true)
            put("deleted_at", deletedAtIso)
            put("deleted_by", deletedBy)
        }
        val encodedId = URLEncoder.encode(messageId, "UTF-8")
        executeRestRequest("PATCH", "/rest/v1/messages?id=eq.$encodedId", accessToken, body)
    }

    /**
     * Syncs a P2P transfer row to `public.p2p_transfers`.
     */
    suspend fun upsertP2pTransfer(accessToken: String?, transfer: P2PTransfer): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("id", transfer.id)
            put("conversation_id", transfer.conversationId)
            put("sender_id", transfer.senderId)
            put("receiver_id", transfer.receiverId)
            put("file_name", transfer.fileName)
            put("file_size", transfer.fileSize)
            put("file_type", transfer.fileType)
            put("file_hash_sha256", transfer.fileHashSha256)
            put("status", transfer.status.key)
        }
        executeRestRequest(
            "POST",
            "/rest/v1/p2p_transfers",
            accessToken,
            body,
            extraHeaders = mapOf("Prefer" to "resolution=merge-duplicates")
        )
    }

    suspend fun updateP2pTransferStatus(
        accessToken: String?,
        transferId: String,
        status: P2PTransferStatus
    ): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply { put("status", status.key) }
        val encodedId = URLEncoder.encode(transferId, "UTF-8")
        executeRestRequest("PATCH", "/rest/v1/p2p_transfers?id=eq.$encodedId", accessToken, body)
    }

    /**
     * Records or updates call state in `public.calls`.
     */
    suspend fun upsertCallRecord(
        accessToken: String?,
        callId: String,
        conversationId: String,
        callerId: String,
        callType: CallType,
        roomName: String,
        status: CallStatus
    ): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("id", callId)
            put("conversation_id", conversationId)
            put("caller_id", callerId)
            put("call_type", callType.key)
            put("room_name", roomName)
            put("status", status.key)
        }
        executeRestRequest(
            "POST",
            "/rest/v1/calls",
            accessToken,
            body,
            extraHeaders = mapOf("Prefer" to "resolution=merge-duplicates")
        )
    }

    suspend fun updateCallStatus(
        accessToken: String?,
        callId: String,
        status: CallStatus
    ): Boolean = withContext(Dispatchers.IO) {
        if (!isConfigured() || accessToken.isNullOrBlank()) return@withContext false
        val body = JSONObject().apply {
            put("status", status.key)
            if (status == CallStatus.ENDED || status == CallStatus.DECLINED || status == CallStatus.MISSED) {
                put("ended_at", Instant.now().toString())
            }
        }
        val encodedId = URLEncoder.encode(callId, "UTF-8")
        executeRestRequest("PATCH", "/rest/v1/calls?id=eq.$encodedId", accessToken, body)
    }

    private fun executeRestRequest(
        method: String,
        path: String,
        accessToken: String,
        body: JSONObject,
        extraHeaders: Map<String, String> = emptyMap()
    ): Boolean {
        var conn: HttpURLConnection? = null
        return try {
            val endpoint = "${supabaseUrl()}$path"
            conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
                requestMethod = method
                connectTimeout = 8_000
                readTimeout = 10_000
                doOutput = true
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("apikey", supabaseAnonKey())
                setRequestProperty("Authorization", "Bearer $accessToken")
                extraHeaders.forEach { (k, v) -> setRequestProperty(k, v) }
            }
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            conn.responseCode in 200..299
        } catch (_: Exception) {
            false
        } finally {
            conn?.disconnect()
        }
    }
}
