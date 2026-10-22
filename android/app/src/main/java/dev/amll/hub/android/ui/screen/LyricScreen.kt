package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.component.AmllLyricView
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/**
 * 歌词页：直接挂内置 AMLL 歌词页（WebView），原生只负责外壳与播放控制。
 */
@Composable
fun LyricScreen(vm: AppViewModel, nav: AppNav) {
    val lyric by vm.lyric.collectAsStateWithLifecycle()
    val player by vm.playerState.collectAsStateWithLifecycle()

    val duration = player.durationMs.takeIf { it > 0 }
        ?: lyric.lines.lastOrNull()?.endMs
        ?: 0L

    Box(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding(),
    ) {
        when {
            lyric.loading -> Box(Modifier.fillMaxSize().padding(24.dp)) { SkeletonList(5) }
            lyric.lines.isEmpty() -> EmptyState(
                icon = Icons.Outlined.Inbox,
                title = lyric.error ?: "暂无歌词",
                description = "换一首歌试试",
                modifier = Modifier.align(Alignment.Center),
            )
            else -> AmllLyricView(
                lines = lyric.lines,
                positionMs = player.positionMs,
                playing = player.playing,
                title = lyric.title,
                artist = lyric.artist,
                durationMs = duration,
                dark = Amll.colors.isDark,
                modifier = Modifier
                    .fillMaxSize()
                    .padding(top = 58.dp, bottom = 118.dp),
            )
        }

        // 顶部：返回 + 当前曲目
        Row(
            Modifier
                .fillMaxWidth()
                .height(58.dp)
                .padding(horizontal = 18.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                Icons.Rounded.ChevronLeft,
                "返回",
                tint = Amll.colors.ink,
                modifier = Modifier.size(22.dp).clickable(onClick = nav.back),
            )
            Column(Modifier.weight(1f)) {
                Text(
                    lyric.title.ifBlank { "正在播放" },
                    style = Font.cardTitle.copy(fontSize = 14.sp),
                    color = Amll.colors.ink,
                    maxLines = 1,
                )
                Text(
                    lyric.artist.ifBlank { "AMLL Hub" },
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                )
            }
            Icon(Icons.Rounded.MoreHoriz, "更多", tint = Amll.colors.ink3, modifier = Modifier.size(20.dp))
        }

        // 底部：进度 + 播放控制
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 14.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SeekBar(
                positionMs = player.positionMs,
                durationMs = duration,
                songId = lyric.songId,
                onSeek = vm::seekTo,
            )
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(formatMs(player.positionMs), style = Font.micro, color = Amll.colors.ink3)
                Box(
                    Modifier
                        .size(58.dp)
                        .clip(CircleShape)
                        .background(Amll.colors.ink)
                        .clickable { vm.togglePlay() },
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (player.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                        if (player.playing) "暂停" else "播放",
                        tint = Amll.colors.canvas,
                        modifier = Modifier.size(28.dp),
                    )
                }
                Text(formatMs(duration), style = Font.micro, color = Amll.colors.ink3)
            }
            if (player.error != null) {
                Text(
                    "音源加载失败：${player.error}",
                    style = Font.micro,
                    color = Amll.colors.warning,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else if (!player.playing && player.track?.streamUrl == null) {
                Text(
                    "该歌曲暂无音源，可继续浏览歌词",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun SeekBar(
    positionMs: Long,
    durationMs: Long,
    songId: String,
    onSeek: (Long) -> Unit,
) {
    var dragging by remember { mutableStateOf(false) }
    var dragValue by remember { mutableFloatStateOf(0f) }
    // 换歌时复位拖动状态，避免沿用上一首的进度
    LaunchedEffect(songId) { dragging = false }

    val progress = if (durationMs > 0) {
        (positionMs.toFloat() / durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }
    val value = if (dragging) dragValue else progress

    Slider(
        value = value,
        onValueChange = {
            dragging = true
            dragValue = it
        },
        onValueChangeFinished = {
            dragging = false
            if (durationMs > 0) onSeek((dragValue * durationMs).toLong())
        },
        colors = SliderDefaults.colors(
            thumbColor = Amll.colors.primary,
            activeTrackColor = Amll.colors.primary,
            inactiveTrackColor = Amll.colors.surface2,
        ),
        modifier = Modifier.fillMaxWidth().height(28.dp),
    )
}

fun formatMs(ms: Long): String {
    val total = (ms / 1000).coerceAtLeast(0)
    return "%d:%02d".format(total / 60, total % 60)
}
