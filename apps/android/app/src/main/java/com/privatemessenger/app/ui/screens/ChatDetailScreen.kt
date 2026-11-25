@file:OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
package com.privatemessenger.app.ui.screens

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.privatemessenger.app.data.media.InspectedFile
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.media.VoiceNotePlayer
import com.privatemessenger.app.data.media.VoiceNoteRecorder
import com.privatemessenger.app.data.model.*
import com.privatemessenger.app.ui.components.FullScreenImageViewerDialog
import com.privatemessenger.app.ui.theme.*
import com.privatemessenger.app.webrtc.P2PTransferRegistry
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

@Composable
fun ChatDetailScreen(
    conversation: Conversation,
    messages: List<Message>,
    currentUserId: String,
    accent: ThemeAccent,
    stickerPacks: List<StickerPack> = emptyList(),
    wallpaper: String = "",
    onBack: () -> Unit,
    onSendMessage: (content: String, replyTo: Message?) -> Unit,
    onSendAttachment: (inspected: InspectedFile, caption: String, isViewOnce: Boolean, useP2p: Boolean) -> Unit,
    onSendVoiceNote: (fileUri: Uri, fileName: String, fileSize: Long, durationSec: Int) -> Unit,
    onSendSticker: (sticker: Sticker) -> Unit = {},
    onVoiceCall: () -> Unit,
    onVideoCall: () -> Unit,
    onContactProfileClick: () -> Unit = {},
    isViewOnceViewed: ((String) -> Boolean)? = null,
    onOpenViewOnce: (Message) -> Unit,
    onDeleteForEveryone: (Message) -> Unit,
    onAddReaction: (Message, String) -> Unit
) {
    val title = conversation.title ?: conversation.otherUser?.displayName ?: "Friend"
    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()

    var inputText by remember { mutableStateOf("") }
    var replyingTo by remember { mutableStateOf<Message?>(null) }
    var showAttachMenu by remember { mutableStateOf(false) }
    var showStickerTray by remember { mutableStateOf(false) }

    // Real Voice Note recording & playback
    val voiceRecorder = remember { VoiceNoteRecorder(context) }
    val voicePlayer = remember { VoiceNotePlayer() }
    var playingMessageId by remember { mutableStateOf<String?>(null) }
    var isAudioPlaying by remember { mutableStateOf(false) }
    var audioProgressMs by remember { mutableIntStateOf(0) }
    var audioDurationMs by remember { mutableIntStateOf(0) }
    var isRecordingAudio by remember { mutableStateOf(false) }
    var recordingSeconds by remember { mutableIntStateOf(0) }

    // Attachment inspection & preview state (View Once strictly on Image/Photo only)
    var isInspectingFile by remember { mutableStateOf(false) }
    var pendingAttachment by remember { mutableStateOf<InspectedFile?>(null) }
    var pendingForceP2p by remember { mutableStateOf(false) }
    var attachmentCaption by remember { mutableStateOf("") }
    var attachmentViewOnce by remember { mutableStateOf(false) }

    // Full-screen viewer & search & highlight
    var fullScreenImageMessage by remember { mutableStateOf<Message?>(null) }
    var selectedMessageForMenu by remember { mutableStateOf<Message?>(null) }
    var showPartnerProfileDialog by remember { mutableStateOf(false) }
    var isSearchActive by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var highlightedMessageId by remember { mutableStateOf<String?>(null) }

    val activeTransfers by P2PTransferRegistry.transfers.collectAsState()

    // Scroll-to-bottom tracking
    val isAtBottom by remember {
        derivedStateOf {
            val layoutInfo = listState.layoutInfo
            val lastVisible = layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0
            messages.isEmpty() || lastVisible >= (messages.size - 2)
        }
    }
    var unseenBelowCount by remember { mutableIntStateOf(0) }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) {
            if (isAtBottom) {
                listState.animateScrollToItem(messages.lastIndex)
                unseenBelowCount = 0
            } else {
                unseenBelowCount += 1
            }
        }
    }

    LaunchedEffect(highlightedMessageId) {
        if (highlightedMessageId != null) {
            delay(1800)
            highlightedMessageId = null
        }
    }

    // Recording timer loop
    LaunchedEffect(isRecordingAudio) {
        if (isRecordingAudio) {
            recordingSeconds = 0
            while (isRecordingAudio) {
                delay(1000)
                recordingSeconds++
            }
        }
    }

    // Audio playback progress polling
    LaunchedEffect(playingMessageId, isAudioPlaying) {
        while (playingMessageId != null && isAudioPlaying) {
            audioProgressMs = voicePlayer.currentPositionMs()
            val dur = voicePlayer.durationMs()
            if (dur > 0) audioDurationMs = dur
            delay(200)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            voiceRecorder.release()
            voicePlayer.stop()
        }
    }

    // Helper to inspect picked Uri via ContentResolver
    val handlePickedUri: (Uri?, Boolean) -> Unit = { uri, forceP2p ->
        if (uri != null) {
            isInspectingFile = true
            pendingForceP2p = forceP2p
            scope.launch {
                val res = MediaFileInspector.inspectAndCache(
                    context = context,
                    uri = uri,
                    persistLocalCopy = !forceP2p,
                    computeSha256 = true
                )
                isInspectingFile = false
                res.fold(
                    onSuccess = { inspected ->
                        pendingAttachment = inspected
                        attachmentCaption = ""
                        attachmentViewOnce = false
                    },
                    onFailure = { err ->
                        Toast.makeText(
                            context,
                            err.localizedMessage ?: "Failed to read selected file",
                            Toast.LENGTH_LONG
                        ).show()
                    }
                )
            }
        }
    }

    // Native Android Photo Picker (Images only -> supports View Once toggle)
    val photoPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri -> handlePickedUri(uri, false) }

    // Native Android Photo & Video Picker
    val mediaPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri -> handlePickedUri(uri, false) }

    // Native Android Document / Large File Picker (up to 1 GB P2P)
    val documentPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> handlePickedUri(uri, pendingForceP2p) }

    // Runtime permission for Voice Note recording
    val micPermissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (voiceRecorder.startRecording()) {
                isRecordingAudio = true
                recordingSeconds = 0
            } else {
                Toast.makeText(context, "Unable to start microphone recorder", Toast.LENGTH_SHORT).show()
            }
        } else {
            Toast.makeText(context, "Microphone permission is required for voice notes", Toast.LENGTH_SHORT).show()
        }
    }

    val searchMatches = remember(searchQuery, messages) {
        if (searchQuery.isBlank()) emptyList()
        else messages.mapIndexedNotNull { idx, msg ->
            if (!msg.deletedForEveryone &&
                (msg.content.contains(searchQuery, ignoreCase = true) ||
                    msg.fileName.contains(searchQuery, ignoreCase = true))
            ) idx else null
        }
    }
    var currentSearchMatchCursor by remember(searchQuery) { mutableIntStateOf(0) }

    val canvasBackground = when (wallpaper) {
        "midnight-gradient" -> Color(0xFF070712)
        "emerald-mist" -> Color(0xFF04100C)
        "crimson-velvet" -> Color(0xFF120508)
        else -> OledBackground
    }

    Scaffold(
        modifier = Modifier
            .fillMaxSize()
            .imePadding(),
        topBar = {
            Column(modifier = Modifier.background(SurfaceHeader)) {
                TopAppBar(
                    navigationIcon = {
                        IconButton(onClick = onBack) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                                contentDescription = "Back",
                                tint = Color.White
                            )
                        }
                    },
                    title = {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.combinedClickable(
                                onClick = {
                                    onContactProfileClick()
                                    showPartnerProfileDialog = true
                                }
                            )
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(40.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF242424)),
                                contentAlignment = Alignment.Center
                            ) {
                                val partnerAvatar = conversation.otherUser?.avatarUrl ?: conversation.avatarUrl
                                if (!partnerAvatar.isNullOrBlank()) {
                                    AsyncImage(
                                        model = partnerAvatar,
                                        contentDescription = title,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier.fillMaxSize().clip(CircleShape)
                                    )
                                } else {
                                    Text(
                                        text = title.ifBlank { "F" }.take(1).uppercase(),
                                        color = Color.White,
                                        fontWeight = FontWeight.Bold,
                                        fontSize = 16.sp
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = title,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = TextPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Text(
                                    text = "online",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = Color(0xFF10B981)
                                )
                            }
                        }
                    },
                    actions = {
                        IconButton(onClick = {
                            isSearchActive = !isSearchActive
                            if (!isSearchActive) searchQuery = ""
                        }) {
                            Icon(
                                imageVector = Icons.Default.Search,
                                contentDescription = "Search Messages",
                                tint = if (isSearchActive) Color(accent.primaryHex) else Color.White
                            )
                        }
                        IconButton(onClick = onVoiceCall) {
                            Icon(
                                imageVector = Icons.Default.Call,
                                contentDescription = "Voice Call",
                                tint = Color(accent.primaryHex)
                            )
                        }
                        IconButton(onClick = onVideoCall) {
                            Icon(
                                imageVector = Icons.Default.Videocam,
                                contentDescription = "Video Call",
                                tint = Color(accent.primaryHex)
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = SurfaceHeader)
                )

                // In-Chat Message Search Bar
                AnimatedVisibility(visible = isSearchActive) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF141414))
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text("Search messages & files...", color = TextMuted, fontSize = 13.sp) },
                            singleLine = true,
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(12.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedContainerColor = Color(0xFF1E1E1E),
                                unfocusedContainerColor = Color(0xFF1E1E1E),
                                focusedBorderColor = Color(accent.primaryHex),
                                unfocusedBorderColor = BorderDark,
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary
                            )
                        )
                        if (searchMatches.isNotEmpty()) {
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "${(currentSearchMatchCursor % searchMatches.size) + 1}/${searchMatches.size}",
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                            IconButton(onClick = {
                                val nextIdx = (currentSearchMatchCursor - 1 + searchMatches.size) % searchMatches.size
                                currentSearchMatchCursor = nextIdx
                                val targetMsgIdx = searchMatches[nextIdx]
                                highlightedMessageId = messages[targetMsgIdx].id
                                scope.launch { listState.animateScrollToItem(targetMsgIdx) }
                            }) {
                                Icon(Icons.Default.KeyboardArrowUp, contentDescription = "Previous", tint = Color.White)
                            }
                            IconButton(onClick = {
                                val nextIdx = (currentSearchMatchCursor + 1) % searchMatches.size
                                currentSearchMatchCursor = nextIdx
                                val targetMsgIdx = searchMatches[nextIdx]
                                highlightedMessageId = messages[targetMsgIdx].id
                                scope.launch { listState.animateScrollToItem(targetMsgIdx) }
                            }) {
                                Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Next", tint = Color.White)
                            }
                        }
                    }
                }
            }
        },
        containerColor = canvasBackground,
        bottomBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SurfaceElevated)
                    .navigationBarsPadding()
            ) {
                // Quoted reply banner
                replyingTo?.let { replyMsg ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1A1A1A))
                            .padding(horizontal = 16.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Replying to ${if (replyMsg.senderId == currentUserId) "You" else replyMsg.senderName.ifBlank { title }}",
                                color = Color(accent.primaryHex),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = when {
                                    replyMsg.isViewOnce -> "1 Photo • View Once"
                                    replyMsg.content.isNotBlank() -> replyMsg.content
                                    replyMsg.fileName.isNotBlank() -> replyMsg.fileName
                                    else -> "[Media]"
                                },
                                color = TextSecondary,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                        IconButton(
                            onClick = { replyingTo = null },
                            modifier = Modifier.size(28.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Cancel reply",
                                tint = TextMuted,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }
                }

                // Active Voice Note Recording Banner
                AnimatedVisibility(visible = isRecordingAudio) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF221111))
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(10.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFFEF4444))
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Recording Voice Note • 0:${recordingSeconds.toString().padStart(2, '0')}",
                                color = Color.White,
                                style = MaterialTheme.typography.bodyMedium,
                                fontWeight = FontWeight.Medium
                            )
                        }
                        Row {
                            TextButton(onClick = {
                                voiceRecorder.cancelRecording()
                                isRecordingAudio = false
                                recordingSeconds = 0
                            }) {
                                Text("Cancel", color = Color(0xFFEF4444))
                            }
                            TextButton(onClick = {
                                val recorded = voiceRecorder.stopRecording()
                                isRecordingAudio = false
                                recordingSeconds = 0
                                if (recorded != null) {
                                    onSendVoiceNote(recorded.uri, recorded.fileName, recorded.fileSize, recorded.durationSec)
                                } else {
                                    Toast.makeText(context, "Voice note too short", Toast.LENGTH_SHORT).show()
                                }
                            }) {
                                Text("Send", color = Color(accent.primaryHex), fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                // Emoji & Custom Sticker Tray
                AnimatedVisibility(visible = showStickerTray) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF141414))
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    ) {
                        LazyRow(
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            items(listOf("❤️", "😂", "🔥", "👍", "😮", "😢", "🙏", "🎉", "💯", "✨", "😎", "🥳")) { emoji ->
                                Text(
                                    text = emoji,
                                    fontSize = 24.sp,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable { inputText += emoji }
                                        .padding(6.dp)
                                )
                            }
                        }

                        if (stickerPacks.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(6.dp))
                            HorizontalDivider(color = BorderDark)
                            Spacer(modifier = Modifier.height(6.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                items(stickerPacks.flatMap { it.stickers }) { sticker ->
                                    Box(
                                        modifier = Modifier
                                            .size(56.dp)
                                            .clip(RoundedCornerShape(12.dp))
                                            .background(Color(0xFF242424))
                                            .clickable {
                                                onSendSticker(sticker)
                                                showStickerTray = false
                                            },
                                        contentAlignment = Alignment.Center
                                    ) {
                                        if (sticker.imageUrl.startsWith("http") || sticker.imageUrl.startsWith("content") || sticker.imageUrl.startsWith("file")) {
                                            AsyncImage(
                                                model = sticker.imageUrl,
                                                contentDescription = "Sticker",
                                                contentScale = ContentScale.Crop,
                                                modifier = Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp))
                                            )
                                        } else {
                                            Text("🎭", fontSize = 26.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Composer Row (NO View-Once toggle on text messages!)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = { showStickerTray = !showStickerTray }) {
                        Icon(
                            imageVector = Icons.Default.EmojiEmotions,
                            contentDescription = "Emojis & Stickers",
                            tint = if (showStickerTray) Color(accent.primaryHex) else TextMuted
                        )
                    }

                    IconButton(onClick = { showAttachMenu = true }) {
                        Icon(
                            imageVector = Icons.Default.AttachFile,
                            contentDescription = "Attach Photo, Media, or File",
                            tint = TextMuted
                        )
                    }

                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        placeholder = { Text("Message...", color = TextMuted) },
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 4.dp),
                        shape = RoundedCornerShape(22.dp),
                        maxLines = 4,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedContainerColor = Color(0xFF1E1E1E),
                            unfocusedContainerColor = Color(0xFF1E1E1E),
                            focusedBorderColor = Color(accent.primaryHex),
                            unfocusedBorderColor = BorderDark,
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary
                        )
                    )

                    if (inputText.isNotBlank()) {
                        IconButton(
                            onClick = {
                                onSendMessage(inputText.trim(), replyingTo)
                                inputText = ""
                                replyingTo = null
                                showStickerTray = false
                            }
                        ) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Send,
                                contentDescription = "Send",
                                tint = Color(accent.primaryHex)
                            )
                        }
                    } else {
                        IconButton(
                            onClick = {
                                if (isRecordingAudio) {
                                    val recorded = voiceRecorder.stopRecording()
                                    isRecordingAudio = false
                                    recordingSeconds = 0
                                    if (recorded != null) {
                                        onSendVoiceNote(recorded.uri, recorded.fileName, recorded.fileSize, recorded.durationSec)
                                    }
                                } else {
                                    val hasMic = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.RECORD_AUDIO
                                    ) == PackageManager.PERMISSION_GRANTED
                                    if (hasMic) {
                                        if (voiceRecorder.startRecording()) {
                                            isRecordingAudio = true
                                            recordingSeconds = 0
                                        }
                                    } else {
                                        micPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                }
                            }
                        ) {
                            Icon(
                                imageVector = if (isRecordingAudio) Icons.Default.Stop else Icons.Default.Mic,
                                contentDescription = "Record Voice Note",
                                tint = if (isRecordingAudio) Color(0xFFEF4444) else Color(accent.primaryHex)
                            )
                        }
                    }
                }
            }
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
                contentPadding = PaddingValues(vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                items(messages, key = { it.id }) { msg ->
                    val transferSnapshot = msg.transferId?.let { activeTransfers[it] }
                    val isThisAudioPlaying = playingMessageId == msg.id && isAudioPlaying
                    MessageBubbleItem(
                        message = msg,
                        transferSnapshot = transferSnapshot,
                        isFromMe = msg.senderId == currentUserId,
                        isHighlighted = highlightedMessageId == msg.id,
                        accent = accent,
                        isViewOnceViewed = isViewOnceViewed,
                        isAudioPlaying = isThisAudioPlaying,
                        audioProgressMs = if (playingMessageId == msg.id) audioProgressMs else 0,
                        audioDurationMs = if (playingMessageId == msg.id && audioDurationMs > 0) audioDurationMs else (msg.audioDurationSec * 1000),
                        onToggleAudioPlay = {
                            val source = msg.localUri.ifBlank { msg.mediaUrl }
                            if (playingMessageId == msg.id) {
                                if (isAudioPlaying) {
                                    voicePlayer.pause()
                                    isAudioPlaying = false
                                } else {
                                    voicePlayer.resume()
                                    isAudioPlaying = true
                                }
                            } else {
                                playingMessageId = msg.id
                                audioProgressMs = 0
                                audioDurationMs = msg.audioDurationSec * 1000
                                voicePlayer.play(
                                    context = context,
                                    sourceUriOrUrl = source,
                                    onPreparedDurationMs = { dur ->
                                        audioDurationMs = dur
                                        isAudioPlaying = true
                                    },
                                    onCompletion = {
                                        isAudioPlaying = false
                                        audioProgressMs = 0
                                        playingMessageId = null
                                    },
                                    onError = {
                                        isAudioPlaying = false
                                        playingMessageId = null
                                        Toast.makeText(context, "Audio playback unavailable for this item", Toast.LENGTH_SHORT).show()
                                    }
                                )
                            }
                        },
                        onSwipeToReply = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            replyingTo = msg
                        },
                        onReplyQuoteClick = { replyTargetId ->
                            val targetIdx = messages.indexOfFirst { it.id == replyTargetId }
                            if (targetIdx != -1) {
                                highlightedMessageId = replyTargetId
                                scope.launch { listState.animateScrollToItem(targetIdx) }
                            }
                        },
                        onLongPress = { selectedMessageForMenu = msg },
                        onOpenViewOnce = { onOpenViewOnce(msg) },
                        onOpenImage = { fullScreenImageMessage = msg },
                        onOpenFile = {
                            val src = msg.localUri.ifBlank { msg.mediaUrl }
                            if (src.isBlank() || !MediaFileInspector.openFileWithSystemViewer(context, src, msg.mimeType)) {
                                Toast.makeText(context, "File not available locally to open", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onSaveFile = {
                            val src = msg.localUri.ifBlank { msg.mediaUrl }
                            if (src.isBlank()) {
                                Toast.makeText(context, "No downloadable source available", Toast.LENGTH_SHORT).show()
                            } else {
                                scope.launch {
                                    val res = MediaFileInspector.saveToDownloads(
                                        context = context,
                                        sourceUrlOrUri = src,
                                        fileName = msg.fileName.ifBlank { "attachment_${System.currentTimeMillis()}" },
                                        mimeType = msg.mimeType
                                    )
                                    res.fold(
                                        onSuccess = {
                                            Toast.makeText(context, "Saved to Downloads/PrivateMessenger", Toast.LENGTH_SHORT).show()
                                        },
                                        onFailure = { err ->
                                            Toast.makeText(context, "Save failed: ${err.localizedMessage}", Toast.LENGTH_SHORT).show()
                                        }
                                    )
                                }
                            }
                        },
                        onReactionClick = { emoji -> onAddReaction(msg, emoji) },
                        modifier = Modifier.animateItem()
                    )
                }
            }

            // WhatsApp-style Floating Scroll-to-Bottom Button with Unread Count Badge
            AnimatedVisibility(
                visible = !isAtBottom && messages.isNotEmpty(),
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(16.dp)
            ) {
                BadgedBox(
                    badge = {
                        if (unseenBelowCount > 0) {
                            Badge(containerColor = Color(accent.primaryHex)) {
                                Text(unseenBelowCount.toString(), color = Color.White, fontSize = 10.sp)
                            }
                        }
                    }
                ) {
                    SmallFloatingActionButton(
                        onClick = {
                            scope.launch {
                                if (messages.isNotEmpty()) {
                                    listState.animateScrollToItem(messages.lastIndex)
                                    unseenBelowCount = 0
                                }
                            }
                        },
                        containerColor = SurfaceElevated,
                        contentColor = Color.White,
                        shape = CircleShape
                    ) {
                        Icon(Icons.Default.KeyboardArrowDown, contentDescription = "Scroll to bottom")
                    }
                }
            }

            // Inspecting file progress overlay
            if (isInspectingFile) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.65f)),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        CircularProgressIndicator(color = Color(accent.primaryHex))
                        Spacer(modifier = Modifier.height(12.dp))
                        Text("Inspecting file & computing SHA-256...", color = Color.White, fontSize = 14.sp)
                    }
                }
            }

            // Long-Press Context Menu & Emoji Reaction Bar
            selectedMessageForMenu?.let { activeMsg ->
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.7f))
                        .combinedClickable(onClick = { selectedMessageForMenu = null }),
                    contentAlignment = Alignment.Center
                ) {
                    Column(
                        modifier = Modifier
                            .padding(24.dp)
                            .clip(RoundedCornerShape(16.dp))
                            .background(SurfaceElevated)
                            .padding(16.dp)
                    ) {
                        Row(
                            horizontalArrangement = Arrangement.SpaceEvenly,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(bottom = 16.dp)
                        ) {
                            listOf("❤️", "👍", "😂", "😮", "😢", "🙏").forEach { emoji ->
                                Text(
                                    text = emoji,
                                    fontSize = 28.sp,
                                    modifier = Modifier
                                        .combinedClickable(onClick = {
                                            onAddReaction(activeMsg, emoji)
                                            selectedMessageForMenu = null
                                        })
                                        .padding(4.dp)
                                )
                            }
                        }

                        HorizontalDivider(color = BorderDark)

                        if (activeMsg.content.isNotBlank() && !activeMsg.isViewOnce && !activeMsg.deletedForEveryone) {
                            TextButton(
                                onClick = {
                                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                    clipboard?.setPrimaryClip(ClipData.newPlainText("Message", activeMsg.content))
                                    selectedMessageForMenu = null
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Copy", color = Color.White, modifier = Modifier.fillMaxWidth())
                            }
                        }

                        TextButton(
                            onClick = {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager
                                if (clipboard != null && clipboard.hasPrimaryClip()) {
                                    val clipData = clipboard.primaryClip
                                    if (clipData != null && clipData.itemCount > 0) {
                                        val clip = clipData.getItemAt(0)?.coerceToText(context)?.toString() ?: ""
                                        inputText += clip
                                    }
                                }
                                selectedMessageForMenu = null
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Paste to Composer", color = Color.White, modifier = Modifier.fillMaxWidth())
                        }

                        TextButton(
                            onClick = {
                                replyingTo = activeMsg
                                selectedMessageForMenu = null
                            },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Reply", color = Color.White, modifier = Modifier.fillMaxWidth())
                        }

                        if (!activeMsg.isViewOnce && !activeMsg.deletedForEveryone &&
                            (activeMsg.localUri.isNotBlank() || activeMsg.mediaUrl.isNotBlank())
                        ) {
                            TextButton(
                                onClick = {
                                    val src = activeMsg.localUri.ifBlank { activeMsg.mediaUrl }
                                    scope.launch {
                                        val res = MediaFileInspector.saveToDownloads(
                                            context,
                                            src,
                                            activeMsg.fileName.ifBlank { "file_${System.currentTimeMillis()}" },
                                            activeMsg.mimeType
                                        )
                                        Toast.makeText(
                                            context,
                                            if (res.isSuccess) "Saved to Downloads" else "Save failed",
                                            Toast.LENGTH_SHORT
                                        ).show()
                                    }
                                    selectedMessageForMenu = null
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Save to Downloads", color = Color(accent.primaryHex), modifier = Modifier.fillMaxWidth())
                            }
                        }

                        if (activeMsg.senderId == currentUserId && !activeMsg.deletedForEveryone) {
                            TextButton(
                                onClick = {
                                    onDeleteForEveryone(activeMsg)
                                    selectedMessageForMenu = null
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Delete for Everyone", color = Color(0xFFEF4444), modifier = Modifier.fillMaxWidth())
                            }
                        }
                    }
                }
            }

            // Real Native Attachment Picker Menu
            if (showAttachMenu) {
                AlertDialog(
                    onDismissRequest = { showAttachMenu = false },
                    title = { Text("Attach Photo, Media, or File", color = TextPrimary) },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            TextButton(
                                onClick = {
                                    showAttachMenu = false
                                    pendingForceP2p = false
                                    photoPickerLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                    )
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Photo, contentDescription = null, tint = Color(accent.primaryHex))
                                Spacer(modifier = Modifier.width(10.dp))
                                Text("Photo (Gallery • View Once supported)", color = Color.White, modifier = Modifier.weight(1f))
                            }

                            TextButton(
                                onClick = {
                                    showAttachMenu = false
                                    pendingForceP2p = false
                                    mediaPickerLauncher.launch(
                                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                                    )
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.VideoLibrary, contentDescription = null, tint = Color.White)
                                Spacer(modifier = Modifier.width(10.dp))
                                Text("Photo or Video (<= 50 MB Storage)", color = Color.White, modifier = Modifier.weight(1f))
                            }

                            TextButton(
                                onClick = {
                                    showAttachMenu = false
                                    pendingForceP2p = false
                                    documentPickerLauncher.launch(arrayOf("*/*"))
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.AutoMirrored.Filled.InsertDriveFile, contentDescription = null, tint = Color.White)
                                Spacer(modifier = Modifier.width(10.dp))
                                Text("Document / File (Auto Storage or P2P)", color = Color.White, modifier = Modifier.weight(1f))
                            }

                            TextButton(
                                onClick = {
                                    showAttachMenu = false
                                    pendingForceP2p = true
                                    documentPickerLauncher.launch(arrayOf("*/*"))
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Icon(Icons.Default.Bolt, contentDescription = null, tint = Color(accent.primaryHex))
                                Spacer(modifier = Modifier.width(10.dp))
                                Text("Send Large File (Up to 1 GB WebRTC P2P)", color = Color(accent.primaryHex), modifier = Modifier.weight(1f))
                            }
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { showAttachMenu = false }) {
                            Text("Cancel", color = TextMuted)
                        }
                    },
                    containerColor = SurfaceElevated
                )
            }

            // Attachment Preview Dialog (View Once "1" toggle STRICTLY ONLY on Images/Photos!)
            pendingAttachment?.let { inspected ->
                val isImageAttachment = inspected.mediaType == MediaType.IMAGE
                val exceedsStorageLimit = inspected.fileSize > MediaFileInspector.MAX_SUPABASE_STORAGE_BYTES
                val useP2p = pendingForceP2p || exceedsStorageLimit
                val viewOnceAllowed = isImageAttachment && !useP2p

                AlertDialog(
                    onDismissRequest = { pendingAttachment = null },
                    title = {
                        Text(
                            text = if (isImageAttachment) "Send Photo" else "Send File",
                            color = TextPrimary
                        )
                    },
                    text = {
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            if (isImageAttachment) {
                                AsyncImage(
                                    model = inspected.localCachePath.ifBlank { inspected.uri },
                                    contentDescription = inspected.fileName,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .height(190.dp)
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(Color(0xFF1A1A1A))
                                )
                            } else {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color(0xFF1C1C1C))
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        imageVector = if (useP2p) Icons.Default.Bolt else Icons.AutoMirrored.Filled.InsertDriveFile,
                                        contentDescription = null,
                                        tint = Color(accent.primaryHex),
                                        modifier = Modifier.size(32.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = inspected.fileName,
                                            color = TextPrimary,
                                            fontWeight = FontWeight.SemiBold,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = "${MediaFileInspector.formatFileSize(inspected.fileSize)} • ${inspected.mimeType}",
                                            color = TextSecondary,
                                            fontSize = 12.sp
                                        )
                                    }
                                }
                            }

                            if (isImageAttachment) {
                                Text(
                                    text = "${inspected.fileName} • ${MediaFileInspector.formatFileSize(inspected.fileSize)}",
                                    color = TextSecondary,
                                    fontSize = 12.sp
                                )
                            }

                            if (useP2p) {
                                Text(
                                    text = "Transport: Direct 1 GB WebRTC DataChannel (64 KB chunks + SHA-256)",
                                    color = Color(accent.primaryHex),
                                    fontSize = 12.sp,
                                    fontWeight = FontWeight.Medium
                                )
                            }

                            // View Once ("1") toggle ONLY on Images/Photos!
                            if (viewOnceAllowed) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(
                                            if (attachmentViewOnce) Color(accent.primaryHex).copy(alpha = 0.2f)
                                            else Color(0xFF1E1E1E)
                                        )
                                        .border(
                                            width = 1.dp,
                                            color = if (attachmentViewOnce) Color(accent.primaryHex) else BorderDark,
                                            shape = RoundedCornerShape(12.dp)
                                        )
                                        .clickable { attachmentViewOnce = !attachmentViewOnce }
                                        .padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(26.dp)
                                                .clip(CircleShape)
                                                .border(
                                                    1.5.dp,
                                                    if (attachmentViewOnce) Color(accent.primaryHex) else TextSecondary,
                                                    CircleShape
                                                ),
                                            contentAlignment = Alignment.Center
                                        ) {
                                            Text(
                                                text = "1",
                                                color = if (attachmentViewOnce) Color(accent.primaryHex) else TextSecondary,
                                                fontWeight = FontWeight.Bold,
                                                fontSize = 13.sp
                                            )
                                        }
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Column {
                                            Text(
                                                text = "View Once Photo",
                                                color = TextPrimary,
                                                fontWeight = FontWeight.SemiBold,
                                                fontSize = 14.sp
                                            )
                                            Text(
                                                text = "Disappears after opening • FLAG_SECURE",
                                                color = TextMuted,
                                                fontSize = 11.sp
                                            )
                                        }
                                    }
                                    Switch(
                                        checked = attachmentViewOnce,
                                        onCheckedChange = { attachmentViewOnce = it },
                                        colors = SwitchDefaults.colors(checkedThumbColor = Color.White, checkedTrackColor = Color(accent.primaryHex))
                                    )
                                }
                            }

                            OutlinedTextField(
                                value = attachmentCaption,
                                onValueChange = { attachmentCaption = it },
                                placeholder = { Text("Add a caption (optional)...", color = TextMuted) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                                colors = OutlinedTextFieldDefaults.colors(
                                    focusedTextColor = TextPrimary,
                                    unfocusedTextColor = TextPrimary,
                                    focusedBorderColor = Color(accent.primaryHex),
                                    unfocusedBorderColor = BorderDark
                                )
                            )
                        }
                    },
                    confirmButton = {
                        Button(
                            onClick = {
                                val finalViewOnce = isImageAttachment && !useP2p && attachmentViewOnce
                                onSendAttachment(inspected, attachmentCaption.trim(), finalViewOnce, useP2p)
                                pendingAttachment = null
                                attachmentCaption = ""
                                attachmentViewOnce = false
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(accent.primaryHex))
                        ) {
                            Text(if (attachmentViewOnce && viewOnceAllowed) "Send View Once" else "Send")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { pendingAttachment = null }) {
                            Text("Cancel", color = TextMuted)
                        }
                    },
                    containerColor = SurfaceElevated
                )
            }

            // Full-screen photo viewer (non-view-once)
            fullScreenImageMessage?.let { imgMsg ->
                FullScreenImageViewerDialog(
                    message = imgMsg,
                    onDismiss = { fullScreenImageMessage = null }
                )
            }

            // Partner Public Profile Card Modal (NO block button)
            if (showPartnerProfileDialog) {
                val partner = conversation.otherUser
                val partnerName = partner?.displayName ?: conversation.title ?: "Friend"
                val partnerBio = if (!partner?.bio.isNullOrBlank()) partner!!.bio else "Private Messenger contact"
                val partnerEmail = partner?.email ?: ""

                AlertDialog(
                    onDismissRequest = { showPartnerProfileDialog = false },
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(48.dp)
                                    .clip(CircleShape)
                                    .background(Color(accent.primaryHex)),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = partnerName.ifBlank { "F" }.take(1).uppercase(),
                                    color = Color.White,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 20.sp
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = partnerName,
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = TextPrimary
                                )
                                if (partnerEmail.isNotBlank()) {
                                    Text(
                                        text = partnerEmail,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = TextMuted
                                    )
                                }
                            }
                        }
                    },
                    text = {
                        Column {
                            Text(
                                text = "About",
                                style = MaterialTheme.typography.labelSmall,
                                color = Color(accent.primaryHex),
                                fontWeight = FontWeight.Bold
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = partnerBio,
                                style = MaterialTheme.typography.bodyMedium,
                                color = TextSecondary
                            )
                        }
                    },
                    confirmButton = {
                        TextButton(onClick = { showPartnerProfileDialog = false }) {
                            Text("Close", color = Color(accent.primaryHex), fontWeight = FontWeight.SemiBold)
                        }
                    },
                    containerColor = SurfaceElevated
                )
            }
        }
    }
}

