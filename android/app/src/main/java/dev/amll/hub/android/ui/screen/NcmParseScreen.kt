package dev.amll.hub.android.ui.screen

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.rounded.Download
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.NcmTrackDto
import dev.amll.hub.android.download.DownloadStore
import dev.amll.hub.android.download.hasLegacyWritePermission
import dev.amll.hub.android.download.hasNotificationPermission
import dev.amll.hub.android.download.needsLegacyWritePermission
import dev.amll.hub.android.playback.NcmQuality
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllLyricPreview
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PlayCircleButton
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.QualityPicker
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
 * 三种入口都是「拿到网易云 ID → 交给播放器解析」，搜索结果 / 歌单曲目
 * 直接在页面内就地播放，不再跳歌词页；音质在顶栏统一切换。
 */
@Composable
fun NcmParseScreen(
    nav: AppNav,
    vm: NcmParseViewModel = hiltViewModel(),
    playbackVm: PlaybackViewModel = hiltViewModel(),
) {
    val ui by vm.state.collectAsStateWithLifecycle()
    val playback by playbackVm.playerState.collectAsStateWithLifecycle()
    val download by vm.downloadState.collectAsStateWithLifecycle()
    val context = LocalContext.current

    var pendingDownload by remember { mutableStateOf<(() -> Unit)?>(null) }

    // API 28 及以下没写权限就保存不到下载目录，只有授予后才继续
    val storageLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        val action = pendingDownload
        pendingDownload = null
        if (granted) {
            action?.invoke()
        } else {
            vm.notifyError("需要存储权限才能保存到下载目录")
        }
    }
    // 通知权限拒绝不阻塞下载，但两个权限都缺时要接着请求写权限
    val notificationLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {
        val action = pendingDownload
        pendingDownload = null
        if (action != null) {
            if (needsLegacyWritePermission() && !hasLegacyWritePermission(context)) {
                pendingDownload = action
                storageLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            } else {
                action()
            }
        }
    }

    val runDownload: (() -> Unit) -> Unit = { action ->
        when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !hasNotificationPermission(context) -> {
                pendingDownload = action
                notificationLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
            needsLegacyWritePermission() && !hasLegacyWritePermission(context) -> {
                pendingDownload = action
                storageLauncher.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            }
            else -> action()
        }
    }

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
            AmllTopBar(
                "网易云解析",
                onBack = nav.back,
                trailing = { QualityPicker(ui.quality, vm::setQuality) },
            )
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
            0 -> SearchMode(ui, vm, playback.track?.songId)
            1 -> SongMode(ui, vm, runDownload)
            else -> PlaylistMode(ui, vm, download, playback.track?.songId, runDownload)
        }
    }
}

/* ------------------------------ 关键词搜索 ------------------------------ */

@Composable
private fun SearchMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    currentId: String?,
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
                NcmSongRow(
                    song = song,
                    current = song.displayId.isNotBlank() && song.displayId == currentId,
                    onClick = { vm.playSearch(song) },
                )
            }
        }
    }
}

@Composable
private fun NcmSongRow(song: NcmSongDto, current: Boolean, onClick: () -> Unit) {
    val subtitle = song.displayArtist +
        song.displayAlbum.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.field))
            .background(if (current) Amll.colors.primarySoft else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverImage(song.displayCover.ifBlank { null }, song.displayName, 44.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                song.displayName,
                style = Font.bodyMedium,
                color = if (current) Amll.colors.primary else Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (song.displayDuration > 0) {
            Text(formatDuration(song.displayDuration), style = Font.micro, color = Amll.colors.ink3)
        }
        PlayCircleButton(size = 26.dp)
    }
}

/* ------------------------------ 单曲解析 ------------------------------ */

@Composable
private fun SongMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    runDownload: (() -> Unit) -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
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

        ui.parsed?.let { parsed ->
            ParsedCard(
                parsed = parsed,
                quality = ui.quality,
                onPlay = vm::playParsed,
                onDownload = { runDownload(vm::downloadParsed) },
            )

            SectionHeader("歌词预览")
            when {
                ui.lyricLoading -> SkeletonList(3)
                parsed.source.text.isBlank() -> EmptyState(
                    icon = Icons.Rounded.MusicNote,
                    title = "暂无歌词",
                    description = "这首歌没有可用的歌词文本",
                )
                else -> AmllLyricPreview(
                    rawLyric = parsed.source.text,
                    lyricFormat = parsed.source.format,
                    lyricTranslation = parsed.source.translation,
                    title = parsed.music.displayName,
                    artist = parsed.music.displayArtist,
                    cover = parsed.music.displayCover.ifBlank { null },
                )
            }
        }
    }
}

