package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.TabScaffold
import dev.amll.hub.android.ui.bottomBarPadding
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.component.SongRow
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.CardShape
import dev.amll.hub.android.ui.theme.Font

/* ============================ 02 发现 ============================ */

@Composable
fun DiscoverScreen(vm: HomeViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.home.value.latest.isEmpty()) vm.loadHome() }
    val ui by vm.home.collectAsStateWithLifecycle()

    TabScaffold {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 20.dp,
                end = 20.dp,
                top = 10.dp,
                bottom = bottomBarPadding(),
            ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item { PageHeader("发现", "歌词、榜单与每日推荐") }
            item { SearchField("搜索站内歌词库", onClick = nav.openSearch) }

            item {
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    DiscoverCard(
                        title = "歌词搜索",
                        desc = "按歌名、歌手、歌词片段检索词库",
                        modifier = Modifier.weight(1f),
                        onClick = nav.openSearch,
                    )
                    DiscoverCard(
                        title = "每日推荐",
                        desc = "看看今天大家都在听什么",
                        modifier = Modifier.weight(1f),
                        onClick = nav.openDaily,
                    )
                }
            }

            item {
                DiscoverCard(
                    title = "网易云解析",
                    desc = "粘贴歌曲 ID / 链接，或按关键词搜到就能直接播",
                    modifier = Modifier.fillMaxWidth(),
                    onClick = nav.openNcm,
                )
            }

            item { SectionHeader("无歌词排行榜", action = "查看榜单", onAction = nav.openRanking) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    ui.ranking.take(2).forEachIndexed { index, item ->
                        RankingCompactRow(rank = index + 1, item = item, onClick = nav.openRanking)
                    }
                    if (ui.ranking.isEmpty()) {
                        Text("暂无榜单数据", style = Font.caption, color = Amll.colors.ink3)
                    }
                }
            }

            item { SectionHeader("最新收录", action = "查看全部", onAction = nav.openLatest) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    ui.latest.take(6).forEach { song ->
                        SongRow(
                            title = song.title,
                            subtitle = song.artist,
                            coverUrl = song.coverUrl.ifBlank { null },
                            coverSize = 40.dp,
                            onClick = {
                                nav.openLyric(song.ncmId, song.title, song.artist, song.coverUrl)
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun DiscoverCard(
    title: String,
    desc: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Column(
        modifier
            .height(96.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .clip(CardShape)
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, CardShape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = Font.cardTitle.copy(fontSize = 14.sp), color = Amll.colors.ink)
        Text(desc, style = Font.micro, color = Amll.colors.ink3, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun RankingCompactRow(rank: Int, item: RankingItemDto, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            "$rank",
            style = Font.bodyMedium.copy(fontWeight = FontWeight.Bold),
            color = if (rank == 1) Amll.colors.primary else Amll.colors.ink,
            modifier = Modifier.width(16.dp),
        )
        Text(
            item.songName.ifBlank { "未知歌曲" },
            style = Font.body,
            color = Amll.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text("${item.requestCount} 次", style = Font.micro, color = Amll.colors.ink3)
    }
}
