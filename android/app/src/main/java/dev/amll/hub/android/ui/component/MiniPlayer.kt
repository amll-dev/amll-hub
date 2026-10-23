package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Pause
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.playback.PlayerController
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/**
 * 迷你播放器：贴在底部 Tab 栏上方，点封面或信息区进 AMLL 歌词页。
 * 没有曲目时整块不占位。
 *
 * 卡片本身不铺底色，毛玻璃由外层传进来的 [modifier] 提供，
 * 这样下面滚动的内容才能透上来。
 */
@Composable
fun MiniPlayer(
    state: PlayerController.State,
    onOpen: () -> Unit,
    onToggle: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val track = state.track ?: return
    val fraction = if (state.durationMs > 0) {
        (state.positionMs.toFloat() / state.durationMs.toFloat()).coerceIn(0f, 1f)
    } else {
        0f
    }
    val shape = RoundedCornerShape(Radius.card)

    Column(
        Modifier
            .fillMaxWidth()
            // 与胶囊导航左右对齐（都是 12dp）
            .padding(horizontal = 12.dp)
            .fillMaxWidth()
            // 先裁圆角再叠毛玻璃，否则模糊会画到圆角外面
            .clip(shape)
            .then(modifier)
            .border(0.5.dp, Amll.colors.border.copy(alpha = 0.55f), shape)
            .clickable(onClick = onOpen),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(54.dp)
                .padding(start = 9.dp, end = 9.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // 封面单独可点：与网页端一致，点封面直接进歌词页
            Box(Modifier.clip(RoundedCornerShape(10.dp)).clickable(onClick = onOpen)) {
                CoverImage(track.coverUrl, track.title, 38.dp, radius = 10.dp)
            }
            Column(
                Modifier.weight(1f).clickable(onClick = onOpen),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    track.title.ifBlank { "正在播放" },
                    style = Font.bodyMedium,
                    color = Amll.colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    track.artist.ifBlank { "AMLL Hub" },
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                Modifier
                    .size(36.dp)
                    .clip(CircleShape)
                    .background(Amll.colors.surface2.copy(alpha = 0.7f))
                    .clickable(onClick = onToggle),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    imageVector = if (state.playing) Icons.Rounded.Pause else Icons.Rounded.PlayArrow,
                    contentDescription = if (state.playing) "暂停" else "播放",
                    tint = Amll.colors.ink,
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(2.dp)
                .background(Amll.colors.ink3.copy(alpha = 0.22f)),
        ) {
            if (fraction > 0f) {
                Box(
                    Modifier
                        .fillMaxWidth(fraction)
                        .fillMaxHeight()
                        .background(Amll.colors.primary),
                )
            }
        }
    }
}
