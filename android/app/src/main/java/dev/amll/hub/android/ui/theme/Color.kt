package dev.amll.hub.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * 配色对齐网页端 index.css 的 --amll-* 设计 token。
 * 深色为默认基调（与网页端 html.dark 一致），浅色跟随系统。
 */

// 品牌红
private val AmllPinkLight = Color(0xFFE0303F)
private val AmllPinkDark = Color(0xFFF0424F)
private val AmllPinkHoverLight = Color(0xFFC82836)
private val AmllPinkHoverDark = Color(0xFFFF5763)

// 浅色主题
private val LightColors = lightColorScheme(
    primary = AmllPinkLight,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFFBE7E9),
    onPrimaryContainer = Color(0xFF8C1621),
    secondary = Color(0xFF2A7AB8),
    onSecondary = Color.White,
    background = Color(0xFFFBFBFD),
    onBackground = Color(0xFF1D1D1F),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF1D1D1F),
    surfaceVariant = Color(0xFFF2F2F5),
    onSurfaceVariant = Color(0xFF535359),
    outline = Color(0xFFE6E6EB),
    outlineVariant = Color(0xFFEDEDF1),
    error = Color(0xFFD12D2D),
    onError = Color.White,
)

// 深色主题（网页端 html.dark 的镜像）
private val DarkColors = darkColorScheme(
    primary = AmllPinkDark,
    onPrimary = Color.White,
    primaryContainer = Color(0xFF5C1620),
    onPrimaryContainer = Color(0xFFFFD9DC),
    secondary = Color(0xFF5AA9E0),
    onSecondary = Color(0xFF08243A),
    background = Color(0xFF101014),
    onBackground = Color(0xFFF5F5F7),
    surface = Color(0xFF1A1A1F),
    onSurface = Color(0xFFF5F5F7),
    surfaceVariant = Color(0xFF26262C),
    onSurfaceVariant = Color(0xFF9A9AA2),
    outline = Color(0xFF3A3A42),
    outlineVariant = Color(0xFF2A2A31),
    error = Color(0xFFFF6B6B),
    onError = Color(0xFF3A0A0A),
)

@Composable
fun AmllHubTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            window.statusBarColor = colorScheme.background.toArgb()
            WindowCompat.getInsetsController(window, view)
                .isAppearanceLightStatusBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AmllTypography,
        content = content,
    )
}
