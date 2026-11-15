package com.privatemessenger.app.data.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * Handles downloading APK updates directly inside the application and launching
 * the system package installer without redirecting to an external web browser.
 */
object InAppUpdateDownloader {

    sealed class DownloadState {
        object Idle : DownloadState()
        data class Downloading(val progress: Float, val downloadedBytes: Long, val totalBytes: Long) : DownloadState()
        data class ReadyToInstall(val apkFile: File) : DownloadState()
        data class Error(val message: String) : DownloadState()
    }

    /**
     * Downloads an APK from [downloadUrl] directly to the app's cache directory,
     * following GitHub Releases HTTP redirects (302/307 to S3).
     */
    suspend fun downloadApk(
        context: Context,
        downloadUrl: String,
        onProgress: (Float, Long, Long) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            var targetUrl = downloadUrl
            var redirectCount = 0
            val maxRedirects = 6

            // Follow HTTP redirects (GitHub releases redirect to AWS S3 signed URLs)
            while (redirectCount < maxRedirects) {
                val url = URL(targetUrl)
                connection = url.openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = true
                connection.connectTimeout = 15000
                connection.readTimeout = 30000
                connection.setRequestProperty("User-Agent", "PrivateMessenger-Android")
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
                        targetUrl = location
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

            // Target storage in app updates cache
            val updatesDir = File(context.cacheDir, "updates").apply { mkdirs() }
            val outputFile = File(updatesDir, "messenger-latest-update.apk")
            if (outputFile.exists()) {
                outputFile.delete()
            }

            finalConn.inputStream.use { input: InputStream ->
                FileOutputStream(outputFile).use { output: FileOutputStream ->
                    val buffer = ByteArray(32 * 1024)
                    var bytesRead: Int
                    var totalRead = 0L

                    while (input.read(buffer).also { bytesRead = it } != -1) {
                        output.write(buffer, 0, bytesRead)
                        totalRead += bytesRead
                        val progress = if (contentLength > 0) {
                            (totalRead.toFloat() / contentLength).coerceIn(0f, 1f)
                        } else {
                            0.5f
                        }
                        onProgress(progress, totalRead, contentLength)
                    }
                    output.flush()
                }
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
            val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES).apply {
                data = Uri.parse("package:${context.packageName}")
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }
    }

    /**
     * Triggers the Android package installer directly using FileProvider.
     * ZERO browser redirects.
     */
    fun installApk(context: Context, apkFile: File) {
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
    }
}
