package dev.amll.hub.android.ui.screen

import android.os.Build
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QrCodeScanner
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
import androidx.compose.ui.draw.blur
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.data.remote.Urls
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.TabScaffold
import dev.amll.hub.android.ui.bottomBarPadding
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.ChipTone
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.NavRow
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.SongRow
import dev.amll.hub.android.ui.component.TabItem
import dev.amll.hub.android.ui.component.coverBrush
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.CardShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius
import java.time.LocalDate
import java.time.format.DateTimeFormatter

/* ============================ 03 排行榜 ============================ */

@Composable
fun RankingScreen(vm: RankingViewModel, nav: AppNav) {
    val days by vm.rankingDays.collectAsStateWithLifecycle()
    val ui by vm.ranking.collectAsStateWithLifecycle()
    LaunchedEffect(days) { vm.loadRanking(days) }

    Column(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(
            Modifier
                .fillMaxSize()
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 14.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AmllTopBar("无歌词排行榜", onBack = nav.back) {
                Text("每周一清空", style = Font.caption, color = Amll.colors.ink3)
            }

            Row(
                Modifier
                    .fillMaxWidth()
                    .height(36.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Amll.colors.surface2)
                    .padding(3.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf(1, 3, 7).forEach { d ->
                    val active = d == days
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .clip(RoundedCornerShape(9.dp))
                            .background(if (active) Amll.colors.surface else Color.Transparent)
                            .clickable { vm.loadRanking(d) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            "$d 天",
                            style = Font.caption.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium),
                            color = if (active) Amll.colors.ink else Amll.colors.ink3,
                        )
                    }
                }
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("按请求次数", style = Font.micro.copy(fontWeight = FontWeight.Bold), color = Amll.colors.ink3)
                Text("最近 $days 天", style = Font.micro, color = Amll.colors.ink3)
            }

            when {
                ui.loading -> SkeletonList(5)
                ui.items.isEmpty() -> EmptyState(
                    icon = Icons.Outlined.Inbox,
                    title = "暂无榜单数据",
                    description = "换个时间范围试试",
                    actionText = "重新加载",
                    onAction = { vm.loadRanking(days) },
                )
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    item { ChampionCard(ui.items.first(), nav) }
                    itemsIndexed(ui.items.drop(1)) { index, item ->
                        RankingRow(rank = index + 2, item = item, nav = nav)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChampionCard(item: RankingItemDto, nav: AppNav) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(92.dp)
            .clip(CardShape)
            .background(Brush.linearGradient(listOf(Color(0xFFE0303F), Color(0xFF59162E))))
            .clickable { nav.openLyric(item.platformId, item.songName, item.artists.joinToString("/"), item.cover) }
            .padding(horizontal = 18.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text("请求最多", style = Font.micro, color = Color.White)
            Text(item.songName, style = Font.navTitle.copy(fontSize = 19.sp), color = Color.White, maxLines = 1)
            Text(
                "${item.artists.joinToString(" / ")} · ${item.requestCount} 次请求",
                style = Font.micro,
                color = Color.White.copy(alpha = 0.8f),
            )
        }
        Box(
            Modifier.size(40.dp).clip(CircleShape).background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.PlayArrow, "播放", tint = Amll.colors.primary, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun RankingRow(rank: Int, item: RankingItemDto, nav: AppNav) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(58.dp)
            .clickable { nav.openLyric(item.platformId, item.songName, item.artists.joinToString("/"), item.cover) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            rank.toString().padStart(2, '0'),
            style = Font.caption.copy(fontWeight = FontWeight.Bold),
            color = Amll.colors.ink3,
            modifier = Modifier.width(20.dp),
        )
        CoverImage(item.cover.ifBlank { null }, item.songName, 40.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(item.songName, style = Font.bodyMedium, color = Amll.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(
                "${item.artists.joinToString(" / ")} · ${item.platform} ${item.platformId}",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text("${item.requestCount} 次", style = Font.caption.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink2)
        Box(
            Modifier.size(20.dp).clip(CircleShape).border(1.dp, Amll.colors.border, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.PlayArrow, "播放", tint = Amll.colors.ink3, modifier = Modifier.size(12.dp))
        }
    }
}
