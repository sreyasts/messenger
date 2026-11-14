package com.privatemessenger.app

import com.privatemessenger.app.data.update.ReleaseInfo
import com.privatemessenger.app.data.update.UpdatePolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for [UpdatePolicy] logic enforcing in-app update rules and
 * debug build update suppression.
 */
class UpdatePolicyTest {

    @Test
    fun testDebugBuildAlwaysSuppressesUpdateEvenIfNewerVersionExists() {
        val currentVersionCode = 1
        val currentVersionName = "1.0.0"
        val isDebugBuild = true

        val newerRemoteRelease = ReleaseInfo(
            versionCode = 2,
            versionName = "1.1.0",
            downloadUrl = "https://github.com/privatemessenger/messenger/releases/download/v1.1.0/app-release.apk",
            releaseNotes = "Major speed improvements for WebRTC transfers"
        )

        val shouldShow = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = isDebugBuild,
            remoteRelease = newerRemoteRelease
        )

        // Must strictly suppress on debug builds
        assertFalse("Debug builds must NEVER show the in-app update notification", shouldShow)
    }

    @Test
    fun testReleaseBuildShowsUpdateWhenNewerVersionAvailable() {
        val currentVersionCode = 1
        val currentVersionName = "1.0.0"
        val isDebugBuild = false

        val newerRemoteRelease = ReleaseInfo(
            versionCode = 2,
            versionName = "1.1.0",
            downloadUrl = "https://github.com/privatemessenger/messenger/releases/download/v1.1.0/app-release.apk",
            releaseNotes = "New features available"
        )

        val shouldShow = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = isDebugBuild,
            remoteRelease = newerRemoteRelease
        )

        assertTrue("Release build must show update when remote versionCode is greater", shouldShow)
    }

    @Test
    fun testReleaseBuildSuppressesUpdateWhenVersionIsEqual() {
        val currentVersionCode = 2
        val currentVersionName = "1.1.0"
        val isDebugBuild = false

        val sameRemoteRelease = ReleaseInfo(
            versionCode = 2,
            versionName = "1.1.0",
            downloadUrl = "https://github.com/privatemessenger/messenger/releases/download/v1.1.0/app-release.apk"
        )

        val shouldShow = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = isDebugBuild,
            remoteRelease = sameRemoteRelease
        )

        assertFalse("Release build must not show update when versions are equal", shouldShow)
    }

    @Test
    fun testReleaseBuildSuppressesUpdateWhenVersionIsOlder() {
        val currentVersionCode = 3
        val currentVersionName = "1.2.0"
        val isDebugBuild = false

        val olderRemoteRelease = ReleaseInfo(
            versionCode = 2,
            versionName = "1.1.0",
            downloadUrl = "https://github.com/privatemessenger/messenger/releases/download/v1.1.0/app-release.apk"
        )

        val shouldShow = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = isDebugBuild,
            remoteRelease = olderRemoteRelease
        )

        assertFalse("Release build must not show update when remote version is older", shouldShow)
    }

    @Test
    fun testNullRemoteReleaseReturnsFalse() {
        val currentVersionCode = 1
        val currentVersionName = "1.0.0"

        val shouldShowInRelease = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = false,
            remoteRelease = null
        )

        val shouldShowInDebug = UpdatePolicy.shouldShowUpdate(
            currentVersionCode = currentVersionCode,
            currentVersionName = currentVersionName,
            isDebugBuild = true,
            remoteRelease = null
        )

        assertFalse("Null release in release build must return false", shouldShowInRelease)
        assertFalse("Null release in debug build must return false", shouldShowInDebug)
    }
}
