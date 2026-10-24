package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllLyricView
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.theme.Amll

/**
 * 歌词页：与网页端 LyricsPage 一致 —— 整屏只有一个 AMLL 播放器，
 * 歌曲信息、封面、底部控制条都由 AMLL 自己绘制。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LyricScreen(lyricVm: LyricViewModel, playerVm: PlaybackViewModel, nav: AppNav) {
    val lyric by lyricVm.lyric.collectAsStateWithLifecycle()
    val player by playerVm.playerState.collectAsStateWithLifecycle()
    var menuOpen by remember { mutableStateOf(false) }

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
            cover = lyric.cover,
            dark = true,
            onTogglePlay = playerVm::togglePlay,
            onSeek = playerVm::seekTo,
            onClose = nav.back,
            onOpenMenu = { menuOpen = true },
            modifier = Modifier.fillMaxSize(),
        )
    }

    if (menuOpen) {
        ModalBottomSheet(
            onDismissRequest = { menuOpen = false },
            containerColor = Amll.colors.surface,
        ) {
            Column(Modifier.fillMaxWidth().navigationBarsPadding()) {
                SheetAction(if (player.playing) "暂停" else "播放") {
                    menuOpen = false
                    playerVm.togglePlay()
                }
                SheetAction("退出歌词页面") {
                    menuOpen = false
                    nav.back()
                }
                Spacer(Modifier.height(16.dp))
            }
        }
    }
}

@Composable
private fun SheetAction(label: String, onClick: () -> Unit) {
    Text(
        text = label,
        color = Amll.colors.ink,
        fontSize = 16.sp,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 24.dp, vertical = 16.dp),
    )
}
