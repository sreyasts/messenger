package com.privatemessenger.app

import com.privatemessenger.app.data.model.*
import com.privatemessenger.app.data.update.UpdateManager
import com.privatemessenger.app.webrtc.WebRtcTransferManager
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class AndroidArchitectureTest {

    @Test
    fun testThemeAccentTokens() {
        assertEquals(ThemeAccent.VIOLET_PINK, ThemeAccent.fromKey("violet-pink"))
        assertEquals(ThemeAccent.OCEAN_BLUE, ThemeAccent.fromKey("ocean-blue"))
        assertEquals(ThemeAccent.EMERALD, ThemeAccent.fromKey("emerald"))
        assertEquals(ThemeAccent.CRIMSON, ThemeAccent.fromKey("crimson"))
        assertEquals(ThemeAccent.MONOCHROME, ThemeAccent.fromKey("monochrome"))

        // Pure OLED Black & Accent color validation
        assertEquals(0xFFE1306CL, ThemeAccent.VIOLET_PINK.primaryHex)
        assertEquals(0xFF0084FFL, ThemeAccent.OCEAN_BLUE.primaryHex)
        assertEquals(0xFF10B981L, ThemeAccent.EMERALD.primaryHex)
        assertEquals(0xFFEF4444L, ThemeAccent.CRIMSON.primaryHex)
    }

    @Test
    fun testWebRtc1GBChunkConstants() {
        assertEquals(65536, WebRtcTransferManager.CHUNK_SIZE)
        assertEquals(4 * 1024 * 1024L, WebRtcTransferManager.BUFFER_THRESHOLD)
    }

    @Test
    fun testViewOnceRetentionContract() {
        val originalMessage = Message(
            id = "test-view-once",
            conversationId = "conv-1",
            senderId = "sender-1",
            content = "Secret view once photo",
            mediaUrl = "https://mock.supabase.co/storage/v1/object/public/chat-attachments/photo.jpg",
            isViewOnce = true,
            viewedAt = null
        )

        assertTrue(originalMessage.isViewOnce)
        assertNull(originalMessage.viewedAt)

        // Simulate viewing: viewedAt timestamp recorded, mediaUrl retained for admin safety inspection
        val viewedMessage = originalMessage.copy(viewedAt = "2026-11-14T12:00:00Z")
        assertNotNull(viewedMessage.viewedAt)
        assertEquals(originalMessage.mediaUrl, viewedMessage.mediaUrl)
        assertEquals("Secret view once photo", viewedMessage.content)
    }

    @Test
    fun testDeleteForEveryoneRetentionContract() {
        val originalMessage = Message(
            id = "test-delete",
            conversationId = "conv-1",
            senderId = "sender-1",
            content = "Sensitive message to delete",
            deletedForEveryone = false
        )

        assertFalse(originalMessage.deletedForEveryone)

        // Soft delete: flag set, content preserved in DB for safety/admin banning
        val deletedMessage = originalMessage.copy(
            deletedForEveryone = true,
            deletedAt = "2026-11-14T12:05:00Z",
            deletedBy = "sender-1"
        )
        assertTrue(deletedMessage.deletedForEveryone)
        assertEquals("Sensitive message to delete", deletedMessage.content)
        assertNotNull(deletedMessage.deletedAt)
        assertEquals("sender-1", deletedMessage.deletedBy)
    }

    @Test
    fun testP2PTransferStateProgression() {
        val transfer = P2PTransfer(
            id = "p2p-1",
            conversationId = "conv-1",
            senderId = "user-1",
            receiverId = "user-2",
            fileName = "movie.mp4",
            fileSize = 800_000_000L,
            fileType = "video/mp4",
            fileHashSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            status = P2PTransferStatus.PENDING
        )

        assertEquals(P2PTransferStatus.PENDING, transfer.status)

        val inProgress = transfer.copy(
            status = P2PTransferStatus.TRANSFERRING,
            bytesTransferred = 400_000_000L,
            progressPercentage = 50,
            speedBytesPerSec = 25_000_000L
        )
        assertEquals(50, inProgress.progressPercentage)
        assertEquals(P2PTransferStatus.TRANSFERRING, inProgress.status)

        val completed = inProgress.copy(
            status = P2PTransferStatus.COMPLETED,
            bytesTransferred = 800_000_000L,
            progressPercentage = 100
        )
        assertEquals(100, completed.progressPercentage)
        assertEquals(P2PTransferStatus.COMPLETED, completed.status)
    }

    @Test
    fun testWebRtcZeroByteFileTransferSafety() = runBlocking {
        val manager = WebRtcTransferManager()
        val zeroByteTransfer = P2PTransfer(
            id = "zero-byte-1",
            conversationId = "conv-1",
            senderId = "user-1",
            receiverId = "user-2",
            fileName = "empty.txt",
            fileSize = 0L,
            fileType = "text/plain",
            fileHashSha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )

        var progressReported = -1
        manager.simulateChunkedStreaming(zeroByteTransfer) { _, percent, _ ->
            progressReported = percent
        }

        val finalState = manager.transferState.value
        assertNotNull(finalState)
        assertEquals(P2PTransferStatus.COMPLETED, finalState?.status)
        assertEquals(100, finalState?.progressPercentage)
        assertEquals(100, progressReported)
    }

    @Test
    fun testWebRtcNonExistentFileSha256ReturnsEmpty() {
        val manager = WebRtcTransferManager()
        val nonExistent = File("non_existent_file_safeguard_${System.currentTimeMillis()}.tmp")
        val hash = manager.calculateSha256(nonExistent)
        assertEquals("", hash)
    }

    @Test
    fun testUpdateManagerPreReleaseVersionCodeExtraction() {
        val manager = UpdateManager()
        // 1 * 10000 + 2 * 100 + 3 = 10203 (must not be contaminated by -beta1)
        val betaCode = manager.extractVersionCode("1.2.3-beta1")
        assertEquals(10203, betaCode)

        val stableCode = manager.extractVersionCode("1.2.0")
        assertEquals(10200, stableCode)

        val rcCode = manager.extractVersionCode("2.0.0-rc2")
        assertEquals(20000, rcCode)
    }
}
