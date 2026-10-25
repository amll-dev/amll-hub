package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Radius

/**
 * 解析页的歌词预览：固定高度内复用 AMLL 歌词页，只负责渲染，
 * 播放控制全部为空操作，避免预览误控当前正在播放的曲目。
 */
@Composable
fun AmllLyricPreview(
    rawLyric: String,
    lyricFormat: String,
    lyricTranslation: String,
    title: String,
    artist: String,
    cover: String?,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(320.dp)
            .clip(RoundedCornerShape(Radius.card))
            .background(Amll.colors.surface2),
    ) {
        AmllLyricView(
            rawLyric = rawLyric,
            lyricFormat = lyricFormat,
            lyricTranslation = lyricTranslation,
            positionMs = 0,
            playing = false,
            title = title,
            artist = artist,
            durationMs = 0,
            cover = cover,
            dark = false,
            onTogglePlay = {},
            onSeek = {},
            onClose = {},
            modifier = Modifier.fillMaxSize(),
        )
    }
}