@Composable
private fun ParsedCard(
    parsed: NcmParseViewModel.Parsed,
    quality: NcmQuality,
    onPlay: () -> Unit,
    onDownload: () -> Unit,
) {
    val music = parsed.music
    val actual = parsed.actual ?: quality
    AmllCard {
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
                Text(
                    music.albumName.ifBlank { "未知专辑" },
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Spacer(Modifier.height(10.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                actual.label,
                style = Font.micro.copy(fontWeight = FontWeight.Medium),
                color = Amll.colors.primary,
            )
            if (NcmQuality.isDowngraded(parsed.actual, quality)) {
                Text(
                    "已降级",
                    style = Font.micro.copy(fontWeight = FontWeight.Medium),
                    color = Amll.colors.warning,
                )
            }
            if (music.displayDuration > 0) {
                Text(
                    formatDuration(music.displayDuration),
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }
            if (music.size.isNotBlank()) {
                Text(music.size, style = Font.micro, color = Amll.colors.ink3)
            }
            Text(
                "ID ${parsed.songId}",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (music.displayUrl.isBlank()) {
            Spacer(Modifier.height(4.dp))
            Text(
                "无可用播放链接",
                style = Font.micro.copy(fontWeight = FontWeight.Medium),
                color = Amll.colors.warning,
            )
        }

        Spacer(Modifier.height(12.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PrimaryButton("播放", onClick = onPlay, modifier = Modifier.weight(1f))
            GhostButton("下载", onClick = onDownload, modifier = Modifier.weight(1f))
        }
    }
}

/* ------------------------------ 歌单解析 ------------------------------ */

@Composable
private fun PlaylistMode(
    ui: NcmParseViewModel.UiState,
    vm: NcmParseViewModel,
    download: DownloadStore.State,
    currentId: String?,
    runDownload: (() -> Unit) -> Unit,
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
        else -> LazyColumn(
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            item {
                PlaylistHeader(
                    name = detail.name,
                    coverUrl = detail.coverImgUrl.ifBlank { null },
                    trackCount = detail.tracks.size,
                    creator = detail.creator?.nickname.orEmpty(),
                    onPlayAll = vm::playPlaylistAll,
                    onDownloadAll = { runDownload(vm::downloadPlaylist) },
                )
            }
            if (download.running || download.message != null) {
                item { DownloadProgressCard(download) }
            }
            itemsIndexed(detail.tracks) { index, track ->
                NcmTrackRow(
                    track = track,
                    current = track.displayId.isNotBlank() && track.displayId == currentId,
                    onClick = { vm.playPlaylistTrack(index) },
                    onDownload = {
                        runDownload { vm.downloadPlaylistTrack(index) }
                    },
                )
            }
        }
    }
}

@Composable
private fun PlaylistHeader(
    name: String,
    coverUrl: String?,
    trackCount: Int,
    creator: String,
    onPlayAll: () -> Unit,
    onDownloadAll: () -> Unit,
) {
    AmllCard(modifier = Modifier.padding(bottom = 8.dp), padding = 14.dp) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            CoverImage(coverUrl, name, 64.dp, radius = Radius.field)
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    name.ifBlank { "未命名歌单" },
                    style = Font.cardTitle.copy(fontSize = 15.sp),
                    color = Amll.colors.ink,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    "共 $trackCount 首" + creator.takeIf { it.isNotBlank() }?.let { " · @$it" }.orEmpty(),
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }
        }

        Spacer(Modifier.height(12.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PrimaryButton("播放全部", onClick = onPlayAll, modifier = Modifier.weight(1f))
            GhostButton("下载全部", onClick = onDownloadAll, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun DownloadProgressCard(state: DownloadStore.State) {
    val finished = state.done + state.failed
    val total = state.total.coerceAtLeast(1)
    AmllCard(modifier = Modifier.padding(bottom = 8.dp), padding = 14.dp) {
        if (state.running) {
            if (state.currentName.isNotBlank()) {
                Text(
                    state.currentName,
                    style = Font.bodyMedium,
                    color = Amll.colors.ink,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
            }
            Text(
                "$finished/${state.total}" +
                    if (state.failed > 0) " · 失败 ${state.failed}" else "",
                style = Font.micro,
                color = Amll.colors.ink3,
            )
            Spacer(Modifier.height(8.dp))
            LinearProgressIndicator(
                progress = { finished.toFloat() / total },
                modifier = Modifier.fillMaxWidth().height(6.dp),
                color = Amll.colors.primary,
                trackColor = Amll.colors.surface2,
            )
        }
        state.message?.let {
            if (state.running) Spacer(Modifier.height(8.dp))
            Text(it, style = Font.micro, color = Amll.colors.ink2)
        }
    }
}

@Composable
private fun NcmTrackRow(
    track: NcmTrackDto,
    current: Boolean,
    onClick: () -> Unit,
    onDownload: () -> Unit,
) {
    val subtitle = track.displayArtist +
        track.al?.name?.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty()
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.field))
            .background(if (current) Amll.colors.primarySoft else Color.Transparent)
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverImage(track.displayCover.ifBlank { null }, track.name, 40.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                track.name.ifBlank { "未知歌曲" },
                style = Font.bodyMedium,
                color = if (current) Amll.colors.primary else Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                subtitle,
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        if (track.dt > 0) {
            Text(formatDuration(track.dt), style = Font.micro, color = Amll.colors.ink3)
        }
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            PlayCircleButton(size = 26.dp)
            IconButton(onClick = onDownload, modifier = Modifier.size(28.dp)) {
                Icon(
                    Icons.Rounded.Download,
                    "下载",
                    tint = Amll.colors.ink3,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
    }
}

/** 毫秒 → m:ss */
private fun formatDuration(ms: Long): String {
    val duration = Duration.ofMillis(ms.coerceAtLeast(0))
    return String.format(Locale.US, "%d:%02d", duration.toMinutes(), duration.seconds % 60)
}
