package com.privatemessenger.app.data.model

import java.util.UUID

enum class ThemeAccent(val key: String, val displayName: String, val primaryHex: Long, val outgoingHex: Long) {
    VIOLET_PINK("violet-pink", "Violet Pink", 0xFFE1306CL, 0xFFD82D7EL),
    OCEAN_BLUE("ocean-blue", "Ocean Blue", 0xFF0084FFL, 0xFF0077E6L),
    EMERALD("emerald", "Emerald", 0xFF10B981L, 0xFF059669L),
    CRIMSON("crimson", "Crimson", 0xFFEF4444L, 0xFFDC2626L),
    MONOCHROME("monochrome", "Monochrome", 0xFFE5E5E5L, 0xFF2E2E2EL);

    companion object {
        fun fromKey(key: String): ThemeAccent = entries.find { it.key == key } ?: VIOLET_PINK
    }
}

enum class MediaType(val key: String) {
    TEXT("text"),
    IMAGE("image"),
    VIDEO("video"),
    AUDIO("audio"),
    FILE("file"),
    STICKER("sticker"),
    GIF("gif")
}

enum class P2PTransferStatus(val key: String) {
    PENDING("pending"),
    TRANSFERRING("transferring"),
    COMPLETED("completed"),
    FAILED("failed"),
    CANCELLED("cancelled")
}

enum class CallType(val key: String) {
    AUDIO("audio"),
    VIDEO("video")
}

enum class CallStatus(val key: String) {
    RINGING("ringing"),
    ONGOING("ongoing"),
    ENDED("ended"),
    DECLINED("declined"),
    MISSED("missed")
}

enum class AudioRoute {
    EARPIECE,
    SPEAKER,
    BLUETOOTH,
    WIRED_HEADSET
}

enum class CallQuality(val label: String) {
    EXCELLENT("HD • Low Latency"),
    GOOD("Good"),
    POOR("Weak Network"),
    CONNECTING("Connecting...")
}

data class User(
    val id: String = UUID.randomUUID().toString(),
    val email: String,
    val displayName: String,
    val bio: String = "",
    val avatarUrl: String = "",
    val themeAccent: ThemeAccent = ThemeAccent.VIOLET_PINK,
    val chatBackgroundUrl: String = "",
    val role: String = "user",
    val isBanned: Boolean = false,
    val createdAt: String = "",
    val updatedAt: String = ""
)

data class Conversation(
    val id: String = UUID.randomUUID().toString(),
    val type: String = "direct",
    val title: String? = null,
    val avatarUrl: String? = null,
    val otherUser: User? = null,
    val lastMessage: Message? = null,
    val unreadCount: Int = 0,
    val createdAt: String = "",
    val updatedAt: String = ""
)

data class Message(
    val id: String = UUID.randomUUID().toString(),
    val conversationId: String,
    val senderId: String,
    val content: String = "",
    val mediaUrl: String = "",
    val mediaType: MediaType = MediaType.TEXT,
    val fileName: String = "",
    val fileSize: Long = 0L,
    val mimeType: String = "",
    val localUri: String = "",
    val fileHashSha256: String = "",
    val isP2pTransfer: Boolean = false,
    val transferId: String? = null,
    val transferStatus: P2PTransferStatus? = null,
    val transferProgress: Int = 0,
    val audioDurationSec: Int = 0,
    val isViewOnce: Boolean = false,
    val viewedAt: String? = null,
    val replyToId: String? = null,
    val replyToContent: String? = null,
    val replyToSenderName: String? = null,
    val deletedForEveryone: Boolean = false,
    val deletedAt: String? = null,
    val deletedBy: String? = null,
    val createdAt: String = "",
    val senderName: String = "",
    val reactions: List<Reaction> = emptyList()
) {
    val isPhotoViewOnce: Boolean
        get() = isViewOnce && mediaType == MediaType.IMAGE
}

data class Reaction(
    val id: String = UUID.randomUUID().toString(),
    val messageId: String,
    val userId: String,
    val emoji: String,
    val createdAt: String = ""
)

data class StickerPack(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val creatorId: String,
    val stickers: List<Sticker> = emptyList(),
    val createdAt: String = ""
)

data class Sticker(
    val id: String = UUID.randomUUID().toString(),
    val packId: String,
    val imageUrl: String,
    val createdAt: String = ""
)

data class P2PTransfer(
    val id: String = UUID.randomUUID().toString(),
    val conversationId: String,
    val senderId: String,
    val receiverId: String,
    val fileName: String,
    val fileSize: Long,
    val fileType: String,
    val fileHashSha256: String,
    val status: P2PTransferStatus = P2PTransferStatus.PENDING,
    val bytesTransferred: Long = 0L,
    val progressPercentage: Int = 0,
    val speedBytesPerSec: Long = 0L,
    val createdAt: String = ""
)

data class Call(
    val id: String = UUID.randomUUID().toString(),
    val conversationId: String,
    val callerId: String,
    val callerName: String = "",
    val callType: CallType = CallType.AUDIO,
    val roomName: String = "",
    val status: CallStatus = CallStatus.RINGING,
    val startedAt: String = "",
    val endedAt: String? = null
)
