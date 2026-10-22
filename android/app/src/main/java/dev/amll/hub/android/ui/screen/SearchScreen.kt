package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import kotlinx.coroutines.delay

/** 搜索范围，取值与后端 /search?field= 一致 */
private val SEARCH_FIELDS = listOf(
    "all" to "全部",
    "song" to "歌曲",
    "artist" to "歌手",
    "album" to "专辑",
    "lyric" to "歌词",
    "id" to "音乐 ID",
)

/**
 * 全屏搜索页：对齐网页端的「歌词库搜索」，命中后直接进歌词页。
 */
@Composable
fun SearchScreen(vm: AppViewModel, nav: AppNav) {
    val state by vm.search.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf(state.query) }
    var hint by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }

    LaunchedEffect(Unit) { focus.requestFocus() }
    // 输入停顿 320ms 后再请求，避免每个字符都打一次接口
    LaunchedEffect(query) {
        if (query.isBlank()) return@LaunchedEffect
        delay(320)
        vm.runSearch(query)
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .imePadding(),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .height(58.dp)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                Icons.Rounded.ChevronLeft,
                "返回",
                tint = Amll.colors.ink,
                modifier = Modifier.size(22.dp).clickable(onClick = nav.back),
            )
            Row(
                Modifier
                    .weight(1f)
                    .height(42.dp)
                    .clip(RoundedCornerShape(Radius.chip))
                    .background(Amll.colors.surface2)
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Search, null, tint = Amll.colors.ink3, modifier = Modifier.size(16.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f)) {
                    if (query.isEmpty()) {
                        Text("搜歌名、歌手、歌词片段", style = Font.bodySmall, color = Amll.colors.ink3)
                    }
                    BasicTextField(
                        value = query,
                        onValueChange = {
                            query = it
                            hint = null
                        },
                        singleLine = true,
                        textStyle = TextStyle(fontSize = 13.5.sp, color = Amll.colors.ink),
                        cursorBrush = SolidColor(Amll.colors.primary),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions = KeyboardActions(onSearch = { vm.runSearch(query) }),
                        modifier = Modifier.fillMaxWidth().focusRequester(focus),
                    )
                }
                if (query.isNotEmpty()) {
                    Icon(
                        Icons.Rounded.Close,
                        "清空",
                        tint = Amll.colors.ink3,
                        modifier = Modifier.size(16.dp).clickable {
                            query = ""
                            hint = null
                            vm.runSearch("")
                        },
                    )
                }
            }
            Text(
                "取消",
                style = Font.caption,
                color = Amll.colors.ink2,
                modifier = Modifier.clickable(onClick = nav.back),
            )
        }

        Row(
            Modifier
                .fillMaxWidth()
                .horizontalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            SEARCH_FIELDS.forEach { (value, label) ->
                val active = state.field == value
                Box(
                    Modifier
                        .height(28.dp)
                        .clip(RoundedCornerShape(Radius.chip))
                        .background(if (active) Amll.colors.primarySoft else Amll.colors.surface2)
                        .clickable(enabled = !active) {
                            vm.runSearch(query, value)
                        }
                        .padding(horizontal = 12.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        label,
                        style = Font.micro,
                        color = if (active) Amll.colors.primary else Amll.colors.ink3,
                    )
                }
            }
        }

        hint?.let {
            Text(
                it,
                style = Font.micro,
                color = Amll.colors.warning,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
            )
        }

        val hits = state.hits
        when {
            state.loading -> Column(
                Modifier.fillMaxSize().padding(horizontal = 20.dp, vertical = 8.dp),
            ) {
                SkeletonList(5)
            }

            hits.isNotEmpty() -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                item {
                    Text(
                        "找到 ${hits.size} 条歌词",
                        style = Font.micro,
                        color = Amll.colors.ink3,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                }
                items(hits) { hit ->
                    SearchHitRow(hit) {
                        val ncmId = hit.platformIds["ncm"]?.firstOrNull()
                        if (ncmId.isNullOrBlank()) {
                            hint = "这条歌词没有关联网易云 ID，暂时无法播放"
                        } else {
                            nav.openLyric(
                                ncmId,
                                hit.musicNames.firstOrNull().orEmpty(),
                                hit.artists.joinToString("/"),
                                null,
                            )
                        }
                    }
                }
            }

            state.error != null -> EmptyState(
                icon = Icons.Outlined.Inbox,
                title = state.error.orEmpty(),
                description = "换个关键词试试，比如歌名或歌手",
            )

            else -> EmptyState(
                icon = Icons.Rounded.Search,
                title = "搜索站内歌词库",
                description = "支持歌名、歌手与歌词片段",
            )
        }

    }
}

@Composable
private fun SearchHitRow(hit: SearchHitDto, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        CoverImage(null, hit.musicNames.firstOrNull() ?: hit.id, 44.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                hit.musicNames.firstOrNull() ?: hit.id,
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                hit.artists.joinToString(" / ").ifBlank { "未知歌手" } +
                    " · ${hit.lineCount} 行 · ${hit.wordCount} 字",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (hit.lyricSnippet.isNotBlank()) {
                Text(
                    hit.lyricSnippet,
                    style = Font.caption,
                    color = Amll.colors.ink3.copy(alpha = 0.8f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}
