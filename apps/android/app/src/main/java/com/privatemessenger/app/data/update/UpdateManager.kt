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
    private val repoOwner: String = "privatemessenger",
    private val repoName: String = "messenger"
) {

    /**
     * Checks if a new release is available and whether it should be shown
     * according to [UpdatePolicy].
     *
     * @return [ReleaseInfo] if an update should be displayed to the user, or null if suppressed or up-to-date.
     */
    suspend fun checkForUpdate(
        currentVersionCode: Int,
        currentVersionName: String,
        isDebugBuild: Boolean
    ): ReleaseInfo? = withContext(Dispatchers.IO) {
        // Fast-path: if debug build, UpdatePolicy will suppress anyway
        if (UpdatePolicy.shouldShowUpdate(currentVersionCode, currentVersionName, isDebugBuild, null)) {
            // Cannot show without release
            return@withContext null
        }
        if (isDebugBuild) {
            return@withContext null
        }

        val remoteRelease = fetchLatestRelease() ?: return@withContext null

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
            connection.connectTimeout = 5000
            connection.readTimeout = 5000
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

            // Parse version code from tag name (e.g. "1.1.0" -> 10100 or numeric extraction)
            val versionCode = extractVersionCode(tagName)

            // Look for APK download URL in assets
            var apkDownloadUrl = ""
            val assets = json.optJSONArray("assets")
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val asset = assets.getJSONObject(i)
                    val name = asset.optString("name", "")
                    if (name.endsWith(".apk", ignoreCase = true)) {
                        apkDownloadUrl = asset.optString("browser_download_url", "")
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
                publishedAt = publishedAt
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun extractVersionCode(versionName: String): Int {
        val parts = versionName.split(".").mapNotNull { it.filter { char -> char.isDigit() }.toIntOrNull() }
        return when (parts.size) {
            3 -> parts[0] * 10000 + parts[1] * 100 + parts[2]
            2 -> parts[0] * 10000 + parts[1] * 100
            1 -> parts[0]
            else -> 1
        }
    }
}
