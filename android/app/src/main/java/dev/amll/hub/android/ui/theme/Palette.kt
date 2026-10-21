package dev.amll.hub.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.graphics.Color

@Immutable
data class AmllPalette(
    val canvas: Color,
    val surface: Color,
    val surface2: Color,
    val ink: Color,
    val ink2: Color,
    val ink3: Color,
    val border: Color,
    val primary: Color,
    val primarySoft: Color,
    val onPrimary: Color,
    val success: Color,
    val successSoft: Color,
    val warning: Color,
    val warningSoft: Color,
    val info: Color,
    val infoSoft: Color,
    val isDark: Boolean,
)

/** 浅色 */
val LightPalette = AmllPalette(
    canvas = Color(0xFFFBFBFD),
    surface = Color(0xFFFFFFFF),
    surface2 = Color(0xFFF4F4F7),
    ink = Color(0xFF1D1D1F),
    ink2 = Color(0xFF535359),
    ink3 = Color(0xFF8E8E93),
    border = Color(0xFFE6E6EB),
    primary = Color(0xFFE0303F),
    primarySoft = Color(0xFFFDECEE),
    onPrimary = Color(0xFFFFFFFF),
    success = Color(0xFF3C7A57),
    successSoft = Color(0xFFEDF6F0),
    warning = Color(0xFFC77A1A),
    warningSoft = Color(0xFFFBF1E2),
    info = Color(0xFF3B6FA8),
    infoSoft = Color(0xFFEDF2F9),
    isDark = false,
)

/** 深色 */
val DarkPalette = AmllPalette(
    canvas = Color(0xFF101014),
    surface = Color(0xFF17171D),
    surface2 = Color(0xFF1E1E26),
    ink = Color(0xFFF5F5F7),
    ink2 = Color(0xFFA1A1AA),
    ink3 = Color(0xFF6E6E78),
    border = Color(0xFF2A2A34),
    primary = Color(0xFFF0424F),
    primarySoft = Color(0xFF2A1418),
    onPrimary = Color(0xFFFFFFFF),
    success = Color(0xFF6FA98A),
    successSoft = Color(0xFF16241C),
    warning = Color(0xFFE0A055),
    warningSoft = Color(0xFF2A2015),
    info = Color(0xFF6C9BC9),
    infoSoft = Color(0xFF16202B),
    isDark = true,
)

val LocalAmllPalette = compositionLocalOf { LightPalette }

/** 统一的取值入口：Amll.colors.ink2 */
object Amll {
    val colors: AmllPalette
        @androidx.compose.runtime.Composable
        get() = LocalAmllPalette.current
}
