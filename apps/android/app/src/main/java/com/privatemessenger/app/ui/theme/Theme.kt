package com.privatemessenger.app.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.privatemessenger.app.data.model.ThemeAccent

@Composable
fun PrivateMessengerTheme(
    accent: ThemeAccent = ThemeAccent.VIOLET_PINK,
    content: @Composable () -> Unit
) {
    val primaryColor = Color(accent.primaryHex)
    val secondaryColor = Color(accent.outgoingHex)

    val colorScheme = darkColorScheme(
        primary = primaryColor,
        secondary = secondaryColor,
        background = OledBackground,
        surface = SurfaceElevated,
        surfaceVariant = SurfaceSubtle,
        onPrimary = Color.White,
        onSecondary = Color.White,
        onBackground = TextPrimary,
        onSurface = TextPrimary,
        onSurfaceVariant = TextSecondary,
        outline = BorderDark
    )

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}
