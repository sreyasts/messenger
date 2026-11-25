package com.privatemessenger.app.data.media

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.privatemessenger.app.data.model.MediaType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.UUID

data class InspectedFile(
    val uri: Uri,
    val fileName: String,
    val fileSize: Long,
    val mimeType: String,
    val mediaType: MediaType,
    val sha256: String = "",
    val localCachePath: String = ""
)

/**
 * Real Android ContentResolver file inspector, sanitizer, SHA-256 streaming hasher,
 * local cache persister, and Downloads saver/opener.
 */
object MediaFileInspector {

    const val MAX_SUPABASE_STORAGE_BYTES = 50L * 1024L * 1024L // 50 MB
    const val MAX_P2P_FILE_BYTES = 1024L * 1024L * 1024L // 1 GB
    private const val STREAM_BUFFER_SIZE = 64 * 1024 // 64 KB

    private val EXTENSION_MIME_MAP = mapOf(
        "png" to "image/png",
        "jpg" to "image/jpeg",
        "jpeg" to "image/jpeg",
        "webp" to "image/webp",
        "gif" to "image/gif",
        "heic" to "image/heic",
        "heif" to "image/heif",
        "mp4" to "video/mp4",
        "mov" to "video/quicktime",
        "webm" to "video/webm",
        "mkv" to "video/x-matroska",
        "mp3" to "audio/mpeg",
        "wav" to "audio/wav",
        "ogg" to "audio/ogg",
        "opus" to "audio/opus",
        "m4a" to "audio/mp4",
        "aac" to "audio/aac",
        "pdf" to "application/pdf",
        "txt" to "text/plain",
        "csv" to "text/csv",
        "json" to "application/json",
        "zip" to "application/zip",
        "doc" to "application/msword",
        "docx" to "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "xls" to "application/vnd.ms-excel",
        "xlsx" to "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )

    fun sanitizeFileName(rawName: String?): String {
        val base = (rawName ?: "attachment").substringAfterLast('/').substringAfterLast('\\')
        val lastDot = base.lastIndexOf('.')
        val stem = if (lastDot > 0) base.substring(0, lastDot) else base
        val ext = if (lastDot > 0) {
            base.substring(lastDot + 1).lowercase(Locale.US).replace(Regex("[^a-z0-9]"), "")
        } else ""

        val cleanStem = stem
            .replace(Regex("[^a-zA-Z0-9._-]"), "_")
            .replace(Regex("_+"), "_")
            .trim('_', '.', '-')
            .take(80)
            .ifBlank { "file" }

        return if (ext.isNotEmpty()) "$cleanStem.$ext" else cleanStem
    }

    fun inferMimeType(context: Context?, uri: Uri, fileName: String): String {
        val resolverType = try {
            context?.contentResolver?.getType(uri)?.trim()?.lowercase(Locale.US)
        } catch (_: Exception) {
            null
        }
        if (!resolverType.isNullOrBlank() && resolverType != "application/octet-stream") {
            return resolverType
        }
        val ext = fileName.substringAfterLast('.', "").lowercase(Locale.US)
        if (ext.isNotEmpty()) {
            EXTENSION_MIME_MAP[ext]?.let { return it }
            MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)?.let { return it }
        }
        return resolverType ?: "application/octet-stream"
    }

    fun resolveMediaType(mimeType: String, fileName: String): MediaType {
        val normalized = mimeType.lowercase(Locale.US)
        return when {
            normalized == "image/gif" -> MediaType.GIF
            normalized.startsWith("image/") -> MediaType.IMAGE
            normalized.startsWith("video/") -> MediaType.VIDEO
            normalized.startsWith("audio/") -> MediaType.AUDIO
            else -> {
                val ext = fileName.substringAfterLast('.', "").lowercase(Locale.US)
                when (ext) {
                    "gif" -> MediaType.GIF
                    "png", "jpg", "jpeg", "webp", "heic", "heif", "bmp" -> MediaType.IMAGE
                    "mp4", "mov", "webm", "mkv", "avi" -> MediaType.VIDEO
                    "mp3", "wav", "ogg", "opus", "m4a", "aac" -> MediaType.AUDIO
                    else -> MediaType.FILE
                }
            }
        }
    }

    fun formatFileSize(bytes: Long): String {
        if (bytes <= 0L) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB")
        var value = bytes.toDouble()
        var idx = 0
        while (value >= 1024.0 && idx < units.lastIndex) {
            value /= 1024.0
            idx++
        }
        return if (idx == 0) {
            "$bytes B"
        } else {
            String.format(Locale.US, "%.1f %s", value, units[idx])
        }
    }

