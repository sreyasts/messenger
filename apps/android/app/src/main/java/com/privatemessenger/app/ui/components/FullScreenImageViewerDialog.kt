package com.privatemessenger.app.ui.components

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import com.privatemessenger.app.data.media.MediaFileInspector
import com.privatemessenger.app.data.model.Message
import kotlinx.coroutines.launch

/**
 * Full-screen pinch-to-zoom viewer for standard (non-view-once) images,
 * with Save to Downloads and Open Externally actions.
 */
@Composable
fun FullScreenImageViewerDialog(
    message: Message,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val imageSource = message.localUri.ifBlank { message.mediaUrl }

    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }
    var isSaving by remember { mutableStateOf(false) }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            dismissOnBackPress = true,
            dismissOnClickOutside = true,
            usePlatformDefaultWidth = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .systemBarsPadding()
        ) {
            AsyncImage(
                model = imageSource,
                contentDescription = message.fileName.ifBlank { "Image" },
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val newScale = (scale * zoom).coerceIn(1f, 4f)
                            scale = newScale
                            if (newScale > 1f) {
                                offsetX += pan.x
                                offsetY += pan.y
                            } else {
                                offsetX = 0f
                                offsetY = 0f
                            }
                        }
                    }
                    .graphicsLayer(
                        scaleX = scale,
                        scaleY = scale,
                        translationX = offsetX,
                        translationY = offsetY
                    )
            )

            // Top Action Bar
            Row(
                modifier = Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .background(Color.Black.copy(alpha = 0.6f))
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                }

                Column(modifier = Modifier.weight(1f).padding(horizontal = 8.dp)) {
                    Text(
                        text = message.fileName.ifBlank { "Photo" },
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 15.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    if (message.fileSize > 0L) {
                        Text(
                            text = MediaFileInspector.formatFileSize(message.fileSize),
                            color = Color(0xFFA0A0A0),
                            fontSize = 12.sp
                        )
                    }
                }

                Row {
                    IconButton(
                        enabled = !isSaving,
                        onClick = {
                            isSaving = true
                            scope.launch {
                                val res = MediaFileInspector.saveToDownloads(
                                    context = context,
                                    sourceUrlOrUri = imageSource,
                                    fileName = message.fileName.ifBlank { "photo_${System.currentTimeMillis()}.jpg" },
                                    mimeType = message.mimeType.ifBlank { "image/jpeg" }
                                )
                                isSaving = false
                                res.fold(
                                    onSuccess = {
                                        Toast.makeText(context, "Saved to Downloads/PrivateMessenger", Toast.LENGTH_SHORT).show()
                                    },
                                    onFailure = {
                                        Toast.makeText(context, "Save failed: ${it.localizedMessage}", Toast.LENGTH_SHORT).show()
                                    }
                                )
                            }
                        }
                    ) {
                        Icon(Icons.Default.Download, contentDescription = "Save to Downloads", tint = Color.White)
                    }

                    IconButton(
                        onClick = {
                            val opened = MediaFileInspector.openFileWithSystemViewer(
                                context = context,
                                sourceUrlOrUri = imageSource,
                                mimeType = message.mimeType.ifBlank { "image/*" }
                            )
                            if (!opened) {
                                Toast.makeText(context, "No viewer app available", Toast.LENGTH_SHORT).show()
                            }
                        }
                    ) {
                        Icon(Icons.Default.OpenInNew, contentDescription = "Open Externally", tint = Color.White)
                    }
                }
            }

            if (message.content.isNotBlank() && !message.content.startsWith("📎")) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .fillMaxWidth()
                        .background(Color.Black.copy(alpha = 0.7f))
                        .padding(16.dp)
                ) {
                    Text(
                        text = message.content,
                        color = Color.White,
                        style = MaterialTheme.typography.bodyLarge
                    )
                }
            }
        }
    }
}
