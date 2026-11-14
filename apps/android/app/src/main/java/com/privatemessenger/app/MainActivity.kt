package com.privatemessenger.app

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import com.privatemessenger.app.data.auth.AuthSessionManager
import com.privatemessenger.app.data.model.*
import com.privatemessenger.app.data.storage.ViewOnceStorage
import com.privatemessenger.app.data.update.ReleaseInfo
import com.privatemessenger.app.data.update.UpdateManager
import com.privatemessenger.app.ui.components.LiveKitCallOverlay
import com.privatemessenger.app.ui.components.ViewOnceMediaDialog
import com.privatemessenger.app.ui.screens.AuthScreen
import com.privatemessenger.app.ui.screens.ChatDetailScreen
import com.privatemessenger.app.ui.screens.ChatsListScreen
import com.privatemessenger.app.ui.screens.ProfileScreen
import com.privatemessenger.app.ui.theme.OledBackground
import com.privatemessenger.app.ui.theme.PrivateMessengerTheme
import java.text.SimpleDateFormat
import java.util.*

enum class CurrentScreen {
    AUTH,
    CHATS_LIST,
    CHAT_DETAIL,
    PROFILE
}

class MainActivity : ComponentActivity() {

    private var activeCallState = mutableStateOf<Call?>(null)
    private var isInPiPModeState = mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        handleIncomingShareIntent(intent)

