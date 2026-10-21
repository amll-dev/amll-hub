package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import kotlinx.coroutines.delay

/**
 * 搜索面板：网页端 Header 的搜索框在手机上收成半屏弹层。
 * 两个来源对应网页端的「歌词搜索」与「音乐解析」。
 */
@Composable
fun SearchSheet(
    vm: AppViewModel,
    initialMode: Int = 0,
    onDismiss: () -> Unit,
    onPickHit: (SearchHitDto) -> Unit,
    onPickNcm: (NcmSongDto) -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var mode by remember { mutableIntStateOf(initialMode) }
    val state by vm.search.collectAsStateWithLifecycle()
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { focus.requestFocus() }
    LaunchedEffect(query, mode) {
        if (query.isBlank()) return@LaunchedEffect
        delay(320)
        vm.runSearch(query, mode)
    }

    Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Box(Modifier.fillMaxSize()) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Color.Black.copy(alpha = 0.35f))
                    .clickable(onClick = onDismiss),
            )
            Column(
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height(560.dp)
                    .clip(RoundedCornerShape(topStart = Radius.sheet, topEnd = Radius.sheet))
                    .background(Amll.colors.canvas)
                    .imePadding()
                    .padding(horizontal = 20.dp, vertical = 16.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("搜索", style = Font.sheetTitle, color = Amll.colors.ink, modifier = Modifier.weight(1f))
                    Text(
                        "关闭",
                        style = Font.caption,
                        color = Amll.colors.ink3,
                        modifier = Modifier.clickable(onClick = onDismiss),
                    )
                }

                Spacer(Modifier.height(12.dp))

                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(Amll.colors.surface2)
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Rounded.Search,
                        null,
                        tint = Amll.colors.ink3,
                        modifier = Modifier.size(17.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Box(Modifier.weight(1f)) {
                        if (query.isBlank()) {
                            Text(
                                if (mode == 1) "搜网易云歌曲，回车解析" else "搜歌名、歌手、歌词片段",
                                style = Font.bodySmall,
                                color = Amll.colors.ink3,
                            )
                        }
                        BasicTextField(
                            value = query,
                            onValueChange = { query = it },
                            singleLine = true,
                            textStyle = TextStyle(fontSize = 13.5.sp, color = Amll.colors.ink),
                            cursorBrush = SolidColor(Amll.colors.primary),
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                            keyboardActions = KeyboardActions(onSearch = { vm.runSearch(query, mode) }),
                            modifier = Modifier.fillMaxWidth().focusRequester(focus),
                        )
                    }
                }

                Spacer(Modifier.height(10.dp))

                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("词库", "网易云").forEachIndexed { index, label ->
                        val active = index == mode
                        Box(
                            Modifier
                                .clip(RoundedCornerShape(Radius.chip))
                                .background(if (active) Amll.colors.primarySoft else Amll.colors.surface2)
                                .clickable { mode = index }
                                .padding(horizontal = 12.dp, vertical = 6.dp),
                        ) {
                            Text(
                                label,
                                style = Font.micro,
                                color = if (active) Amll.colors.primary else Amll.colors.ink3,
                            )
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))

                when {
                    state.loading -> Column(
                        Modifier.fillMaxWidth(),
                        verticalArrangement = Arrangement.spacedBy(4.dp),
                    ) {
                        repeat(4) { SkeletonRow() }
                    }

                    state.error != null -> EmptyState(
                        icon = Icons.Outlined.Inbox,
                        title = state.error.orEmpty(),
                        description = if (mode == 1) "换个关键词试试" else "试试歌名或歌手",
                    )

                    mode == 1 -> LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        itemsIndexed(state.ncm) { _, song ->
                            NcmRow(song) { onPickNcm(song) }
                        }
                    }

                    else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        itemsIndexed(state.hits) { _, hit ->
                            HitRow(hit) { onPickHit(hit) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NcmRow(song: NcmSongDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CoverImage(song.displayCover.ifBlank { null }, song.displayName, 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                song.displayName.ifBlank { "未知歌曲" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(song.displayArtist, style = Font.micro, color = Amll.colors.ink3, maxLines = 1)
        }
        Text("解析", style = Font.micro, color = Amll.colors.primary)
    }
}

@Composable
private fun HitRow(hit: SearchHitDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CoverImage(null, hit.musicNames.firstOrNull() ?: hit.id, 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                hit.musicNames.firstOrNull() ?: hit.id,
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                hit.artists.joinToString(" / ") + " · ${hit.lineCount} 行",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
