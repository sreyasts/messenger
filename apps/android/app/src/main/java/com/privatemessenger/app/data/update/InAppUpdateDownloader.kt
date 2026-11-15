package com.privatemessenger.app.data.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

/**
 * High-speed in-app update downloader and installer.
 * Downloads APK updates directly inside the application using 256 KB buffered I/O,
 * monitors download throughput in real-time, and launches the Android package
 * installer via FileProvider with ZERO browser redirection.
 */
object InAppUpdateDownloader {

    sealed class DownloadState {
        object Idle : DownloadState()
        data class Downloading(
            val progress: Float,
            val downloadedBytes: Long,
            val totalBytes: Long,
            val speedBytesPerSec: Long = 0L
        ) : DownloadState()
        data class ReadyToInstall(val apkFile: File) : DownloadState()
        data class Error(val message: String) : DownloadState()
    }

    /**
     * Downloads an APK from [downloadUrl] directly to the app's cache directory
     * at maximum speed, following HTTP redirects (e.g. GitHub Releases 302/307 to AWS S3 / Azure Blob).
     *
     * @param context Application or Activity context.
     * @param downloadUrl Remote URL of the APK asset.
     * @param onProgress Callback invoked with (progress 0f..1f, downloadedBytes, totalBytes, speedBytesPerSec).
     */
    suspend fun downloadApk(
        context: Context,
        downloadUrl: String,
        onProgress: (Float, Long, Long, Long) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        if (downloadUrl.isBlank()) {
            return@withContext Result.failure(IllegalArgumentException("Download URL cannot be blank"))
        }

        var connection: HttpURLConnection? = null
        try {
            var targetUrl = downloadUrl.trim()
            var redirectCount = 0
            val maxRedirects = 8

            // Follow HTTP redirects (GitHub releases redirect to cloud blob CDN signed URLs)
            while (redirectCount < maxRedirects) {
                val url = URL(targetUrl)
                if (url.protocol != "http" && url.protocol != "https") {
                    return@withContext Result.failure(SecurityException("Invalid URL protocol: ${url.protocol}"))
                }

                val conn = url.openConnection()
                if (conn !is HttpURLConnection) {
                    return@withContext Result.failure(SecurityException("Non-HTTP connection encountered"))
                }
                connection = conn
                connection.instanceFollowRedirects = true
                connection.connectTimeout = 12000
                connection.readTimeout = 60000
                connection.setRequestProperty("User-Agent", "PrivateMessenger-Android")
                connection.setRequestProperty("Accept", "application/vnd.android.package-archive, application/octet-stream, */*")
                connection.setRequestProperty("Accept-Encoding", "identity")
                connection.setRequestProperty("Connection", "Keep-Alive")
                connection.connect()

                val statusCode = connection.responseCode
                if (statusCode in listOf(
                        HttpURLConnection.HTTP_MOVED_TEMP,
                        HttpURLConnection.HTTP_MOVED_PERM,
                        HttpURLConnection.HTTP_SEE_OTHER,
                        307,
                        308
                    )
                ) {
                    val location = connection.getHeaderField("Location")
                    if (!location.isNullOrBlank()) {
                        // Resolve relative redirect URLs against current URL
                        targetUrl = URL(url, location).toString()
                        connection.disconnect()
                        redirectCount++
                        continue
                    }
                }
                break
            }

            val finalConn = connection ?: return@withContext Result.failure(Exception("Connection failed"))
            val responseCode = finalConn.responseCode
            if (responseCode !in 200..299) {
                return@withContext Result.failure(Exception("HTTP Error: $responseCode"))
            }

            val contentLength = finalConn.contentLengthLong

            // Target storage in internal cache directory
            val updatesDir = File(context.cacheDir, "updates")
            if (!updatesDir.exists() && !updatesDir.mkdirs()) {
                return@withContext Result.failure(Exception("Failed to create updates directory"))
            }

            val outputFile = File(updatesDir, "messenger-latest-update.apk")
            if (outputFile.exists()) {
                outputFile.delete()
            }

            // High-throughput 256 KB buffered streaming
            val bufferSize = 256 * 1024
            val buffer = ByteArray(bufferSize)
            var bytesRead: Int
            var totalRead = 0L
            var lastProgressEmit = System.currentTimeMillis()
            var lastBytes = 0L
            var speedBytesPerSec = 0L

            BufferedInputStream(finalConn.inputStream, bufferSize).use { input: InputStream ->
                BufferedOutputStream(FileOutputStream(outputFile), bufferSize).use { output ->
                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalRead += bytesRead

                        val now = System.currentTimeMillis()
                        val timeDelta = now - lastProgressEmit
                        if (timeDelta >= 100 || (contentLength > 0 && totalRead == contentLength)) {
                            if (timeDelta > 0) {
                                val bytesDelta = totalRead - lastBytes
                                speedBytesPerSec = (bytesDelta * 1000L) / timeDelta
                            }
                            lastProgressEmit = now
                            lastBytes = totalRead

                            val progress = if (contentLength > 0) {
                                (totalRead.toFloat() / contentLength).coerceIn(0f, 1f)
                            } else {
                                0.5f
                            }

                            withContext(Dispatchers.Main) {
                                onProgress(progress, totalRead, contentLength, speedBytesPerSec)
                            }
                        }
                    }
                    output.flush()
                }
            }

            // Guarantee a final 100% progress callback
            withContext(Dispatchers.Main) {
                onProgress(1f, totalRead, contentLength, speedBytesPerSec)
            }

            if (!outputFile.exists() || outputFile.length() == 0L) {
                return@withContext Result.failure(Exception("Downloaded APK file is empty"))
            }

            Result.success(outputFile)
        } catch (e: Exception) {
            Result.failure(e)
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Checks if the app has permission to install packages on Android 8.0+ (API 26+).
     */
    fun canRequestPackageInstalls(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.packageManager.canRequestPackageInstalls()
        } else {
            true
        }
    }

    /**
     * Prompts the user to grant Unknown Sources install permission for this app.
     */
    fun openUnknownAppSourcesSettings(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                    data = Uri.parse("package:${context.packageName}")
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
            } catch (_: Exception) {
                try {
                    val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                        data = Uri.parse("package:${context.packageName}")
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(fallback)
                } catch (_: Exception) {}
            }
        }
    }

    /**
     * Triggers the Android package installer directly using FileProvider.
     * ZERO browser redirects.
     */
    fun installApk(context: Context, apkFile: File) {
        if (!apkFile.exists() || apkFile.length() == 0L) {
            return
        }
        try {
            val apkUri: Uri = FileProvider.getUriForFile(
                context,
                "${context.packageName}.fileprovider",
                apkFile
            )

            val installIntent = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(apkUri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }

            context.startActivity(installIntent)
        } catch (_: Exception) {}
    }

    /**
     * Formats bytes into human-readable representation (e.g. "17.4 MB").
     */
    fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 MB"
        val mb = bytes.toDouble() / (1024.0 * 1024.0)
        return String.format(Locale.US, "%.1f MB", mb)
    }

    /**
     * Formats speed into human-readable representation (e.g. "4.8 MB/s").
     */
    fun formatSpeed(speedBytesPerSec: Long): String {
        if (speedBytesPerSec <= 0) return "0 MB/s"
        val mbps = speedBytesPerSec.toDouble() / (1024.0 * 1024.0)
        return if (mbps >= 0.1) {
            String.format(Locale.US, "%.1f MB/s", mbps)
        } else {
            val kbps = speedBytesPerSec.toDouble() / 1024.0
            String.format(Locale.US, "%.0f KB/s", kbps)
        }
    }
}