@Composable
fun MessageBubbleItem(
    message: Message,
    transferSnapshot: P2PTransfer? = null,
    isFromMe: Boolean,
    isHighlighted: Boolean = false,
    accent: ThemeAccent,
    isViewOnceViewed: ((String) -> Boolean)? = null,
    isAudioPlaying: Boolean = false,
    audioProgressMs: Int = 0,
    audioDurationMs: Int = 0,
    onToggleAudioPlay: () -> Unit = {},
    onSwipeToReply: () -> Unit,
    onReplyQuoteClick: (String) -> Unit = {},
    onLongPress: () -> Unit,
    onOpenViewOnce: () -> Unit,
    onOpenImage: () -> Unit = {},
    onOpenFile: () -> Unit = {},
    onSaveFile: () -> Unit = {},
    onReactionClick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var rawOffsetX by remember { mutableFloatStateOf(0f) }
    val animatedOffsetX by animateFloatAsState(
        targetValue = rawOffsetX,
        animationSpec = spring(stiffness = Spring.StiffnessMediumLow),
        label = "swipeReplyOffset"
    )

    val draggableState = rememberDraggableState { delta ->
        if (delta > 0 || rawOffsetX > 0) {
            val newOffset = (rawOffsetX + delta).coerceIn(0f, 120f)
            rawOffsetX = newOffset
            if (newOffset >= 100f) {
                onSwipeToReply()
                rawOffsetX = 0f
            }
        }
    }

    val isOpenedViewOnce = message.isViewOnce &&
        (message.viewedAt != null || isViewOnceViewed?.invoke(message.id) == true)

    Box(
        modifier = modifier
            .fillMaxWidth()
            .offset { IntOffset(animatedOffsetX.roundToInt(), 0) }
            .draggable(
                state = draggableState,
                orientation = Orientation.Horizontal,
                onDragStopped = { rawOffsetX = 0f }
            ),
        contentAlignment = if (isFromMe) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Column(
            horizontalAlignment = if (isFromMe) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = 310.dp)
        ) {
            Card(
                shape = RoundedCornerShape(
                    topStart = 16.dp,
                    topEnd = 16.dp,
                    bottomStart = if (isFromMe) 16.dp else 4.dp,
                    bottomEnd = if (isFromMe) 4.dp else 16.dp
                ),
                colors = CardDefaults.cardColors(
                    containerColor = if (isFromMe) Color(accent.outgoingHex) else BubbleIncoming
                ),
                modifier = Modifier
                    .then(
                        if (isHighlighted) Modifier.border(
                            2.dp,
                            Color(accent.primaryHex),
                            RoundedCornerShape(16.dp)
                        ) else Modifier
                    )
                    .combinedClickable(
                        onLongClick = onLongPress,
                        onClick = {
                            when {
                                message.deletedForEveryone -> Unit
                                message.isViewOnce -> if (!isOpenedViewOnce) onOpenViewOnce()
                                message.mediaType == MediaType.IMAGE || message.mediaType == MediaType.GIF -> {
                                    if (message.localUri.isNotBlank() || message.mediaUrl.isNotBlank()) {
                                        onOpenImage()
                                    }
                                }
                                message.mediaType == MediaType.AUDIO -> onToggleAudioPlay()
                                message.mediaType == MediaType.FILE || message.mediaType == MediaType.VIDEO || message.isP2pTransfer -> onOpenFile()
                            }
                        }
                    )
            ) {
                Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                    // Quoted preview block
                    if (!message.replyToContent.isNullOrBlank()) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.Black.copy(alpha = 0.25f))
                                .clickable { message.replyToId?.let(onReplyQuoteClick) }
                                .padding(8.dp)
                        ) {
                            Column {
                                Text(
                                    text = message.replyToSenderName ?: "Replying",
                                    color = Color(accent.primaryHex),
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = message.replyToContent ?: "",
                                    color = TextSecondary,
                                    fontSize = 12.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(6.dp))
                    }

                    when {
                        message.deletedForEveryone -> {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Default.DeleteSweep,
                                    contentDescription = null,
                                    tint = TextMuted,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "This message was deleted",
                                    color = TextMuted,
                                    fontStyle = FontStyle.Italic,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }

                        // View Once strictly for Photos/Images — clean UI without duplicate metadata
                        message.isViewOnce -> {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 2.dp)
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(22.dp)
                                        .clip(CircleShape)
                                        .border(
                                            1.5.dp,
                                            if (isOpenedViewOnce) TextMuted else Color.White,
                                            CircleShape
                                        ),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isOpenedViewOnce) {
                                        Icon(
                                            imageVector = Icons.Default.VisibilityOff,
                                            contentDescription = "Opened",
                                            tint = TextMuted,
                                            modifier = Modifier.size(13.dp)
                                        )
                                    } else {
                                        Text(
                                            text = "1",
                                            color = Color.White,
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.Bold
                                        )
                                    }
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = if (isOpenedViewOnce) "Opened" else "Photo",
                                    color = if (isOpenedViewOnce) TextMuted else Color.White,
                                    fontWeight = if (isOpenedViewOnce) FontWeight.Normal else FontWeight.SemiBold,
                                    fontStyle = if (isOpenedViewOnce) FontStyle.Italic else FontStyle.Normal,
                                    style = MaterialTheme.typography.bodyMedium
                                )
                            }
                        }

                        // Real Image / GIF Preview Bubble
                        message.mediaType == MediaType.IMAGE || message.mediaType == MediaType.GIF -> {
                            val imgSource = message.localUri.ifBlank { message.mediaUrl }
                            if (imgSource.isNotBlank()) {
                                AsyncImage(
                                    model = imgSource,
                                    contentDescription = message.fileName.ifBlank { "Photo" },
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .heightIn(min = 140.dp, max = 240.dp)
                                        .clip(RoundedCornerShape(12.dp))
                                        .background(Color(0xFF141414))
                                )
                                if (message.content.isNotBlank() && !message.content.startsWith("📎")) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                    Text(
                                        text = message.content,
                                        color = Color.White,
                                        style = MaterialTheme.typography.bodyLarge
                                    )
                                }
                            } else {
                                Text(
                                    text = message.content.ifBlank { message.fileName },
                                    color = Color.White,
                                    style = MaterialTheme.typography.bodyLarge
                                )
                            }
                        }

                        // Real Voice Note Player Bubble
                        message.mediaType == MediaType.AUDIO -> {
                            val totalMs = audioDurationMs.coerceAtLeast(1000)
                            val progress = (audioProgressMs.toFloat() / totalMs.toFloat()).coerceIn(0f, 1f)
                            val displaySec = if (isAudioPlaying) audioProgressMs / 1000 else (totalMs / 1000)
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.widthIn(min = 210.dp)
                            ) {
                                IconButton(
                                    onClick = onToggleAudioPlay,
                                    modifier = Modifier
                                        .size(36.dp)
                                        .clip(CircleShape)
                                        .background(Color.Black.copy(alpha = 0.25f))
                                ) {
                                    Icon(
                                        imageVector = if (isAudioPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                                        contentDescription = if (isAudioPlaying) "Pause" else "Play",
                                        tint = Color.White
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    LinearProgressIndicator(
                                        progress = { progress },
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(4.dp)
                                            .clip(RoundedCornerShape(2.dp)),
                                        color = Color.White,
                                        trackColor = Color.White.copy(alpha = 0.25f)
                                    )
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = "Voice Note • 0:${displaySec.toString().padStart(2, '0')}",
                                        color = Color.White.copy(alpha = 0.85f),
                                        fontSize = 11.sp
                                    )
                                }
                            }
                        }

                        // File / Video / WebRTC 1 GB P2P Transfer Card
                        message.mediaType == MediaType.FILE || message.mediaType == MediaType.VIDEO || message.isP2pTransfer -> {
                            val status = transferSnapshot?.status ?: message.transferStatus
                            val progress = transferSnapshot?.progressPercentage ?: message.transferProgress
                            val speed = transferSnapshot?.speedBytesPerSec ?: 0L

                            Column(modifier = Modifier.fillMaxWidth()) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color.Black.copy(alpha = 0.22f))
                                        .padding(10.dp)
                                ) {
                                    Icon(
                                        imageVector = when {
                                            message.isP2pTransfer -> Icons.Default.Bolt
                                            message.mediaType == MediaType.VIDEO -> Icons.Default.Videocam
                                            else -> Icons.AutoMirrored.Filled.InsertDriveFile
                                        },
                                        contentDescription = null,
                                        tint = Color.White,
                                        modifier = Modifier.size(28.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = message.fileName.ifBlank { "Attachment" },
                                            color = Color.White,
                                            fontWeight = FontWeight.SemiBold,
                                            fontSize = 14.sp,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            text = buildString {
                                                append(MediaFileInspector.formatFileSize(message.fileSize))
                                                if (message.isP2pTransfer) append(" • WebRTC P2P")
                                                if (status == P2PTransferStatus.COMPLETED) append(" • SHA-256 ✓")
                                            },
                                            color = Color.White.copy(alpha = 0.8f),
                                            fontSize = 11.sp
                                        )
                                    }
                                    if (status == P2PTransferStatus.COMPLETED || status == null) {
                                        IconButton(onClick = onSaveFile, modifier = Modifier.size(32.dp)) {
                                            Icon(
                                                imageVector = Icons.Default.Download,
                                                contentDescription = "Save to Downloads",
                                                tint = Color.White,
                                                modifier = Modifier.size(18.dp)
                                            )
                                        }
                                    }
                                }

                                if (status == P2PTransferStatus.TRANSFERRING || status == P2PTransferStatus.PENDING) {
                                    Spacer(modifier = Modifier.height(6.dp))
                                    LinearProgressIndicator(
                                        progress = { (progress / 100f).coerceIn(0f, 1f) },
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .height(4.dp)
                                            .clip(RoundedCornerShape(2.dp)),
                                        color = Color.White,
                                        trackColor = Color.White.copy(alpha = 0.25f)
                                    )
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        val speedStr = if (speed > 0L) " • ${MediaFileInspector.formatFileSize(speed)}/s" else ""
                                        Text(
                                            text = if (status == P2PTransferStatus.PENDING) "Paused ($progress%)" else "$progress%$speedStr",
                                            color = Color.White.copy(alpha = 0.85f),
                                            fontSize = 11.sp
                                        )
                                        message.transferId?.let { tid ->
                                            Row {
                                                TextButton(
                                                    onClick = {
                                                        if (status == P2PTransferStatus.PENDING) {
                                                            P2PTransferRegistry.resumeTransfer(tid)
                                                        } else {
                                                            P2PTransferRegistry.pauseTransfer(tid)
                                                        }
                                                    },
                                                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)
                                                ) {
                                                    Text(
                                                        if (status == P2PTransferStatus.PENDING) "Resume" else "Pause",
                                                        color = Color.White,
                                                        fontSize = 11.sp
                                                    )
                                                }
                                                TextButton(
                                                    onClick = { P2PTransferRegistry.cancelTransfer(tid) },
                                                    contentPadding = PaddingValues(horizontal = 6.dp, vertical = 0.dp)
                                                ) {
                                                    Text("Cancel", color = Color(0xFFFFB4AB), fontSize = 11.sp)
                                                }
                                            }
                                        }
                                    }
                                }

                                if (message.content.isNotBlank() && !message.content.startsWith("📦") && !message.content.startsWith("📎")) {
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(
                                        text = message.content,
                                        color = Color.White,
                                        style = MaterialTheme.typography.bodyMedium
                                    )
                                }
                            }
                        }

                        // Sticker
                        message.mediaType == MediaType.STICKER -> {
                            val src = message.mediaUrl
                            if (src.startsWith("http") || src.startsWith("content") || src.startsWith("file")) {
                                AsyncImage(
                                    model = src,
                                    contentDescription = "Sticker",
                                    modifier = Modifier.size(120.dp)
                                )
                            } else {
                                Text(text = "🎭", fontSize = 48.sp)
                            }
                        }

                        // Standard Text Message
                        else -> {
                            Text(
                                text = message.content,
                                color = Color.White,
                                style = MaterialTheme.typography.bodyLarge
                            )
                        }
                    }

                    // Time and Read receipts
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        horizontalArrangement = Arrangement.End,
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.align(Alignment.End)
                    ) {
                        Text(
                            text = message.createdAt.ifEmpty { "12:00" },
                            fontSize = 10.sp,
                            color = if (isFromMe) Color.White.copy(alpha = 0.75f) else TextMuted
                        )
                        if (isFromMe) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Default.DoneAll,
                                contentDescription = "Read",
                                tint = Color.White.copy(alpha = 0.85f),
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                }
            }

            // Grouped Emoji Reactions pill beneath bubble
            if (message.reactions.isNotEmpty()) {
                val grouped = message.reactions.groupBy { it.emoji }
                Row(
                    modifier = Modifier
                        .padding(top = 2.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF242424))
                        .padding(horizontal = 6.dp, vertical = 2.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    grouped.forEach { (emoji, list) ->
                        Text(
                            text = if (list.size > 1) "$emoji ${list.size}" else emoji,
                            fontSize = 12.sp,
                            color = Color.White,
                            modifier = Modifier
                                .clickable { onReactionClick(emoji) }
                                .padding(horizontal = 3.dp)
                        )
                    }
                }
            }
        }
    }
}
