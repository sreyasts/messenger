package com.privatemessenger.app

import android.app.PictureInPictureParams
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Rational
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.work.Data
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import com.privatemessenger.app.data.auth.AuthSessionManager
import com.privatemessenger.app.data.media.InspectedFile
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.model.*
import com.privatemessenger.app.data.remote.SupabaseSyncClient
import com.privatemessenger.app.data.storage.MessageStorage
import com.privatemessenger.app.data.storage.ViewOnceStorage
import com.privatemessenger.app.data.update.InAppUpdateDownloader
import com.privatemessenger.app.data.update.ReleaseInfo
import com.privatemessenger.app.data.update.UpdateManager
import com.privatemessenger.app.telecom.CallForegroundService
import com.privatemessenger.app.telecom.CallNotificationManager
import com.privatemessenger.app.telecom.CallStateBus
import com.privatemessenger.app.ui.components.LiveKitCallOverlay
import com.privatemessenger.app.ui.components.ViewOnceMediaDialog
import com.privatemessenger.app.ui.screens.AuthScreen
import com.privatemessenger.app.ui.screens.ChatDetailScreen
import com.privatemessenger.app.ui.screens.ChatsListScreen
import com.privatemessenger.app.ui.screens.ProfileScreen
import com.privatemessenger.app.ui.theme.OledBackground
import com.privatemessenger.app.ui.theme.PrivateMessengerTheme
import com.privatemessenger.app.webrtc.P2PTransferRegistry
import com.privatemessenger.app.work.FileTransferWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.time.Instant
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
    private var pendingSharedText = mutableStateOf<String?>(null)
    private var pendingSharedUris = mutableStateListOf<Uri>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        handleIncomingShareIntent(intent)
        handleCallIntent(intent)

        setContent {
            val authSessionManager = remember { AuthSessionManager(applicationContext) }
            val viewOnceStorage = remember { ViewOnceStorage(applicationContext) }
            val messageStorage = remember { MessageStorage(applicationContext) }
            val updateManager = remember { UpdateManager() }
            val workManager = remember { WorkManager.getInstance(applicationContext) }
            val coroutineScope = rememberCoroutineScope()

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
            var activeWallpaper by remember { mutableStateOf(currentUser.chatBackgroundUrl.ifBlank { "pure-black" }) }
            var activeViewOnceMessage by remember { mutableStateOf<Message?>(null) }
            var availableUpdate by remember { mutableStateOf<ReleaseInfo?>(null) }
            var updateDownloadState by remember {
                mutableStateOf<InAppUpdateDownloader.DownloadState>(InAppUpdateDownloader.DownloadState.Idle)
            }

            // Listen for notification/lockscreen call actions
            LaunchedEffect(Unit) {
                CallStateBus.events.collect { event ->
                    when (event) {
                        is CallStateBus.Event.EndCallRequested -> {
                            activeCallState.value = null
                            stopCallService()
                        }
                        is CallStateBus.Event.DeclineCallRequested -> {
                            activeCallState.value = null
                            stopCallService()
                        }
                        is CallStateBus.Event.AnswerCallRequested -> {
                            activeCallState.value = event.call
                            startCallService(event.call)
                        }
                        else -> Unit
                    }
                }
            }

            // Checks for in-app updates against GitHub Releases API
            val triggerUpdateCheck: (Boolean) -> Unit = { force ->
                coroutineScope.launch {
                    val update = updateManager.checkForUpdate(
                        currentVersionCode = BuildConfig.VERSION_CODE,
                        currentVersionName = BuildConfig.VERSION_NAME,
                        isDebugBuild = BuildConfig.DEBUG,
                        forceCheck = force
                    )
                    availableUpdate = update
                }
            }

            LaunchedEffect(Unit) {
                triggerUpdateCheck(false)
            }

            // Fast in-app APK download and direct package installation (zero browser redirection)
            val startInAppDownloadAndInstall: (ReleaseInfo) -> Unit = { release ->
                if (updateDownloadState is InAppUpdateDownloader.DownloadState.ReadyToInstall) {
                    val apkFile = (updateDownloadState as InAppUpdateDownloader.DownloadState.ReadyToInstall).apkFile
                    if (InAppUpdateDownloader.canRequestPackageInstalls(this@MainActivity)) {
                        InAppUpdateDownloader.installApk(this@MainActivity, apkFile)
                    } else {
                        InAppUpdateDownloader.openUnknownAppSourcesSettings(this@MainActivity)
                    }
                } else {
                    coroutineScope.launch {
                        updateDownloadState = InAppUpdateDownloader.DownloadState.Downloading(0f, 0L, 0L, 0L)
                        val result = InAppUpdateDownloader.downloadApk(
                            context = this@MainActivity,
                            downloadUrl = release.downloadUrl,
                            onProgress = { progress, downloaded, total, speed ->
                                updateDownloadState = InAppUpdateDownloader.DownloadState.Downloading(progress, downloaded, total, speed)
                            }
                        )
                        result.fold(
                            onSuccess = { file ->
                                updateDownloadState = InAppUpdateDownloader.DownloadState.ReadyToInstall(file)
                                if (InAppUpdateDownloader.canRequestPackageInstalls(this@MainActivity)) {
                                    InAppUpdateDownloader.installApk(this@MainActivity, file)
                                } else {
                                    InAppUpdateDownloader.openUnknownAppSourcesSettings(this@MainActivity)
                                }
                            },
                            onFailure = { error ->
                                updateDownloadState = InAppUpdateDownloader.DownloadState.Error(error.localizedMessage ?: "Download failed")
                            }
                        )
                    }
                }
            }

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

            // Seed initial conversation messages in durable MessageStorage if empty
            LaunchedEffect(Unit) {
                val sampleViewOnceId = "msg-view-once-photo-1"
                val defaultConv1 = listOf(
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
                        senderId = "user-sarah",
                        senderName = "Sarah Jenkins",
                        content = "",
                        mediaUrl = "sample://view-once-photo",
                        mediaType = MediaType.IMAGE,
                        fileName = "sunset_preview.jpg",
                        fileSize = 1_240_000L,
                        mimeType = "image/jpeg",
                        isViewOnce = true,
                        viewedAt = viewOnceStorage.getViewedAt(sampleViewOnceId),
                        createdAt = "10:15"
                    ),
                    Message(
                        id = "msg-3",
                        conversationId = "conv-1",
                        senderId = "user-2",
                        senderName = "David",
                        content = "Testing reply quote and reaction pills.",
                        replyToId = "msg-1",
                        replyToSenderName = "Sarah Jenkins",
                        replyToContent = "Hey everyone! Welcome to our $0-cost private messenger.",
                        createdAt = "10:18",
                        reactions = listOf(
                            Reaction(messageId = "msg-3", userId = "user-me", emoji = "❤️"),
                            Reaction(messageId = "msg-3", userId = "user-sarah", emoji = "🔥")
                        )
                    )
                )
                messageStorage.seedIfEmpty("conv-1", defaultConv1, viewOnceStorage)

                val defaultConv2 = listOf(
                    Message(
                        id = "msg-c2-1",
                        conversationId = "conv-2",
                        senderId = "user-sarah",
                        senderName = "Sarah Jenkins",
                        content = "WebRTC 1 GB chunk transfer completed with SHA-256 integrity!",
                        createdAt = "11:20"
                    )
                )
                messageStorage.seedIfEmpty("conv-2", defaultConv2, viewOnceStorage)
            }

            val currentConversationMessages = remember { mutableStateListOf<Message>() }

            // Whenever active conversation changes, reload its messages from storage
            LaunchedEffect(selectedConversation?.id) {
                currentConversationMessages.clear()
                selectedConversation?.let { conv ->
                    val stored = messageStorage.getMessages(conv.id, viewOnceStorage)
                    currentConversationMessages.addAll(stored)
                }
            }

            // Helper to update conversation preview
            val updateConversationLastMessage: (String, Message) -> Unit = { convId, msg ->
                val idx = conversations.indexOfFirst { it.id == convId }
                if (idx != -1) {
                    conversations[idx] = conversations[idx].copy(lastMessage = msg, unreadCount = 0)
                }
            }

            // Enqueue WorkManager transfer & persist real attachment message
            val enqueueAttachmentTransfer: (Conversation, InspectedFile, String, Boolean, Boolean) -> Unit = { conv, inspected, caption, isViewOnce, useP2p ->
                val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                val transferId = UUID.randomUUID().toString()
                val safeViewOnce = isViewOnce && inspected.mediaType == MediaType.IMAGE && !useP2p
                val localSource = inspected.localCachePath.ifBlank { inspected.uri.toString() }

                val newMsg = Message(
                    conversationId = conv.id,
                    senderId = currentUser.id,
                    senderName = currentUser.displayName,
                    content = caption,
                    mediaUrl = localSource,
                    localUri = localSource,
                    mediaType = inspected.mediaType,
                    fileName = inspected.fileName,
                    fileSize = inspected.fileSize,
                    mimeType = inspected.mimeType,
                    fileHashSha256 = inspected.sha256,
                    isP2pTransfer = useP2p,
                    transferId = transferId,
                    transferStatus = P2PTransferStatus.TRANSFERRING,
                    transferProgress = 0,
                    isViewOnce = safeViewOnce,
                    createdAt = time
                )

                currentConversationMessages.add(newMsg)
                messageStorage.saveMessage(newMsg, viewOnceStorage)
                updateConversationLastMessage(conv.id, newMsg)

                val p2pRecord = P2PTransfer(
                    id = transferId,
                    conversationId = conv.id,
                    senderId = currentUser.id,
                    receiverId = conv.otherUser?.id ?: "peer",
                    fileName = inspected.fileName,
                    fileSize = inspected.fileSize,
                    fileType = inspected.mimeType,
                    fileHashSha256 = inspected.sha256,
                    status = P2PTransferStatus.TRANSFERRING
                )
                P2PTransferRegistry.updateTransfer(p2pRecord)

                val inputData = Data.Builder()
                    .putString(FileTransferWorker.KEY_TRANSFER_ID, transferId)
                    .putString(FileTransferWorker.KEY_CONVERSATION_ID, conv.id)
                    .putString(FileTransferWorker.KEY_SENDER_ID, currentUser.id)
                    .putString(FileTransferWorker.KEY_RECEIVER_ID, conv.otherUser?.id ?: "peer")
                    .putString(FileTransferWorker.KEY_FILE_URI, inspected.uri.toString())
                    .putString(FileTransferWorker.KEY_FILE_NAME, inspected.fileName)
                    .putLong(FileTransferWorker.KEY_FILE_SIZE, inspected.fileSize)
                    .putString(FileTransferWorker.KEY_MIME_TYPE, inspected.mimeType)
                    .putString(FileTransferWorker.KEY_FILE_HASH, inspected.sha256)
                    .putBoolean(FileTransferWorker.KEY_IS_P2P, useP2p)
                    .build()

                val workReq = OneTimeWorkRequestBuilder<FileTransferWorker>()
                    .setInputData(inputData)
                    .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                    .build()
                workManager.enqueue(workReq)

                coroutineScope.launch(Dispatchers.IO) {
                    if (useP2p) {
                        SupabaseSyncClient.upsertP2pTransfer(null, p2pRecord)
                    }
                    SupabaseSyncClient.insertMessage(null, newMsg)
                }
            }

            // Process Android Share Sheet intents once authenticated
            LaunchedEffect(isAuthenticated, pendingSharedText.value, pendingSharedUris.size) {
                if (isAuthenticated && (pendingSharedText.value != null || pendingSharedUris.isNotEmpty())) {
                    val targetConv = selectedConversation ?: conversations.firstOrNull()
                    if (targetConv != null) {
                        selectedConversation = targetConv
                        currentScreen = CurrentScreen.CHAT_DETAIL
                        val text = pendingSharedText.value
                        if (!text.isNullOrBlank()) {
                            pendingSharedText.value = null
                            val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                            val msg = Message(
                                conversationId = targetConv.id,
                                senderId = currentUser.id,
                                senderName = currentUser.displayName,
                                content = text,
                                createdAt = time
                            )
                            messageStorage.saveMessage(msg, viewOnceStorage)
                            currentConversationMessages.add(msg)
                            updateConversationLastMessage(targetConv.id, msg)
                        }
                        if (pendingSharedUris.isNotEmpty()) {
                            val urisToProcess = pendingSharedUris.toList()
                            pendingSharedUris.clear()
                            urisToProcess.forEach { uri ->
                                MediaFileInspector.inspectAndCache(
                                    context = this@MainActivity,
                                    uri = uri,
                                    persistLocalCopy = true,
                                    computeSha256 = true
                                ).onSuccess { inspected ->
                                    val useP2p = inspected.fileSize > MediaFileInspector.MAX_SUPABASE_STORAGE_BYTES
                                    enqueueAttachmentTransfer(targetConv, inspected, "", false, useP2p)
                                }
                            }
                        }
                    }
                }
            }

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
                BackHandler(
                    enabled = (isAuthenticated && currentScreen != CurrentScreen.CHATS_LIST) ||
                        activeCallState.value != null ||
                        activeViewOnceMessage != null
                ) {
                    when {
                        activeViewOnceMessage != null -> activeViewOnceMessage = null
                        activeCallState.value != null -> enterPipMode()
                        currentScreen == CurrentScreen.CHAT_DETAIL -> {
                            currentScreen = CurrentScreen.CHATS_LIST
                            selectedConversation = null
                        }
                        currentScreen == CurrentScreen.PROFILE -> {
                            currentScreen = CurrentScreen.CHATS_LIST
                        }
                    }
                }

                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = OledBackground
                ) {
                    when {
                        activeCallState.value != null -> {
                            val activeCall = activeCallState.value!!
                            LiveKitCallOverlay(
                                call = activeCall,
                                participantIdentity = currentUser.id,
                                participantName = currentUser.displayName,
                                isInPiPMode = isInPiPModeState.value,
                                onEndCall = {
                                    activeCallState.value = null
                                    stopCallService()
                                },
                                onEnterPiP = { enterPipMode() }
                            )
                        }

                        // Strict Google Sign-In Gate
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
                                currentUser = currentUser,
                                accent = activeThemeAccent,
                                updateInfo = availableUpdate,
                                updateDownloadState = updateDownloadState,
                                onConversationClick = { conv ->
                                    val idx = conversations.indexOfFirst { it.id == conv.id }
                                    if (idx != -1 && conversations[idx].unreadCount > 0) {
                                        conversations[idx] = conversations[idx].copy(unreadCount = 0)
                                    }
                                    selectedConversation = conv
                                    currentScreen = CurrentScreen.CHAT_DETAIL
                                },
                                onProfileClick = { currentScreen = CurrentScreen.PROFILE },
                                onNewChatClick = { contactName, contactEmail ->
                                    val convId = "conv-${UUID.randomUUID().toString().take(8)}"
                                    val newConv = Conversation(
                                        id = convId,
                                        title = contactName,
                                        type = "direct",
                                        otherUser = User(
                                            id = "user-${UUID.randomUUID().toString().take(8)}",
                                            email = contactEmail,
                                            displayName = contactName
                                        ),
                                        lastMessage = Message(
                                            conversationId = convId,
                                            senderId = currentUser.id,
                                            content = "New encrypted chat initialized",
                                            createdAt = "Now"
                                        )
                                    )
                                    conversations.add(0, newConv)
                                    selectedConversation = newConv
                                    currentScreen = CurrentScreen.CHAT_DETAIL
                                },
                                onUpdateClick = startInAppDownloadAndInstall
                            )
                        }

                        currentScreen == CurrentScreen.CHAT_DETAIL && selectedConversation != null -> {
                            val activeConv = selectedConversation!!
                            ChatDetailScreen(
                                conversation = activeConv,
                                messages = currentConversationMessages,
                                currentUserId = currentUser.id,
                                accent = activeThemeAccent,
                                stickerPacks = stickerPacks,
                                wallpaper = activeWallpaper,
                                onBack = {
                                    currentScreen = CurrentScreen.CHATS_LIST
                                    selectedConversation = null
                                },
                                isViewOnceViewed = { id -> viewOnceStorage.isViewed(id) },
                                onSendMessage = { text, replyTo ->
                                    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                    val newMsg = Message(
                                        conversationId = activeConv.id,
                                        senderId = currentUser.id,
                                        senderName = currentUser.displayName,
                                        content = text,
                                        mediaType = MediaType.TEXT,
                                        isViewOnce = false,
                                        replyToId = replyTo?.id,
                                        replyToSenderName = replyTo?.senderName,
                                        replyToContent = replyTo?.let {
                                            if (it.isViewOnce) "1 Photo • View Once" else it.content.ifBlank { it.fileName }
                                        },
                                        createdAt = time
                                    )
                                    currentConversationMessages.add(newMsg)
                                    messageStorage.saveMessage(newMsg, viewOnceStorage)
                                    updateConversationLastMessage(activeConv.id, newMsg)
                                    coroutineScope.launch(Dispatchers.IO) {
                                        SupabaseSyncClient.insertMessage(null, newMsg)
                                    }
                                },
                                onSendAttachment = { inspected, caption, isViewOnce, useP2p ->
                                    enqueueAttachmentTransfer(activeConv, inspected, caption, isViewOnce, useP2p)
                                },
                                onSendVoiceNote = { uri, fileName, fileSize, durationSec ->
                                    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                    val newMsg = Message(
                                        conversationId = activeConv.id,
                                        senderId = currentUser.id,
                                        senderName = currentUser.displayName,
                                        content = "Voice Note (0:${durationSec.toString().padStart(2, '0')})",
                                        mediaUrl = uri.toString(),
                                        localUri = uri.toString(),
                                        mediaType = MediaType.AUDIO,
                                        fileName = fileName,
                                        fileSize = fileSize,
                                        mimeType = "audio/mp4",
                                        audioDurationSec = durationSec,
                                        createdAt = time
                                    )
                                    currentConversationMessages.add(newMsg)
                                    messageStorage.saveMessage(newMsg, viewOnceStorage)
                                    updateConversationLastMessage(activeConv.id, newMsg)
                                    coroutineScope.launch(Dispatchers.IO) {
                                        SupabaseSyncClient.insertMessage(null, newMsg)
                                    }
                                },
                                onSendSticker = { sticker ->
                                    val time = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
                                    val newMsg = Message(
                                        conversationId = activeConv.id,
                                        senderId = currentUser.id,
                                        senderName = currentUser.displayName,
                                        content = "Sticker",
                                        mediaUrl = sticker.imageUrl,
                                        localUri = sticker.imageUrl,
                                        mediaType = MediaType.STICKER,
                                        createdAt = time
                                    )
                                    currentConversationMessages.add(newMsg)
                                    messageStorage.saveMessage(newMsg, viewOnceStorage)
                                    updateConversationLastMessage(activeConv.id, newMsg)
                                },
                                onVoiceCall = {
                                    val newCall = Call(
                                        conversationId = activeConv.id,
                                        callerId = currentUser.id,
                                        callerName = activeConv.title ?: activeConv.otherUser?.displayName ?: "Friend",
                                        callType = CallType.AUDIO,
                                        roomName = "conversation-${activeConv.id}"
                                    )
                                    activeCallState.value = newCall
                                    startCallService(newCall)
                                },
                                onVideoCall = {
                                    val newCall = Call(
                                        conversationId = activeConv.id,
                                        callerId = currentUser.id,
                                        callerName = activeConv.title ?: activeConv.otherUser?.displayName ?: "Friend",
                                        callType = CallType.VIDEO,
                                        roomName = "conversation-${activeConv.id}"
                                    )
                                    activeCallState.value = newCall
                                    startCallService(newCall)
                                },
                                onOpenViewOnce = { msg ->
                                    if (msg.isPhotoViewOnce && !viewOnceStorage.isViewed(msg.id) && msg.viewedAt == null) {
                                        activeViewOnceMessage = msg
                                    }
                                },
                                onDeleteForEveryone = { msg ->
                                    val idx = currentConversationMessages.indexOfFirst { it.id == msg.id }
                                    if (idx != -1) {
                                        val nowIso = Instant.now().toString()
                                        val updated = currentConversationMessages[idx].copy(
                                            deletedForEveryone = true,
                                            deletedAt = nowIso,
                                            deletedBy = currentUser.id
                                        )
                                        currentConversationMessages[idx] = updated
                                        messageStorage.saveMessage(updated, viewOnceStorage)
                                        coroutineScope.launch(Dispatchers.IO) {
                                            SupabaseSyncClient.softDeleteMessage(null, msg.id, currentUser.id, nowIso)
                                        }
                                    }
                                },
                                onAddReaction = { msg, emoji ->
                                    val idx = currentConversationMessages.indexOfFirst { it.id == msg.id }
                                    if (idx != -1) {
                                        val existing = currentConversationMessages[idx].reactions.toMutableList()
                                        val already = existing.indexOfFirst { it.userId == currentUser.id && it.emoji == emoji }
                                        if (already != -1) {
                                            existing.removeAt(already)
                                        } else {
                                            existing.add(Reaction(messageId = msg.id, userId = currentUser.id, emoji = emoji))
                                        }
                                        val updated = currentConversationMessages[idx].copy(reactions = existing)
                                        currentConversationMessages[idx] = updated
                                        messageStorage.saveMessage(updated, viewOnceStorage)
                                    }
                                }
                            )

                            activeViewOnceMessage?.let { viewOnceMsg ->
                                ViewOnceMediaDialog(
                                    message = viewOnceMsg,
                                    onDismiss = { activeViewOnceMessage = null },
                                    onMediaViewed = { msgId ->
                                        val viewedIso = viewOnceStorage.markAsViewed(msgId, Instant.now().toString())
                                        val updated = messageStorage.markViewOnceOpened(activeConv.id, msgId, viewOnceStorage)
                                        val idx = currentConversationMessages.indexOfFirst { it.id == msgId }
                                        if (idx != -1) {
                                            currentConversationMessages[idx] = updated ?: currentConversationMessages[idx].copy(
                                                viewedAt = viewedIso,
                                                content = "",
                                                mediaUrl = "",
                                                localUri = ""
                                            )
                                        }
                                        coroutineScope.launch(Dispatchers.IO) {
                                            SupabaseSyncClient.markViewOnceViewed(null, msgId, viewedIso)
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
                                onUpdateAvatar = { avatarUri ->
                                    val updatedUser = currentUser.copy(avatarUrl = avatarUri)
                                    currentUser = updatedUser
                                    authSessionManager.saveSession(updatedUser)
                                },
                                onUpdateAccent = { newAccent ->
                                    activeThemeAccent = newAccent
                                    val updatedUser = currentUser.copy(themeAccent = newAccent)
                                    currentUser = updatedUser
                                    authSessionManager.saveSession(updatedUser)
                                },
                                onUpdateWallpaper = { newWallpaper ->
                                    activeWallpaper = newWallpaper
                                    val updatedUser = currentUser.copy(chatBackgroundUrl = newWallpaper)
                                    currentUser = updatedUser
                                    authSessionManager.saveSession(updatedUser)
                                },
                                onCreateStickerPack = { name ->
                                    stickerPacks.add(StickerPack(name = name, creatorId = currentUser.id))
                                },
                                onAddStickerToPack = { packId, imageUri ->
                                    val idx = stickerPacks.indexOfFirst { it.id == packId }
                                    if (idx != -1) {
                                        val updatedStickers = stickerPacks[idx].stickers + Sticker(packId = packId, imageUrl = imageUri)
                                        stickerPacks[idx] = stickerPacks[idx].copy(stickers = updatedStickers)
                                    }
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
                                },
                                updateInfo = availableUpdate,
                                updateDownloadState = updateDownloadState,
                                onCheckForUpdates = { triggerUpdateCheck(true) },
                                onUpdateClick = startInAppDownloadAndInstall
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIncomingShareIntent(intent)
        handleCallIntent(intent)
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (activeCallState.value != null) {
            enterPipMode()
        }
    }

    private fun handleCallIntent(intent: Intent?) {
        if (intent == null) return
        if (intent.action == "ACTION_ANSWER_CALL") {
            val callId = intent.getStringExtra("CALL_ID") ?: UUID.randomUUID().toString()
            val conversationId = intent.getStringExtra("CONVERSATION_ID") ?: "conv-call"
            val callerName = intent.getStringExtra("CALLER_NAME") ?: "Friend"
            val roomName = intent.getStringExtra("ROOM_NAME") ?: "conversation-$conversationId"
            val callTypeStr = intent.getStringExtra("CALL_TYPE") ?: "audio"
            val callType = if (callTypeStr.equals("video", ignoreCase = true)) CallType.VIDEO else CallType.AUDIO
            val activeCall = Call(
                id = callId,
                conversationId = conversationId,
                callerId = "caller-partner",
                callerName = callerName,
                callType = callType,
                roomName = roomName,
                status = CallStatus.ONGOING
            )
            activeCallState.value = activeCall
            startCallService(activeCall)
            CallNotificationManager.dismissIncomingCallNotification(this)
        }
    }

    private fun startCallService(call: Call) {
        val serviceIntent = Intent(this, CallForegroundService::class.java).apply {
            action = "ACTION_START_CALL"
            putExtra("CALL_ID", call.id)
            putExtra("CALLER_NAME", call.callerName)
            putExtra("ROOM_NAME", call.roomName)
            putExtra("CALL_TYPE", call.callType.key)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent)
        } else {
            startService(serviceIntent)
        }
    }

    private fun stopCallService() {
        val stopIntent = Intent(this, CallForegroundService::class.java).apply {
            action = "ACTION_END_CALL"
        }
        startService(stopIntent)
        CallNotificationManager.dismissCallNotification(this)
    }

    private fun handleIncomingShareIntent(intent: Intent?) {
        if (intent == null) return
        try {
            val action = intent.action
            val type = intent.type

            if (Intent.ACTION_SEND == action && type != null) {
                if ("text/plain" == type) {
                    val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT)
                    if (!sharedText.isNullOrBlank()) {
                        pendingSharedText.value = sharedText
                    }
                } else {
                    val mediaUri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
                    }
                    if (mediaUri != null) {
                        pendingSharedUris.add(mediaUri)
                    }
                }
            } else if (Intent.ACTION_SEND_MULTIPLE == action && type != null) {
                val uris = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
                }
                if (!uris.isNullOrEmpty()) {
                    pendingSharedUris.addAll(uris)
                }
            }
        } catch (_: Exception) {}
    }

    private fun enterPipMode() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                val aspectRatio = Rational(9, 16)
                val params = PictureInPictureParams.Builder()
                    .setAspectRatio(aspectRatio)
                    .build()
                enterPictureInPictureMode(params)
            } catch (_: Exception) {}
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