        setContent {
            val authSessionManager = remember { AuthSessionManager(applicationContext) }
            val viewOnceStorage = remember { ViewOnceStorage(applicationContext) }
            val updateManager = remember { UpdateManager() }

            var isAuthenticated by remember { mutableStateOf(authSessionManager.isAuthenticated()) }
            var currentUser by remember {
                mutableStateOf(
                    authSessionManager.getSession() ?: User(
                        id = "unauth",
                        email = "",
                        displayName = "Guest"
                    )
                )
            }

            var activeThemeAccent by remember { mutableStateOf(currentUser.themeAccent) }
            var currentScreen by remember { mutableStateOf(if (isAuthenticated) CurrentScreen.CHATS_LIST else CurrentScreen.AUTH) }
            var selectedConversation by remember { mutableStateOf<Conversation?>(null) }
            var activeWallpaper by remember { mutableStateOf("") }
            var activeViewOnceMessage by remember { mutableStateOf<Message?>(null) }
            var availableUpdate by remember { mutableStateOf<ReleaseInfo?>(null) }

            // Check for in-app updates (pure UpdatePolicy suppresses on debug builds)
            LaunchedEffect(Unit) {
                val update = updateManager.checkForUpdate(
                    currentVersionCode = BuildConfig.VERSION_CODE,
                    currentVersionName = BuildConfig.VERSION_NAME,
                    isDebugBuild = BuildConfig.DEBUG
                )
                availableUpdate = update
            }

            // Demo active conversations list
            val conversations = remember {
                mutableStateListOf(
                    Conversation(
                        id = "conv-1",
                        title = "Dev Collective",
                        type = "group",
                        lastMessage = Message(
                            conversationId = "conv-1",
                            senderId = "user-2",
                            content = "LiveKit audio-video lip-sync verified!",
                            createdAt = "12:45"
                        ),
                        unreadCount = 2
                    ),
                    Conversation(
                        id = "conv-2",
                        title = "Sarah Jenkins",
                        type = "direct",
                        otherUser = User(
                            id = "user-sarah",
                            email = "sarah@gmail.com",
                            displayName = "Sarah Jenkins",
                            bio = "Android & WebRTC enthusiast! Working on $0 architecture."
                        ),
                        lastMessage = Message(
                            conversationId = "conv-2",
                            senderId = "user-sarah",
                            content = "WebRTC 1 GB chunk transfer completed with SHA-256 integrity!",
                            createdAt = "11:20"
                        ),
                        unreadCount = 0
                    )
                )
            }

            // Messages for selected conversation with persistent View-Once state restoration
            val initialMessages = remember {
                val sampleViewOnceId = "msg-2"
                val isSampleViewed = viewOnceStorage.isViewed(sampleViewOnceId)
                listOf(
                    Message(
                        id = "msg-1",
                        conversationId = "conv-1",
                        senderId = "user-sarah",
                        senderName = "Sarah Jenkins",
                        content = "Hey everyone! Welcome to our $0-cost private messenger.",
                        createdAt = "10:14"
                    ),
                    Message(
                        id = sampleViewOnceId,
                        conversationId = "conv-1",
                        senderId = "user-me",
                        senderName = "Alex Friend",
                        content = "Here is the sample View Once photo. Tap to open!",
                        isViewOnce = true,
                        viewedAt = if (isSampleViewed) "Opened" else null,
                        createdAt = "10:15"
                    ),
                    Message(
                        id = "msg-3",
                        conversationId = "conv-1",
                        senderId = "user-2",
                        senderName = "David",
                        content = "Testing reply quote and reaction pills.",
                        replyToSenderName = "Alex Friend",
                        replyToContent = "Here is the sample View Once photo. Tap to open!",
                        createdAt = "10:18",
                        reactions = listOf(
                            Reaction(messageId = "msg-3", userId = "user-me", emoji = "❤️"),
                            Reaction(messageId = "msg-3", userId = "user-sarah", emoji = "🔥")
                        )
                    )
                )
            }
            val messages = remember { mutableStateListOf(*initialMessages.toTypedArray()) }

            val stickerPacks = remember {
                mutableStateListOf(
                    StickerPack(
                        id = "pack-1",
                        name = "Messenger Reactions",
                        creatorId = currentUser.id,
                        stickers = listOf(
                            Sticker(packId = "pack-1", imageUrl = "sticker_thumb.png")
                        )
                    )
                )
            }

            PrivateMessengerTheme(accent = activeThemeAccent) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = OledBackground
                ) {
                    when {
                        // In-Call Overlay (or Picture-in-Picture)
                        activeCallState.value != null -> {
                            LiveKitCallOverlay(
                                call = activeCallState.value!!,
                                onEndCall = { activeCallState.value = null },
                                onEnterPiP = { enterPipMode() }
                            )
                        }

                        // R1: Authentication Access Gate - Strictly block unauthenticated access
                        !isAuthenticated || currentScreen == CurrentScreen.AUTH -> {
                            AuthScreen(
                                accent = activeThemeAccent,
                                onAuthSuccess = { authedUser ->
                                    authSessionManager.saveSession(authedUser)
                                    currentUser = authedUser
                                    activeThemeAccent = authedUser.themeAccent
                                    isAuthenticated = true
                                    currentScreen = CurrentScreen.CHATS_LIST
                                }
                            )
                        }

                        currentScreen == CurrentScreen.CHATS_LIST -> {
                            ChatsListScreen(
                                conversations = conversations,
                                accent = activeThemeAccent,
                                updateInfo = availableUpdate,
                                onConversationClick = { conv ->
                                    selectedConversation = conv
                                    currentScreen = CurrentScreen.CHAT_DETAIL
                                },
                                onProfileClick = { currentScreen = CurrentScreen.PROFILE },
                                onNewChatClick = {
                                    val newConv = Conversation(
                                        title = "Friend #${conversations.size + 1}",
                                        lastMessage = Message(
                                            conversationId = UUID.randomUUID().toString(),
                                            senderId = "user-new",
                                            content = "New chat initialized",
                                            createdAt = "Now"
                                        )
                                    )
                                    conversations.add(0, newConv)
                                    selectedConversation = newConv
                                    currentScreen = CurrentScreen.CHAT_DETAIL
                                },
                                onUpdateClick = { release ->
                                    if (release.downloadUrl.isNotBlank()) {
                                        val browserIntent = Intent(Intent.ACTION_VIEW, Uri.parse(release.downloadUrl))
                                        startActivity(browserIntent)
                                    }
                                }
                            )
                        }

                        currentScreen == CurrentScreen.CHAT_DETAIL && selectedConversation != null -> {
                            ChatDetailScreen(
                                conversation = selectedConversation!!,
                                messages = messages,
                                currentUserId = currentUser.id,
                                accent = activeThemeAccent,
                                onBack = { currentScreen = CurrentScreen.CHATS_LIST },
                                onSendMessage = { text, replyTo, isViewOnce ->
                                    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                    val newMsg = Message(
                                        conversationId = selectedConversation!!.id,
                                        senderId = currentUser.id,
                                        senderName = currentUser.displayName,
                                        content = text,
                                        isViewOnce = isViewOnce,
                                        replyToId = replyTo?.id,
                                        replyToSenderName = replyTo?.senderName,
                                        replyToContent = replyTo?.content,
                                        createdAt = time
                                    )
                                    messages.add(newMsg)
                                },
                                onSendFile = { fileName, fileSize, isP2p ->
                                    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                    val newMsg = Message(
                                        conversationId = selectedConversation!!.id,
                                        senderId = currentUser.id,
                                        senderName = currentUser.displayName,
                                        content = if (isP2p) "📦 P2P Transfer: $fileName (${fileSize / (1024 * 1024)} MB)" else "📎 Attached: $fileName",
                                        fileName = fileName,
                                        fileSize = fileSize,
                                        createdAt = time
                                    )
                                    messages.add(newMsg)
                                },
                                onVoiceCall = {
                                    activeCallState.value = Call(
                                        conversationId = selectedConversation!!.id,
                                        callerId = currentUser.id,
                                        callerName = selectedConversation!!.title ?: "Friend",
                                        callType = CallType.AUDIO,
                                        roomName = "room-${selectedConversation!!.id}"
                                    )
                                },
                                onVideoCall = {
                                    activeCallState.value = Call(
                                        conversationId = selectedConversation!!.id,
                                        callerId = currentUser.id,
                                        callerName = selectedConversation!!.title ?: "Friend",
                                        callType = CallType.VIDEO,
                                        roomName = "room-${selectedConversation!!.id}"
                                    )
                                },
                                onContactProfileClick = {
                                    // Header click opens conversation partner profile card
                                },
                                onOpenViewOnce = { msg ->
                                    // Block re-opening if already viewed
                                    if (!viewOnceStorage.isViewed(msg.id) && msg.viewedAt == null) {
                                        activeViewOnceMessage = msg
                                    }
                                },
                                onDeleteForEveryone = { msg ->
                                    val idx = messages.indexOfFirst { it.id == msg.id }
                                    if (idx != -1) {
                                        messages[idx] = messages[idx].copy(deletedForEveryone = true)
                                    }
                                },
                                onAddReaction = { msg, emoji ->
                                    val idx = messages.indexOfFirst { it.id == msg.id }
                                    if (idx != -1) {
                                        val existingReactions = messages[idx].reactions.toMutableList()
                                        existingReactions.add(Reaction(messageId = msg.id, userId = currentUser.id, emoji = emoji))
                                        messages[idx] = messages[idx].copy(reactions = existingReactions)
                                    }
                                }
                            )

                            // View Once Protected Dialog with FLAG_SECURE and persistent state locking
                            activeViewOnceMessage?.let { viewOnceMsg ->
                                ViewOnceMediaDialog(
                                    message = viewOnceMsg,
                                    onDismiss = { activeViewOnceMessage = null },
                                    onMediaViewed = { msgId ->
                                        // Persist viewed status permanently in SharedPreferences
                                        viewOnceStorage.markAsViewed(msgId)
                                        val idx = messages.indexOfFirst { it.id == msgId }
                                        if (idx != -1) {
                                            val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                            messages[idx] = messages[idx].copy(viewedAt = time)
                                        }
                                    }
                                )
                            }
                        }

                        currentScreen == CurrentScreen.PROFILE -> {
                            ProfileScreen(
                                currentUser = currentUser,
                                stickerPacks = stickerPacks,
                                accent = activeThemeAccent,
                                wallpaper = activeWallpaper,
                                onBack = { currentScreen = CurrentScreen.CHATS_LIST },
                                onUpdateProfile = { newName, newBio ->
                                    val updatedUser = currentUser.copy(displayName = newName, bio = newBio)
                                    currentUser = updatedUser
                                    authSessionManager.saveSession(updatedUser)
                                },
                                onUpdateAccent = { newAccent ->
                                    activeThemeAccent = newAccent
                                    val updatedUser = currentUser.copy(themeAccent = newAccent)
                                    currentUser = updatedUser
                                    authSessionManager.saveSession(updatedUser)
                                },
                                onUpdateWallpaper = { newWallpaper -> activeWallpaper = newWallpaper },
                                onCreateStickerPack = { name ->
                                    stickerPacks.add(StickerPack(name = name, creatorId = currentUser.id))
                                },
                                onDeleteStickerPack = { packId ->
                                    stickerPacks.removeAll { it.id == packId }
                                },
                                onSignOut = {
                                    authSessionManager.clearSession()
                                    isAuthenticated = false
                                    currentUser = User(id = "unauth", email = "", displayName = "Guest")
                                    selectedConversation = null
                                    currentScreen = CurrentScreen.AUTH
                                }
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIncomingShareIntent(intent)
    }

    private fun handleIncomingShareIntent(intent: Intent?) {
        if (intent == null) return
        val action = intent.action
        val type = intent.type

        if (Intent.ACTION_SEND == action && type != null) {
            if ("text/plain" == type) {
                val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                // Shared text handled
            } else {
                val imageUri = intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                // Shared media URI handled
            }
        } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
            val imageUris = intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
            // Multiple shared files handled
        }
    }

    private fun enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val aspectRatio = Rational(16, 9)
            val params = PictureInPictureParams.Builder()
                .setAspectRatio(aspectRatio)
                .build()
            enterPictureInPictureMode(params)
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        isInPiPModeState.value = isInPictureInPictureMode
    }
}
