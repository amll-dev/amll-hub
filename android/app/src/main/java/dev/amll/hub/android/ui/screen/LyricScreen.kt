package dev.amll.hub.android.ui.screen

import android.app.Activity
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllLyricView
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.theme.Amll

/**
 * 歌词页：与网页端 LyricsPage 一致 —— 整屏只有一个 AMLL 播放器，
 * 歌曲信息、封面、底部控制条、右键菜单都由 AMLL 页面自己绘制。
 */
@Composable
fun LyricScreen(lyricVm: LyricViewModel, playerVm: PlaybackViewModel, nav: AppNav) {
    val lyric by lyricVm.lyric.collectAsStateWithLifecycle()
    val player by playerVm.playerState.collectAsStateWithLifecycle()

    val duration = player.durationMs.takeIf { it > 0 } ?: 0L

    if (lyric.songId.isBlank()) {
        // 没有网易云 ID，解析不了也播不了，这里才需要提示
        Box(Modifier.fillMaxSize().background(Amll.colors.canvas).statusBarsPadding()) {
            EmptyState(
                icon = Icons.Outlined.Inbox,
                title = lyric.error ?: "无法播放",
                description = "这首歌没有关联的网易云 ID",
                modifier = Modifier.align(Alignment.Center),
            )
        }
        return
    }

    // 歌词页永远是深色底：状态栏/导航栏图标固定用浅色，
    // 系统处于浅色模式时主题会把它设成深色图标，在这里覆盖回来，退出时还原。
    val view = LocalView.current
    val darkTheme = isSystemInDarkTheme()
    DisposableEffect(view) {
        val window = (view.context as Activity).window
        val controller = WindowCompat.getInsetsController(window, view)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
        onDispose {
            controller.isAppearanceLightStatusBars = !darkTheme
            controller.isAppearanceLightNavigationBars = !darkTheme
        }
    }

    // 与 AMLL 页面自身的 dark 底色一致，加载中不会闪一下纯黑。
    // 不避让状态栏：WebView 铺满整屏，状态栏高度由原生通过 setInsets 交给页面内缩，
    // 否则状态栏区域会露出这层近黑色底，看起来像一条黑带。
    Box(Modifier.fillMaxSize().background(Color(0xFF0B0B0F))) {
        AmllLyricView(
            rawLyric = lyric.source.text,
            lyricFormat = lyric.source.format,
            lyricTranslation = lyric.source.translation,
            positionMs = player.positionMs,
            playing = player.playing,
            title = lyric.title,
            artist = lyric.artist,
            durationMs = duration,
            cover = lyric.cover,
            dark = true,
            onTogglePlay = playerVm::togglePlay,
            onSeek = playerVm::seekTo,
            onClose = nav.back,
            onNext = playerVm::next,
            onPrev = playerVm::prev,
            onToggleShuffle = playerVm::toggleShuffle,
            onCycleRepeat = playerVm::cycleRepeat,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
