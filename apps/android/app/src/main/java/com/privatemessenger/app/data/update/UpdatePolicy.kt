package com.privatemessenger.app.data.update

/**
 * Data structure representing remote release information.
 */
data class ReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val downloadUrl: String,
    val releaseNotes: String = "",
    val publishedAt: String = ""
) {
    var fileSize: Long = 0L
    var isPrerelease: Boolean = false

    constructor(
        versionCode: Int,
        versionName: String,
        downloadUrl: String,
        releaseNotes: String = "",
        publishedAt: String = "",
        fileSize: Long = 0L,
        isPrerelease: Boolean = false
    ) : this(versionCode, versionName, downloadUrl, releaseNotes, publishedAt) {
        this.fileSize = fileSize
        this.isPrerelease = isPrerelease
    }
}

/**
 * Pure functional policy determining whether an in-app update prompt or button
 * should be displayed to the user.
 */
object UpdatePolicy {

    /**
     * Evaluates update eligibility.
     *
     * RULES:
     * - If [isDebugBuild] is true, returns false. This strictly suppresses
     *   the update prompt on development test builds.
     * - If [remoteRelease] is null, returns false.
     * - If [remoteRelease].isPrerelease is true, returns false.
     * - If [remoteRelease].versionCode > [currentVersionCode], returns true.
     * - If [remoteRelease].versionName is newer than [currentVersionName], returns true.
     * - Otherwise, returns false.
     */
    fun shouldShowUpdate(
        currentVersionCode: Int,
        currentVersionName: String,
        isDebugBuild: Boolean,
        remoteRelease: ReleaseInfo?
    ): Boolean {
        // Strict suppression on debug / test builds
        if (isDebugBuild) {
            return false
        }

        if (remoteRelease == null) {
            return false
        }

        if (remoteRelease.isPrerelease) {
            return false
        }

        if (remoteRelease.versionCode > currentVersionCode) {
            return true
        }

        return isVersionNewer(remoteRelease.versionName, currentVersionName)
    }

    /**
     * Compares two semantic version strings (e.g. "1.0.1" vs "1.0.0").
     */
    fun isVersionNewer(remote: String, current: String): Boolean {
        val cleanRemote = remote.removePrefix("v").substringBefore("-").trim()
        val cleanCurrent = current.removePrefix("v").substringBefore("-").trim()

        val remoteParts = cleanRemote.split(".").mapNotNull { it.filter { c -> c.isDigit() }.toIntOrNull() }
        val currentParts = cleanCurrent.split(".").mapNotNull { it.filter { c -> c.isDigit() }.toIntOrNull() }

        val maxLen = maxOf(remoteParts.size, currentParts.size)
        for (i in 0 until maxLen) {
            val r = remoteParts.getOrElse(i) { 0 }
            val c = currentParts.getOrElse(i) { 0 }
            if (r > c) return true
            if (r < c) return false
        }
        return false
    }
}
