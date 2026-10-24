package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.NcmTrackDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.PlayCircleButton
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.component.SegmentedTabs
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import java.time.Duration
import java.util.Locale

private val MODES = listOf("关键词搜索", "单曲 ID", "歌单 ID")

/**
 * 网易云解析：对应网页端的 /ncm 页面。
 *
 * 三种入口都是「拿到网易云 ID → 交给播放器解析」，所以最终都走
 * nav.openLyric，由 LyricViewModel 统一补齐封面 / 歌手 / 音频。
 */
@Composable
fun NcmParseScreen(
    nav: AppNav,
    vm: NcmParseViewModel = hiltViewModel(),
) {
    val ui by vm.state.collectAsStateWithLifecycle()

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Column(
            Modifier
                .fillMaxWidth()
                .padding(start = 20.dp, end = 20.dp, top = 6.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            AmllTopBar("网易云解析", onBack = nav.back)
            SegmentedTabs(MODES, ui.mode, vm::setMode)
        }

        ui.error?.let {
            Text(
                it,
                style = Font.micro,
                color = Amll.colors.warning,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }

        when (ui.mode) {
            0 -> SearchMode(ui, vm, nav)
            1 -> SongMode(ui, vm, nav)
            else -> PlaylistMode(ui, vm, nav)
        }
    }
}

/* ------------------------------ 关键词搜索 ------------------------------ */

@Composable
private fun SearchMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    nav: AppNav,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
        AmllTextField(
            value = ui.query,
            onValueChange = vm::setQuery,
            placeholder = "歌名 / 歌手，回车搜索",
            imeAction = ImeAction.Search,
            onImeAction = vm::search,
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            text = if (ui.searching) "搜索中…" else "搜索",
            onClick = vm::search,
            enabled = ui.query.isNotBlank() && !ui.searching,
        )
    }

    when {
        ui.searching -> Column(Modifier.padding(horizontal = 20.dp)) { SkeletonList(5) }
        ui.results.isEmpty() -> EmptyState(
            icon = Icons.Outlined.Inbox,
            title = "搜网易云曲库",
            description = "搜到结果点一下就能直接播",
        )
        else -> LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            item { SectionHeader("共 ${ui.results.size} 首") }
            items(ui.results) { song ->
                NcmSongRow(song) {
                    val id = song.displayId
                    if (id.isNotBlank()) {
                        nav.openLyric(id, song.displayName, song.displayArtist, song.displayCover)
                    }
                }
            }
        }
    }
}

@Composable
private fun NcmSongRow(song: NcmSongDto, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverImage(song.displayCover.ifBlank { null }, song.displayName, 44.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                song.displayName,
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                song.displayArtist,
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        PlayCircleButton(size = 26.dp)
    }
}

/* ------------------------------ 单曲解析 ------------------------------ */

@Composable
private fun SongMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    nav: AppNav,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        AmllTextField(
            value = ui.songInput,
            onValueChange = vm::setSongInput,
            placeholder = "歌曲 ID 或 music.163.com 链接",
            label = "支持纯数字 ID、带 id 参数的链接、整段分享文案",
            keyboardType = KeyboardType.Text,
            imeAction = ImeAction.Done,
            onImeAction = vm::parseSong,
        )
        PrimaryButton(
            text = if (ui.parsing) "解析中…" else "解析",
            onClick = vm::parseSong,
            enabled = ui.songInput.isNotBlank() && !ui.parsing,
        )

        if (ui.parsing) SkeletonList(2)

        ui.parsed?.let { music ->
            ParsedCard(music) {
                nav.openLyric(
                    extractSongId(ui.songInput),
                    music.displayName,
                    music.displayArtist,
                    music.displayCover.ifBlank { null },
                )
            }
        }
    }
}

@Composable
private fun ParsedCard(music: NcmMusicDto, onPlay: () -> Unit) {
    AmllCard(modifier = Modifier.clickable(onClick = onPlay)) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CoverImage(
                music.displayCover.ifBlank { null },
                music.displayName,
                64.dp,
                radius = Radius.field,
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    music.displayName.ifBlank { "未知歌曲" },
                    style = Font.cardTitle.copy(fontSize = 15.sp),
                    color = Amll.colors.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    music.displayArtist.ifBlank { "未知歌手" },
                    style = Font.caption,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (music.level.isNotBlank()) {
                        Text(
                            music.level,
                            style = Font.micro.copy(fontWeight = FontWeight.Medium),
                            color = Amll.colors.primary,
                        )
                    }
                    val duration = music.displayDuration
                    if (duration > 0) {
                        Text(
                            formatDuration(duration),
                            style = Font.micro,
                            color = Amll.colors.ink3,
                        )
                    }
                    Text(
                        if (music.displayUrl.isBlank()) "无音源" else "可播放",
                        style = Font.micro,
                        color = if (music.displayUrl.isBlank()) Amll.colors.warning else Amll.colors.success,
                    )
                }
            }
            PlayCircleButton(size = 26.dp)
        }
    }
}

/* ------------------------------ 歌单解析 ------------------------------ */

@Composable
private fun PlaylistMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    nav: AppNav,
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp)) {
        AmllTextField(
            value = ui.playlistInput,
            onValueChange = vm::setPlaylistInput,
            placeholder = "歌单 ID，例如 2884035",
            imeAction = ImeAction.Done,
            onImeAction = vm::parsePlaylist,
        )
        Spacer(Modifier.height(10.dp))
        PrimaryButton(
            text = if (ui.playlistLoading) "解析中…" else "解析歌单",
            onClick = vm::parsePlaylist,
            enabled = ui.playlistInput.isNotBlank() && !ui.playlistLoading,
        )
    }

    val detail = ui.playlist
    when {
        ui.playlistLoading -> Column(Modifier.padding(horizontal = 20.dp)) { SkeletonList(4) }
        detail == null -> EmptyState(
            icon = Icons.Outlined.Inbox,
            title = "解析网易云歌单",
            description = "填歌单 ID，解析出来的曲目点一下就能播",
        )
        else -> {
            LazyColumn(
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(bottom = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CoverImage(
                            detail.coverImgUrl.ifBlank { null },
                            detail.name,
                            64.dp,
                            radius = Radius.field,
                        )
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                detail.name.ifBlank { "未命名歌单" },
                                style = Font.cardTitle.copy(fontSize = 15.sp),
                                color = Amll.colors.ink,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            Text(
                                "共 ${detail.tracks.size} 首" +
                                    detail.creator?.nickname?.takeIf { it.isNotBlank() }
                                        ?.let { " · @$it" }.orEmpty(),
                                style = Font.micro,
                                color = Amll.colors.ink3,
                            )
                        }
                    }
                }
                items(detail.tracks) { track ->
                    NcmTrackRow(track) {
                        val id = track.displayId
                        if (id.isNotBlank()) {
                            nav.openLyric(id, track.name, track.displayArtist, track.displayCover)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NcmTrackRow(track: NcmTrackDto, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverImage(track.displayCover.ifBlank { null }, track.name, 40.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                track.name.ifBlank { "未知歌曲" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                track.displayArtist,
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (track.dt > 0) {
            Text(formatDuration(track.dt), style = Font.micro, color = Amll.colors.ink3)
        }
    }
}

/** 毫秒 → m:ss */
private fun formatDuration(ms: Long): String {
    val duration = Duration.ofMillis(ms.coerceAtLeast(0))
    return String.format(Locale.US, "%d:%02d", duration.toMinutes(), duration.seconds % 60)
}