    /**
     * Inspects a picked [Uri] via [android.content.ContentResolver] to extract real display name,
     * byte size, MIME type, MediaType, and optionally persists a local app-owned copy + SHA-256.
     */
    suspend fun inspectAndCache(
        context: Context,
        uri: Uri,
        persistLocalCopy: Boolean = true,
        computeSha256: Boolean = true
    ): Result<InspectedFile> = withContext(Dispatchers.IO) {
        try {
            var rawName: String? = null
            var reportedSize = -1L

            context.contentResolver.query(
                uri,
                arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val nameIdx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    val sizeIdx = cursor.getColumnIndex(OpenableColumns.SIZE)
                    if (nameIdx != -1 && !cursor.isNull(nameIdx)) {
                        rawName = cursor.getString(nameIdx)
                    }
                    if (sizeIdx != -1 && !cursor.isNull(sizeIdx)) {
                        reportedSize = cursor.getLong(sizeIdx)
                    }
                }
            }

            if (rawName.isNullOrBlank()) {
                val seg = uri.lastPathSegment?.substringAfterLast('/')
                rawName = if (!seg.isNullOrBlank()) seg else "attachment_${System.currentTimeMillis()}"
            }

            val preliminaryName = sanitizeFileName(rawName)
            var mimeType = inferMimeType(context, uri, preliminaryName)
            // Ensure file extension matches MIME type if picker returned an extensionless name
            val finalName = if (!preliminaryName.contains('.')) {
                val guessedExt = MimeTypeMap.getSingleton().getExtensionFromMimeType(mimeType)
                if (!guessedExt.isNullOrBlank()) "$preliminaryName.$guessedExt" else preliminaryName
            } else {
                preliminaryName
            }
            mimeType = inferMimeType(context, uri, finalName)
            val mediaType = resolveMediaType(mimeType, finalName)

            if (reportedSize > MAX_P2P_FILE_BYTES) {
                return@withContext Result.failure(
                    IllegalArgumentException("File exceeds the 1 GB WebRTC P2P maximum (${formatFileSize(reportedSize)})")
                )
            }

            var actualSize = if (reportedSize >= 0L) reportedSize else 0L
            var localPath = ""
            var sha256Hex = ""

            // Only copy files <= 100 MB directly to internal media cache during inspection;
            // huge files (up to 1 GB) stream directly from ContentResolver Uri to avoid duplicating 1 GB on disk.
            val shouldCopyToInternal = persistLocalCopy && (reportedSize in 0..MAX_SUPABASE_STORAGE_BYTES)

            if (shouldCopyToInternal || computeSha256 || reportedSize < 0L) {
                val digest = if (computeSha256) MessageDigest.getInstance("SHA-256") else null
                val mediaDir = File(context.filesDir, "media").apply { mkdirs() }
                val destFile = if (shouldCopyToInternal) {
                    File(mediaDir, "${UUID.randomUUID().toString().take(8)}_$finalName")
                } else null

                var countedBytes = 0L
                context.contentResolver.openInputStream(uri)?.use { input ->
                    val fos = destFile?.let { FileOutputStream(it) }
                    try {
                        val buffer = ByteArray(STREAM_BUFFER_SIZE)
                        var bytesRead: Int
                        while (input.read(buffer).also { bytesRead = it } != -1) {
                            countedBytes += bytesRead
                            if (countedBytes > MAX_P2P_FILE_BYTES) {
                                throw IllegalArgumentException("File exceeds 1 GB P2P transfer limit")
                            }
                            digest?.update(buffer, 0, bytesRead)
                            fos?.write(buffer, 0, bytesRead)
                        }
                        fos?.flush()
                    } finally {
                        fos?.close()
                    }
                } ?: return@withContext Result.failure(IllegalStateException("Unable to open selected file"))

                actualSize = countedBytes
                if (destFile != null && destFile.exists()) {
                    localPath = Uri.fromFile(destFile).toString()
                }
                if (digest != null) {
                    sha256Hex = digest.digest().joinToString("") { "%02x".format(it) }
                }
            }

            Result.success(
                InspectedFile(
                    uri = uri,
                    fileName = finalName,
                    fileSize = actualSize,
                    mimeType = mimeType,
                    mediaType = mediaType,
                    sha256 = sha256Hex,
                    localCachePath = localPath
                )
            )
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Streams SHA-256 calculation directly from a [ContentResolver] Uri in 64 KB chunks.
     */
    suspend fun calculateSha256FromUri(context: Context, uri: Uri): String = withContext(Dispatchers.IO) {
        try {
            val digest = MessageDigest.getInstance("SHA-256")
            context.contentResolver.openInputStream(uri)?.use { input ->
                val buffer = ByteArray(STREAM_BUFFER_SIZE)
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    digest.update(buffer, 0, read)
                }
            } ?: return@withContext ""
            digest.digest().joinToString("") { "%02x".format(it) }
        } catch (_: Exception) {
            ""
        }
    }

