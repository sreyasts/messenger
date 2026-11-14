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
)

/**
 * Pure functional policy determining whether an in-app update prompt or button
 * should be displayed to the user.
 */
object UpdatePolicy {

    /**
     * Evaluates update eligibility.
     *
     * CRITICAL RULE:
     * - If [isDebugBuild] is true, returns false ALWAYS. This strictly suppresses
     *   the update button on all test, debug, and development builds.
     * - If [remoteRelease] is null, returns false.
     * - If [remoteRelease].versionCode > [currentVersionCode], returns true.
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

        return remoteRelease.versionCode > currentVersionCode
    }
}
