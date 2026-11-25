package com.privatemessenger.app.ui.screens

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import com.privatemessenger.app.BuildConfig
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.model.StickerPack
import com.privatemessenger.app.data.model.ThemeAccent
import com.privatemessenger.app.data.model.User
import com.privatemessenger.app.data.update.InAppUpdateDownloader
import com.privatemessenger.app.data.update.ReleaseInfo
import com.privatemessenger.app.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    currentUser: User,
    stickerPacks: List<StickerPack>,
    accent: ThemeAccent,
    wallpaper: String,
    onBack: () -> Unit,
    onUpdateProfile: (displayName: String, bio: String) -> Unit,
    onUpdateAvatar: (avatarUri: String) -> Unit = {},
    onUpdateAccent: (ThemeAccent) -> Unit,
    onUpdateWallpaper: (String) -> Unit,
    onCreateStickerPack: (name: String) -> Unit,
    onAddStickerToPack: (packId: String, imageUri: String) -> Unit = { _, _ -> },
    onDeleteStickerPack: (String) -> Unit,
    onSignOut: () -> Unit = {},
    updateInfo: ReleaseInfo? = null,
    updateDownloadState: InAppUpdateDownloader.DownloadState = InAppUpdateDownloader.DownloadState.Idle,
    onCheckForUpdates: () -> Unit = {},
    onUpdateClick: ((ReleaseInfo) -> Unit)? = null
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var displayName by remember(currentUser.displayName) { mutableStateOf(currentUser.displayName) }
    var bio by remember(currentUser.bio) { mutableStateOf(currentUser.bio) }
    var isEditing by remember { mutableStateOf(false) }

    var newPackName by remember { mutableStateOf("") }
    var showNewPackDialog by remember { mutableStateOf(false) }
    var targetPackForSticker by remember { mutableStateOf<String?>(null) }

    val avatarPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        if (uri != null) {
            scope.launch {
                val res = MediaFileInspector.inspectAndCache(context, uri, persistLocalCopy = true, computeSha256 = false)
                res.onSuccess { inspected ->
                    val localPath = inspected.localCachePath.ifBlank { uri.toString() }
                    onUpdateAvatar(localPath)
                }
            }
        }
    }

    val stickerPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        val packId = targetPackForSticker
        if (uri != null && packId != null) {
            scope.launch {
                val res = MediaFileInspector.inspectAndCache(context, uri, persistLocalCopy = true, computeSha256 = false)
                res.onSuccess { inspected ->
                    onAddStickerToPack(packId, inspected.localCachePath.ifBlank { uri.toString() })
                }
            }
        }
        targetPackForSticker = null
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
                    Text(
                        text = "Profile & Settings",
                        style = MaterialTheme.typography.titleLarge,
                        color = TextPrimary
                    )
                },
                actions = {
                    if (isEditing) {
                        TextButton(
                            onClick = {
                                val cleaned = displayName.trim().ifBlank { currentUser.displayName }
                                displayName = cleaned
                                onUpdateProfile(cleaned, bio.trim())
                                isEditing = false
                            }
                        ) {
                            Text("Save", color = Color(accent.primaryHex), fontWeight = FontWeight.Bold)
                        }
                    } else {
                        IconButton(onClick = { isEditing = true }) {
                            Icon(
                                imageVector = Icons.Default.Edit,
                                contentDescription = "Edit Profile",
                                tint = Color(accent.primaryHex)
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = SurfaceHeader
                )
            )
        },
        containerColor = OledBackground
    ) { paddingValues ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(16.dp)
        ) {
            // Profile Header Card (with clickable real avatar picker)
            item {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(SurfaceElevated)
                        .padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Box(
                        contentAlignment = Alignment.BottomEnd,
                        modifier = Modifier.clickable {
                            avatarPickerLauncher.launch(
                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                            )
                        }
                    ) {
                        Box(
                            modifier = Modifier
                                .size(92.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF242424))
                                .border(2.dp, Color(accent.primaryHex), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            if (currentUser.avatarUrl.isNotBlank()) {
                                AsyncImage(
                                    model = currentUser.avatarUrl,
                                    contentDescription = displayName,
                                    contentScale = ContentScale.Crop,
                                    modifier = Modifier.fillMaxSize().clip(CircleShape)
                                )
                            } else {
                                Text(
                                    text = displayName.ifBlank { "U" }.take(1).uppercase(),
                                    color = Color.White,
                                    fontSize = 36.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }
                        Box(
                            modifier = Modifier
                                .size(30.dp)
                                .clip(CircleShape)
                                .background(Color(accent.primaryHex)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Default.CameraAlt,
                                contentDescription = "Change avatar photo",
                                tint = Color.White,
                                modifier = Modifier.size(16.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    if (isEditing) {
                        OutlinedTextField(
                            value = displayName,
                            onValueChange = { displayName = it },
                            label = { Text("Display Name") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary,
                                focusedBorderColor = Color(accent.primaryHex)
                            )
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        OutlinedTextField(
                            value = bio,
                            onValueChange = { bio = it },
                            label = { Text("Bio / About") },
                            modifier = Modifier.fillMaxWidth(),
                            maxLines = 3,
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedTextColor = TextPrimary,
                                unfocusedTextColor = TextPrimary,
                                focusedBorderColor = Color(accent.primaryHex)
                            )
                        )
                    } else {
                        Text(
                            text = displayName,
                            style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = currentUser.email,
                            style = MaterialTheme.typography.bodyMedium,
                            color = TextMuted
                        )
                        if (bio.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = bio,
                                style = MaterialTheme.typography.bodyLarge,
                                color = TextSecondary
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(20.dp))
            }

            // Global Accent Themes
            item {
                Text(
                    text = "Theme Accent (OLED Dark)",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    modifier = Modifier.padding(bottom = 12.dp)
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    ThemeAccent.entries.forEach { themeOption ->
                        val isSelected = themeOption == accent
                        Box(
                            modifier = Modifier
                                .size(54.dp)
                                .clip(CircleShape)
                                .background(Color(themeOption.primaryHex))
                                .border(
                                    width = if (isSelected) 3.dp else 0.dp,
                                    color = Color.White,
                                    shape = CircleShape
                                )
                                .clickable { onUpdateAccent(themeOption) },
                            contentAlignment = Alignment.Center
                        ) {
                            if (isSelected) {
                                Icon(
                                    imageVector = Icons.Default.Check,
                                    contentDescription = "Selected",
                                    tint = Color.White,
                                    modifier = Modifier.size(24.dp)
                                )
                            }
                        }
                    }
                }
                Spacer(modifier = Modifier.height(20.dp))
            }

            // Chat Wallpaper Presets
            item {
                Text(
                    text = "Chat Wallpaper",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary,
                    modifier = Modifier.padding(bottom = 10.dp)
                )
                val presets = listOf(
                    "pure-black" to ("Pure OLED" to Color(0xFF000000)),
                    "midnight-gradient" to ("Midnight" to Color(0xFF070712)),
                    "emerald-mist" to ("Emerald" to Color(0xFF04100C)),
                    "crimson-velvet" to ("Crimson" to Color(0xFF120508))
                )
                LazyRow(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(presets) { (key, info) ->
                        val isSelected = wallpaper == key || (wallpaper.isBlank() && key == "pure-black")
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(info.second)
                                .border(
                                    width = if (isSelected) 2.dp else 1.dp,
                                    color = if (isSelected) Color(accent.primaryHex) else BorderDark,
                                    shape = RoundedCornerShape(12.dp)
                                )
                                .clickable { onUpdateWallpaper(key) }
                                .padding(horizontal = 14.dp, vertical = 10.dp)
                        ) {
                            Text(
                                text = info.first,
                                color = Color.White,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                            )
                        }
                    }
                }
                Spacer(modifier = Modifier.height(24.dp))
            }

            // Custom Sticker Pack Manager
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Custom Sticker Packs",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )

                    TextButton(onClick = { showNewPackDialog = true }) {
                        Icon(
                            imageVector = Icons.Default.Add,
                            contentDescription = "Add Pack",
                            tint = Color(accent.primaryHex),
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("New Pack", color = Color(accent.primaryHex))
                    }
                }

                if (stickerPacks.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(SurfaceElevated)
                            .padding(20.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No custom sticker packs yet. Create one!",
                            color = TextMuted,
                            style = MaterialTheme.typography.bodyMedium
                        )
                    }
                } else {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        stickerPacks.forEach { pack ->
                            Card(
                                shape = RoundedCornerShape(12.dp),
                                colors = CardDefaults.cardColors(containerColor = SurfaceElevated)
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(14.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = pack.name,
                                            style = MaterialTheme.typography.titleMedium,
                                            color = TextPrimary
                                        )
                                        Text(
                                            text = "${pack.stickers.size} stickers",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = TextMuted
                                        )
                                    }

                                    Row {
                                        IconButton(onClick = {
                                            targetPackForSticker = pack.id
                                            stickerPickerLauncher.launch(
                                                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                                            )
                                        }) {
                                            Icon(
                                                imageVector = Icons.Default.AddPhotoAlternate,
                                                contentDescription = "Add Sticker",
                                                tint = Color(accent.primaryHex)
                                            )
                                        }
                                        IconButton(onClick = { onDeleteStickerPack(pack.id) }) {
                                            Icon(
                                                imageVector = Icons.Default.Delete,
                                                contentDescription = "Delete Pack",
                                                tint = Color(0xFFEF4444)
                                            )
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // App Updates & Version Section (In-App APK Downloader preserved intact)
            item {
                Spacer(modifier = Modifier.height(28.dp))
                Text(
                    text = "App Updates & Version",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Spacer(modifier = Modifier.height(12.dp))

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(SurfaceElevated)
                        .padding(16.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Column {
                            Text(
                                text = "Installed Version",
                                color = TextSecondary,
                                fontSize = 13.sp
                            )
                            Text(
                                text = "v${BuildConfig.VERSION_NAME} (Native Android APK)",
                                color = TextPrimary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 15.sp
                            )
                        }

                        Button(
                            onClick = onCheckForUpdates,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(accent.primaryHex),
                                contentColor = Color.White
                            ),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = "Check for updates",
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Check Updates", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }

                    if (updateInfo != null) {
                        Spacer(modifier = Modifier.height(16.dp))
                        HorizontalDivider(color = BorderDark)
                        Spacer(modifier = Modifier.height(16.dp))

                        val sizeLabel = if (updateInfo.fileSize > 0L) " (${InAppUpdateDownloader.formatBytes(updateInfo.fileSize)})" else ""
                        Text(
                            text = "New Update Available: v${updateInfo.versionName}$sizeLabel",
                            color = Color(accent.primaryHex),
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp
                        )
                        if (updateInfo.releaseNotes.isNotBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = updateInfo.releaseNotes.take(120) + if (updateInfo.releaseNotes.length > 120) "..." else "",
                                color = TextSecondary,
                                fontSize = 12.sp
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        if (updateDownloadState is InAppUpdateDownloader.DownloadState.Downloading) {
                            val pct = (updateDownloadState.progress * 100).toInt()
                            val speed = InAppUpdateDownloader.formatSpeed(updateDownloadState.speedBytesPerSec)
                            val dl = InAppUpdateDownloader.formatBytes(updateDownloadState.downloadedBytes)
                            val total = if (updateDownloadState.totalBytes > 0L) InAppUpdateDownloader.formatBytes(updateDownloadState.totalBytes) else "17.4 MB"

                            Text(
                                text = "Downloading: $pct% ($dl / $total) • $speed",
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Medium
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            LinearProgressIndicator(
                                progress = { updateDownloadState.progress },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(6.dp)
                                    .clip(RoundedCornerShape(3.dp)),
                                color = Color(accent.primaryHex),
                                trackColor = Color(0xFF242424)
                            )
                        } else {
                            Button(
                                onClick = { onUpdateClick?.invoke(updateInfo) },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(accent.primaryHex),
                                    contentColor = Color.White
                                ),
                                shape = RoundedCornerShape(10.dp),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                val label = when (updateDownloadState) {
                                    is InAppUpdateDownloader.DownloadState.ReadyToInstall -> "Install Update Now"
                                    is InAppUpdateDownloader.DownloadState.Error -> "Download Failed — Tap to Retry"
                                    else -> "Fast In-App Download"
                                }
                                Icon(
                                    imageVector = Icons.Default.Download,
                                    contentDescription = label,
                                    modifier = Modifier.size(18.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    text = label,
                                    fontWeight = FontWeight.Bold,
                                    fontSize = 14.sp
                                )
                            }
                        }
                    }
                }
            }

            // Account & Session Sign Out Section
            item {
                Spacer(modifier = Modifier.height(28.dp))
                Button(
                    onClick = onSignOut,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF1E1E1E),
                        contentColor = Color(0xFFEF4444)
                    ),
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(50.dp)
                        .border(1.dp, Color(0xFF333333), RoundedCornerShape(12.dp))
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ExitToApp,
                        contentDescription = "Sign Out",
                        tint = Color(0xFFEF4444),
                        modifier = Modifier.size(20.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Sign Out",
                        color = Color(0xFFEF4444),
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                }
                Spacer(modifier = Modifier.height(24.dp))
            }
        }

        // Create Sticker Pack Dialog
        if (showNewPackDialog) {
            AlertDialog(
                onDismissRequest = { showNewPackDialog = false },
                title = { Text("Create Sticker Pack", color = TextPrimary) },
                text = {
                    OutlinedTextField(
                        value = newPackName,
                        onValueChange = { newPackName = it },
                        placeholder = { Text("Pack name (e.g. Memes, Anime)") },
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedTextColor = TextPrimary,
                            unfocusedTextColor = TextPrimary,
                            focusedBorderColor = Color(accent.primaryHex)
                        )
                    )
                },
                confirmButton = {
                    TextButton(
                        onClick = {
                            if (newPackName.isNotBlank()) {
                                onCreateStickerPack(newPackName.trim())
                                newPackName = ""
                                showNewPackDialog = false
                            }
                        }
                    ) {
                        Text("Create", color = Color(accent.primaryHex), fontWeight = FontWeight.Bold)
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showNewPackDialog = false }) {
                        Text("Cancel", color = TextMuted)
                    }
                },
                containerColor = SurfaceElevated
            )
        }
    }
}
