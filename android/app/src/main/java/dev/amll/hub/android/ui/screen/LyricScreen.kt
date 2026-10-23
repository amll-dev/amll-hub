package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.component.AmllLyricView
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.theme.Amll

/**
 * 歌词页：和网页端 LyricsPage 完全一致 —— 整屏只有一个 AMLL 播放器。
 *
 * 网页端就是 `fixed inset-0 bg-black` 里塞一个 `PrebuiltLyricPlayer`，
 * 没有标题栏、没有进度条、没有播放按钮，翻页/暂停都交给系统。
 * 这里保持同样的克制：不画任何原生控件，返回走系统返回手势。
 */
@Composable
fun LyricScreen(vm: AppViewModel, nav: AppNav) {
    val lyric by vm.lyric.collectAsStateWithLifecycle()
    val player by vm.playerState.collectAsStateWithLifecycle()

    val duration = player.durationMs.takeIf { it > 0 }
        ?: lyric.lines.lastOrNull()?.endMs
        ?: 0L

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

    // 与 AMLL 页面自身的 dark 底色一致，加载中不会闪一下纯黑
    Box(Modifier.fillMaxSize().background(Color(0xFF0B0B0F))) {
        AmllLyricView(
            lines = lyric.lines,
            positionMs = player.positionMs,
            playing = player.playing,
            title = lyric.title,
            artist = lyric.artist,
            durationMs = duration,
            // 网页端歌词页固定黑底，不跟随 App 主题
            dark = true,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
