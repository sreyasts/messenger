package com.privatemessenger.app.data.update

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL

/**
 * Manages checking for newer application releases via the GitHub Releases API.
 */
class UpdateManager(
    private val repoOwner: String = "sreyasts",
    private val repoName: String = "messenger"
) {

    /**
     * Checks if a new release is available and whether it should be shown
     * according to [UpdatePolicy].
     *
     * @param currentVersionCode Current local version code (e.g. 1 or 10000).
     * @param currentVersionName Current local version name (e.g. "1.0.0").
     * @param isDebugBuild Whether running in an active debug test environment.
     * @param forceCheck When true, bypasses policy version checks to allow testing or on-demand checks.
     * @return [ReleaseInfo] if an update should be displayed to the user, or null if up-to-date.
     */
    suspend fun checkForUpdate(
        currentVersionCode: Int,
        currentVersionName: String,
        isDebugBuild: Boolean = false,
        forceCheck: Boolean = false
    ): ReleaseInfo? = withContext(Dispatchers.IO) {
        val remoteRelease = fetchLatestRelease() ?: return@withContext null

        if (forceCheck) {
            return@withContext remoteRelease
        }

        val shouldShow = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = isDebugBuild,
            remoteRelease = remoteRelease
        )

        if (shouldShow) remoteRelease else null
    }

    /**
     * Queries the latest release from GitHub Releases API.
     */
    fun fetchLatestRelease(): ReleaseInfo? {
        val apiUrl = "https://api.github.com/repos/$repoOwner/$repoName/releases/latest"
        var connection: HttpURLConnection? = null
        return try {
            val url = URL(apiUrl)
            connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 8000
            connection.readTimeout = 8000
            connection.setRequestProperty("Accept", "application/vnd.github.v3+json")
            connection.setRequestProperty("User-Agent", "PrivateMessenger-Android")

            val responseCode = connection.responseCode
            if (responseCode == HttpURLConnection.HTTP_OK) {
                val reader = BufferedReader(InputStreamReader(connection.inputStream))
                val response = reader.use { it.readText() }
                parseReleaseJson(response)
            } else {
                null
            }
        } catch (_: Exception) {
            null
        } finally {
            connection?.disconnect()
        }
    }

    /**
     * Parses GitHub Releases API JSON response into [ReleaseInfo].
     */
    fun parseReleaseJson(jsonString: String): ReleaseInfo? {
        return try {
            val json = JSONObject(jsonString)
            val tagName = json.optString("tag_name", "v1.0.0").removePrefix("v")
            val releaseNotes = json.optString("body", "")
            val publishedAt = json.optString("published_at", "")
            val isPrerelease = json.optBoolean("prerelease", false)

            // Parse version code from tag name (e.g. "1.1.0" -> 10100)
            val versionCode = extractVersionCode(tagName)

            // Look for APK download URL and size in assets
            var apkDownloadUrl = ""
            var apkFileSize = 0L
            val assets = json.optJSONArray("assets")
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name", "")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkDownloadUrl = asset.optString("browser_download_url", "")
                        apkFileSize = asset.optLong("size", 0L)
                        break
                    }
                }
            }

            if (apkDownloadUrl.isBlank()) {
                apkDownloadUrl = json.optString("html_url", "")
            }

            ReleaseInfo(
                versionCode = versionCode,
                versionName = tagName,
                downloadUrl = apkDownloadUrl,
                releaseNotes = releaseNotes,
                publishedAt = publishedAt,
                fileSize = apkFileSize,
                isPrerelease = isPrerelease
            )
        } catch (_: Exception) {
            null
        }
    }

    internal fun extractVersionCode(versionName: String): Int {
        val cleanVersion = versionName.substringBefore("-").trim()
        val parts = cleanVersion.split(".").mapNotNull { it.filter { char -> char.isDigit() }.toIntOrNull() }
        return when (parts.size) {
            3 -> parts[0] * 10000 + parts[1] * 100 + parts[2]
            2 -> parts[0] * 10000 + parts[1] * 100
            1 -> parts[0]
            else -> 1
        }
    }
}
