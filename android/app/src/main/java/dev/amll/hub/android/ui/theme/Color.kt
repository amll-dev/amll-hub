package dev.amll.hub.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * 设计系统唯一真源是 [AmllPalette]：M3 的 [ColorScheme] 由它逐项推导，
 * 不再单独维护第二套色值，避免同一角色出现两个近似色。
 */
private fun AmllPalette.toColorScheme(): ColorScheme {
    val scheme = if (isDark) darkColorScheme() else lightColorScheme()
    return scheme.copy(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = primarySoft,
        onPrimaryContainer = primary,
        inversePrimary = primary,
        secondary = info,
        onSecondary = onPrimary,
        secondaryContainer = infoSoft,
        onSecondaryContainer = info,
        tertiary = success,
        onTertiary = onPrimary,
        tertiaryContainer = successSoft,
        onTertiaryContainer = success,
        background = canvas,
        onBackground = ink,
        surface = surface,
        onSurface = ink,
        surfaceVariant = surface2,
        onSurfaceVariant = ink2,
        surfaceTint = primary,
        inverseSurface = ink,
        inverseOnSurface = canvas,
        error = error,
        onError = onError,
        errorContainer = primarySoft,
        onErrorContainer = primary,
        outline = border,
        outlineVariant = border,
        scrim = Color.Black,
        surfaceBright = surface,
        surfaceDim = canvas,
        surfaceContainerLowest = if (isDark) canvas else surface,
        surfaceContainerLow = if (isDark) surface else surface,
        surfaceContainer = surface2,
        surfaceContainerHigh = surface2,
        surfaceContainerHighest = surface2,
    )
}

@Composable
fun AmllHubTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val palette = if (darkTheme) DarkPalette else LightPalette
    val view = LocalView.current

    if (!view.isInEditMode) {
        SideEffect {
            // edge-to-edge 下状态栏/导航栏透明，只负责图标明暗；颜色由窗口底色透出
            val window = (view.context as Activity).window
            val controller = WindowCompat.getInsetsController(window, view)
            controller.isAppearanceLightStatusBars = !darkTheme
            controller.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    MaterialTheme(
        colorScheme = palette.toColorScheme(),
        typography = AmllTypography,
        shapes = AmllShapes,
    ) {
        CompositionLocalProvider(
            LocalAmllPalette provides palette,
            content = content,
        )
    }
}