    /**
     * Saves a local/content/remote file into the user's public Downloads/PrivateMessenger folder.
     */
    suspend fun saveToDownloads(
        context: Context,
        sourceUrlOrUri: String,
        fileName: String,
        mimeType: String
    ): Result<Uri> = withContext(Dispatchers.IO) {
        try {
            val safeName = sanitizeFileName(fileName)
            val resolvedMime = mimeType.ifBlank { "application/octet-stream" }

            val openSourceStream: () -> InputStream? = {
                when {
                    sourceUrlOrUri.startsWith("http://") || sourceUrlOrUri.startsWith("https://") -> {
                        val conn = URL(sourceUrlOrUri).openConnection() as HttpURLConnection
                        conn.connectTimeout = 15_000
                        conn.readTimeout = 60_000
                        conn.connect()
                        if (conn.responseCode in 200..299) conn.inputStream else null
                    }
                    sourceUrlOrUri.startsWith("file://") -> {
                        val file = File(Uri.parse(sourceUrlOrUri).path ?: "")
                        if (file.exists()) file.inputStream() else null
                    }
                    sourceUrlOrUri.startsWith("/") -> {
                        val file = File(sourceUrlOrUri)
                        if (file.exists()) file.inputStream() else null
                    }
                    else -> context.contentResolver.openInputStream(Uri.parse(sourceUrlOrUri))
                }
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, safeName)
                    put(MediaStore.Downloads.MIME_TYPE, resolvedMime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/PrivateMessenger")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val destUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: return@withContext Result.failure(IllegalStateException("Failed to create Downloads entry"))

                openSourceStream()?.use { input ->
                    resolver.openOutputStream(destUri)?.use { output ->
                        val buf = ByteArray(STREAM_BUFFER_SIZE)
                        var read: Int
                        while (input.read(buf).also { read = it } != -1) {
                            output.write(buf, 0, read)
                        }
                        output.flush()
                    } ?: return@withContext Result.failure(IllegalStateException("Failed to write to Downloads"))
                } ?: return@withContext Result.failure(IllegalStateException("Source file could not be read"))

                values.clear()
                values.put(MediaStore.Downloads.IS_PENDING, 0)
                resolver.update(destUri, values, null, null)
                Result.success(destUri)
            } else {
                @Suppress("DEPRECATION")
                val downloadsDir = File(
                    Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                    "PrivateMessenger"
                ).apply { mkdirs() }
                val destFile = File(downloadsDir, safeName)
                openSourceStream()?.use { input ->
                    FileOutputStream(destFile).use { output ->
                        val buf = ByteArray(STREAM_BUFFER_SIZE)
                        var read: Int
                        while (input.read(buf).also { read = it } != -1) {
                            output.write(buf, 0, read)
                        }
                        output.flush()
                    }
                } ?: return@withContext Result.failure(IllegalStateException("Source file could not be read"))
                val shareableUri = FileProvider.getUriForFile(
                    context,
                    "${context.packageName}.fileprovider",
                    destFile
                )
                Result.success(shareableUri)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    /**
     * Opens a local file or content URI via Android's system viewer using FileProvider.
     */
    fun openFileWithSystemViewer(
        context: Context,
        sourceUrlOrUri: String,
        mimeType: String
    ): Boolean {
        return try {
            val targetUri: Uri = when {
                sourceUrlOrUri.startsWith("http://") || sourceUrlOrUri.startsWith("https://") -> {
                    Uri.parse(sourceUrlOrUri)
                }
                sourceUrlOrUri.startsWith("file://") -> {
                    val file = File(Uri.parse(sourceUrlOrUri).path ?: return false)
                    if (!file.exists()) return false
                    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                }
                sourceUrlOrUri.startsWith("/") -> {
                    val file = File(sourceUrlOrUri)
                    if (!file.exists()) return false
                    FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
                }
                else -> Uri.parse(sourceUrlOrUri)
            }

            val resolvedMime = mimeType.ifBlank { "*/*" }
            val intent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(targetUri, resolvedMime)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "Open file with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            false
        }
    }
}
