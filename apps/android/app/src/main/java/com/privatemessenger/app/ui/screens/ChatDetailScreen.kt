@file:OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
package com.privatemessenger.app.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatemessenger.app.data.model.*
import com.privatemessenger.app.ui.theme.*
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatDetailScreen(
    conversation: Conversation,
    messages: List<Message>,
    currentUserId: String,
    accent: ThemeAccent,
    onBack: () -> Unit,
    onSendMessage: (content: String, replyTo: Message?, isViewOnce: Boolean) -> Unit,
    onSendFile: (fileName: String, fileSize: Long, isP2p: Boolean) -> Unit,
    onVoiceCall: () -> Unit,
    onVideoCall: () -> Unit,
    onContactProfileClick: () -> Unit,
    isViewOnceViewed: ((String) -> Boolean)? = null,
    onOpenViewOnce: (Message) -> Unit,
    onDeleteForEveryone: (Message) -> Unit,
    onAddReaction: (Message, String) -> Unit
) {
    val title = conversation.title ?: conversation.otherUser?.displayName ?: "Friend"
    var inputText by remember { mutableStateOf("") }
    var replyingTo by remember { mutableStateOf<Message?>(null) }
    var isViewOnceSelected by remember { mutableStateOf(false) }
    var showAttachMenu by remember { mutableStateOf(false) }
    var showStickerTray by remember { mutableStateOf(false) }
    var isRecordingAudio by remember { mutableStateOf(false) }
    var recordingSeconds by remember { mutableIntStateOf(0) }

    // Long press context menu state
    var selectedMessageForMenu by remember { mutableStateOf<Message?>(null) }
    var showPartnerProfileDialog by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val haptic = LocalHapticFeedback.current

    LaunchedEffect(isRecordingAudio) {
        if (isRecordingAudio) {
            recordingSeconds = 0
            while (isRecordingAudio) {
                kotlinx.coroutines.delay(1000)
                recordingSeconds++
            }
        }
    }

    Scaffold(
        topBar = {
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
                            onClick = { showPartnerProfileDialog = true }
                        )
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF242424)),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = title.take(1).uppercase(),
                                color = Color.White,
                                fontWeight = FontWeight.Bold,
                                fontSize = 16.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = title,
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = TextPrimary
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
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SurfaceHeader
                )
            )
        },
        containerColor = OledBackground,
        bottomBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(SurfaceElevated)
            ) {
                // Quoted reply banner
                replyingTo?.let { replyMsg ->
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF1A1A1A))
                            .padding(horizontal = 16.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Replying to ${if (replyMsg.senderId == currentUserId) "You" else title}",
                                color = Color(accent.primaryHex),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold
                            )
                            Text(
                                text = replyMsg.content.ifEmpty { "[Media]" },
                                color = TextSecondary,
                                style = MaterialTheme.typography.bodyMedium,
                                maxLines = 1
                            )
                        }
                        IconButton(
                            onClick = { replyingTo = null },
                            modifier = Modifier.size(24.dp)
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

                // Audio recording status banner
                AnimatedVisibility(visible = isRecordingAudio) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF221111))
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Box(
                                modifier = Modifier
                                    .size(12.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFFEF4444))
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "Recording Voice Note... 0:${recordingSeconds.toString().padStart(2, '0')}",
                                color = Color.White,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        TextButton(onClick = { isRecordingAudio = false; recordingSeconds = 0 }) {
                            Text("Cancel", color = Color(0xFFEF4444))
                        }
                    }
                }

                // Composer Row
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Emoji / Sticker tray button
                    IconButton(onClick = { showStickerTray = !showStickerTray }) {
                        Icon(
                            imageVector = Icons.Default.EmojiEmotions,
                            contentDescription = "Stickers & Emojis",
                            tint = if (showStickerTray) Color(accent.primaryHex) else TextMuted
                        )
                    }

                    // Attach button
                    IconButton(onClick = { showAttachMenu = true }) {
                        Icon(
                            imageVector = Icons.Default.AttachFile,
                            contentDescription = "Attach File",
                            tint = TextMuted
                        )
                    }

                    // View Once Toggle Button (1 icon)
                    IconButton(onClick = { isViewOnceSelected = !isViewOnceSelected }) {
                        Icon(
                            imageVector = if (isViewOnceSelected) Icons.Default.Lock else Icons.Default.LockOpen,
                            contentDescription = "View Once Toggle",
                            tint = if (isViewOnceSelected) Color(0xFFE1306C) else TextMuted
                        )
                    }

                    // Text Input
                    OutlinedTextField(
                        value = inputText,
                        onValueChange = { inputText = it },
                        placeholder = {
                            Text(
                                if (isViewOnceSelected) "View Once message..." else "Message...",
                                color = TextMuted
                            )
                        },
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 4.dp),
                        shape = RoundedCornerShape(20.dp),
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

                    // Send or Voice Note Mic
                    if (inputText.isNotBlank()) {
                        IconButton(
                            onClick = {
                                onSendMessage(inputText, replyingTo, isViewOnceSelected)
                                inputText = ""
                                replyingTo = null
                                isViewOnceSelected = false
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
                                    onSendMessage("🎤 Voice Note (0:${recordingSeconds.toString().padStart(2, '0')})", null, false)
                                    isRecordingAudio = false
                                    recordingSeconds = 0
                                } else {
                                    isRecordingAudio = true
                                    recordingSeconds = 0
                                }
                            }
                        ) {
                            Icon(
                                imageVector = Icons.Default.Mic,
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
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 12.dp),
                reverseLayout = false
            ) {
                items(messages, key = { it.id }) { msg ->
                    MessageBubbleItem(
                        message = msg,
                        isFromMe = msg.senderId == currentUserId,
                        accent = accent,
                        isViewOnceViewed = isViewOnceViewed,
                        onSwipeToReply = {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            replyingTo = msg
                        },
                        onLongPress = {
                            selectedMessageForMenu = msg
                        },
                        onOpenViewOnce = { onOpenViewOnce(msg) },
                        onReactionClick = { emoji -> onAddReaction(msg, emoji) }
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                }
            }

            // Floating Long-Press Context Menu & Reaction Bar
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
                        // Emoji Reaction Bar
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

                        // Action Options
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

            // Attachment Tray Dropdown / Modal
            if (showAttachMenu) {
                AlertDialog(
                    onDismissRequest = { showAttachMenu = false },
                    title = { Text("Attach Media / File", color = TextPrimary) },
                    text = {
                        Column {
                            TextButton(
                                onClick = {
                                    onSendFile("photo_${System.currentTimeMillis()}.jpg", 4_200_000L, false)
                                    showAttachMenu = false
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Upload Image (<= 50 MB Supabase Storage)", color = Color.White, modifier = Modifier.fillMaxWidth())
                            }
                            TextButton(
                                onClick = {
                                    onSendFile("large_archive_${System.currentTimeMillis()}.zip", 750_000_000L, true)
                                    showAttachMenu = false
                                },
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Send Large File (Up to 1 GB WebRTC P2P)", color = Color(accent.primaryHex), modifier = Modifier.fillMaxWidth())
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

            // Partner Public Profile Card Modal
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
                                    text = partnerName.take(1).uppercase(),
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

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubbleItem(
    message: Message,
    isFromMe: Boolean,
    accent: ThemeAccent,
    isViewOnceViewed: ((String) -> Boolean)? = null,
    onSwipeToReply: () -> Unit,
    onLongPress: () -> Unit,
    onOpenViewOnce: () -> Unit,
    onReactionClick: (String) -> Unit
) {
    var offsetX by remember { mutableFloatStateOf(0f) }

    val draggableState = rememberDraggableState { delta ->
        if (delta > 0 || offsetX > 0) {
            val newOffset = (offsetX + delta).coerceIn(0f, 120f)
            offsetX = newOffset
            if (newOffset >= 100f) {
                onSwipeToReply()
                offsetX = 0f
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .offset { IntOffset(offsetX.roundToInt(), 0) }
            .draggable(
                state = draggableState,
                orientation = Orientation.Horizontal,
                onDragStopped = { offsetX = 0f }
            ),
        contentAlignment = if (isFromMe) Alignment.CenterEnd else Alignment.CenterStart
    ) {
        Column(
            horizontalAlignment = if (isFromMe) Alignment.End else Alignment.Start,
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            // Message Bubble Card
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
                modifier = Modifier.combinedClickable(
                    onLongClick = onLongPress,
                    onClick = {
                        val isAlreadyViewed = message.viewedAt != null || isViewOnceViewed?.invoke(message.id) == true
                        if (message.isViewOnce && !isAlreadyViewed) {
                            onOpenViewOnce()
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
                                    maxLines = 1
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    // Deleted for everyone
                    if (message.deletedForEveryone) {
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
                    } else if (message.isViewOnce) {
                        // View Once Media
                        val isOpened = message.viewedAt != null || isViewOnceViewed?.invoke(message.id) == true
                        val label = if (isOpened) {
                            "Opened"
                        } else {
                            when (message.mediaType) {
                                MediaType.TEXT -> "1 Text • View Once"
                                MediaType.VIDEO -> "1 Video • View Once"
                                else -> "1 Photo • View Once"
                            }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Lock,
                                contentDescription = "View Once",
                                tint = if (isOpened) TextMuted else Color.White,
                                modifier = Modifier.size(18.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = label,
                                color = if (isOpened) TextMuted else Color.White,
                                fontWeight = if (isOpened) FontWeight.Normal else FontWeight.Bold,
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                    } else {
                        // Normal text or media
                        Text(
                            text = message.content,
                            color = Color.White,
                            style = MaterialTheme.typography.bodyLarge
                        )
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
                            color = TextMuted
                        )
                        if (isFromMe) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Icon(
                                imageVector = Icons.Default.DoneAll,
                                contentDescription = "Read",
                                tint = Color(accent.primaryHex),
                                modifier = Modifier.size(14.dp)
                            )
                        }
                    }
                }
            }

            // Reactions pill beneath bubble
            if (message.reactions.isNotEmpty()) {
                Row(
                    modifier = Modifier
                        .padding(top = 2.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Color(0xFF242424))
                        .padding(horizontal = 6.dp, vertical = 2.dp)
                ) {
                    message.reactions.forEach { reaction ->
                        Text(
                            text = reaction.emoji,
                            fontSize = 12.sp,
                            modifier = Modifier
                                .clickable { onReactionClick(reaction.emoji) }
                                .padding(horizontal = 2.dp)
                        )
                    }
                }
            }
        }
    }
}
