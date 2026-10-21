package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
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
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.PlayArrow
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.RankingItemDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.ChipTone
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.SearchSheet
import dev.amll.hub.android.ui.component.PillTabBar
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.SongRow
import dev.amll.hub.android.ui.component.StatusChip
import dev.amll.hub.android.ui.component.TabItem
import dev.amll.hub.android.ui.component.coverBrush
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.CardShape
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius
import dev.amll.hub.android.ui.theme.Space
import java.time.LocalDate
import java.time.format.DateTimeFormatter

val AppTabs = listOf(
    TabItem("首页", Icons.Outlined.Home),
    TabItem("发现", Icons.Outlined.Explore),
    TabItem("创作", Icons.Outlined.AddCircleOutline),
    TabItem("消息", Icons.Outlined.ChatBubbleOutline),
    TabItem("我的", Icons.Outlined.PersonOutline),
)

@Composable
fun TabScaffold(
    selected: Int,
    nav: AppNav,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(Modifier.weight(1f).fillMaxWidth(), content = content)
        PillTabBar(AppTabs, selected) { nav.switchTab(it) }
    }
}

@Composable
fun SearchField(
    placeholder: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .height(46.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(Amll.colors.surface2)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Rounded.Search, null, tint = Amll.colors.ink3, modifier = Modifier.size(18.dp))
        Text(placeholder, style = Font.bodySmall, color = Amll.colors.ink3)
    }
}

/* ============================ 01 首页 ============================ */

@Composable
fun HomeScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { vm.loadHome() }
    val ui by vm.home.collectAsStateWithLifecycle()
    var showSearch by remember { mutableStateOf(false) }

    TabScaffold(selected = 0, nav = nav) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("AMLL Hub", style = Font.pageTitle, color = Amll.colors.ink, modifier = Modifier.weight(1f))
                Icon(Icons.Rounded.Search, "搜索", tint = Amll.colors.ink, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(12.dp))
                Box(
                    Modifier
                        .size(32.dp)
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Color(0xFF5C8CEF), Color(0xFF9E6BF0)))),
                )
            }

            SearchField("搜歌名、歌手，或粘贴歌词片段", onClick = { showSearch = true })

            TodayHero(ui.today, onClick = {
                val rec = ui.today
                if (rec != null) nav.openLyric(rec.ncmId, rec.songName, rec.artist, null) else nav.openDaily()
            })

            SectionHeader("最新收录", action = "查看全部", onAction = { nav.switchTab(1) })

            when {
                ui.loading -> SkeletonList(3)
                ui.latest.isEmpty() -> Text("暂无最新收录", style = Font.bodySmall, color = Amll.colors.ink3)
                else -> ui.latest.forEach { item ->
                    SongRow(
                        title = item.title,
                        subtitle = item.artist,
                        coverUrl = item.coverUrl.ifBlank { null },
                        onClick = { nav.openLyric(item.ncmId, item.title, item.artist, item.coverUrl) },
                    )
                }
            }

            RankingTeaser(ui.ranking.firstOrNull(), onClick = nav.openRanking)
        }
    }

    if (showSearch) {
        SearchSheet(
            vm = vm,
            onDismiss = { showSearch = false },
            onPickHit = { hit ->
                showSearch = false
                hit.platformIds["netease"]?.firstOrNull()?.let { id ->
                    nav.openLyric(
                        id,
                        hit.musicNames.firstOrNull().orEmpty(),
                        hit.artists.joinToString("/"),
                        null,
                    )
                }
            },
            onPickNcm = { song ->
                showSearch = false
                nav.openLyric(
                    song.displayId,
                    song.displayName,
                    song.displayArtist,
                    song.displayCover.ifBlank { null },
                )
            },
        )
    }
}

@Composable
private fun TodayHero(today: DailyRecDto?, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(178.dp)
            .clip(HeroShape)
            .clickable(onClick = onClick),
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.linearGradient(
                        listOf(Color(0xFFF26D5B), Color(0xFFC9354E), Color(0xFF3B2154)),
                    ),
                ),
        )
        Column(Modifier.fillMaxSize().padding(18.dp)) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(Color.White.copy(alpha = 0.2f))
                    .padding(horizontal = 10.dp, vertical = 5.dp),
            ) {
                Text("今日推荐", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Color.White)
            }
            Spacer(Modifier.height(10.dp))
            Text(
                today?.songName ?: "今日暂无推荐",
                style = Font.navTitle.copy(fontSize = 21.sp),
                color = Color.White,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(6.dp))
            Text(
                today?.let { "${it.artist} · 来自 @${it.submitter}" } ?: "成为今天第一个投稿的人",
                style = Font.caption,
                color = Color.White.copy(alpha = 0.82f),
                maxLines = 1,
            )
        }
        Box(
            Modifier
                .align(Alignment.BottomEnd)
                .padding(16.dp)
                .size(52.dp)
                .clip(CircleShape)
                .background(Color.White),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.PlayArrow, "播放", tint = Amll.colors.primary, modifier = Modifier.size(26.dp))
        }
    }
}

@Composable
private fun RankingTeaser(first: RankingItemDto?, onClick: () -> Unit) {
    AmllCard(modifier = Modifier.clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("无歌词排行榜", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(4.dp))
                Text(
                    first?.let { "${it.songName} 等 ${it.requestCount} 次请求" } ?: "最近 7 天，按请求次数排序",
                    style = Font.caption,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                Modifier
                    .clip(ChipShape)
                    .background(Amll.colors.primarySoft)
                    .padding(horizontal = 12.dp, vertical = 6.dp),
            ) {
                Text("查看", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.primary)
            }
        }
    }
}

/* ============================ 02 发现 ============================ */

@Composable
fun DiscoverScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.home.value.latest.isEmpty()) vm.loadHome() }
    val ui by vm.home.collectAsStateWithLifecycle()
    var showSearch by remember { mutableStateOf(false) }
    var searchMode by remember { mutableIntStateOf(0) }

    TabScaffold(selected = 1, nav = nav) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(18.dp),
        ) {
            PageHeader("发现", "歌词、榜单与每日推荐")
            SearchField("跨平台搜索歌词、歌手", onClick = { searchMode = 0; showSearch = true })

            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                DiscoverCard(
                    title = "音乐解析",
                    desc = "搜歌或歌单 ID 批量解析（需登录）",
                    gradient = listOf(Color(0xFFE0303F), Color(0xFF8C2148)),
                    modifier = Modifier.weight(1f),
                    onClick = { searchMode = 1; showSearch = true },
                )
                DiscoverCard(
                    title = "歌词搜索",
                    desc = "跨平台搜索，直接看逐字效果",
                    gradient = listOf(Color(0xFF3D5CDF), Color(0xFF7040C7)),
                    modifier = Modifier.weight(1f),
                    onClick = { searchMode = 0; showSearch = true },
                )
            }

            SectionHeader("无歌词排行榜", action = "查看榜单", onAction = nav.openRanking)
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                ui.ranking.take(2).forEachIndexed { index, item ->
                    RankingCompactRow(rank = index + 1, item = item, onClick = nav.openRanking)
                }
                if (ui.ranking.isEmpty()) {
                    Text("暂无榜单数据", style = Font.caption, color = Amll.colors.ink3)
                }
            }

            SectionHeader("最新收录", action = "全部动态", onAction = { nav.switchTab(0) })
            ui.latest.forEach { item ->
                SongRow(
                    title = item.title,
                    subtitle = item.artist,
                    coverUrl = item.coverUrl.ifBlank { null },
                    coverSize = 40.dp,
                    onClick = { nav.openLyric(item.ncmId, item.title, item.artist, item.coverUrl) },
                )
            }
        }
    }

    if (showSearch) {
        SearchSheet(
            vm = vm,
            initialMode = searchMode,
            onDismiss = { showSearch = false },
            onPickHit = { hit ->
                showSearch = false
                hit.platformIds["netease"]?.firstOrNull()?.let { id ->
                    nav.openLyric(
                        id,
                        hit.musicNames.firstOrNull().orEmpty(),
                        hit.artists.joinToString("/"),
                        null,
                    )
                }
            },
            onPickNcm = { song ->
                showSearch = false
                nav.openLyric(
                    song.displayId,
                    song.displayName,
                    song.displayArtist,
                    song.displayCover.ifBlank { null },
                )
            },
        )
    }
}

@Composable
private fun DiscoverCard(
    title: String,
    desc: String,
    gradient: List<Color>,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Column(
        modifier
            .height(126.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .clip(CardShape)
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, CardShape)
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            Modifier
                .size(32.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Brush.linearGradient(gradient)),
        )
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

/* ============================ 03 排行榜 ============================ */

@Composable
fun RankingScreen(vm: AppViewModel, nav: AppNav) {
    val days by vm.rankingDays.collectAsStateWithLifecycle()
    val ui by vm.ranking.collectAsStateWithLifecycle()
    LaunchedEffect(days) { vm.loadRanking(days) }

    Column(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 24.dp),
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

/* ============================ 04 每日推荐 ============================ */

@Composable
fun DailyScreen(vm: AppViewModel, nav: AppNav) {
    val ui by vm.daily.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { if (vm.daily.value.items.isEmpty()) vm.loadDaily() }

    val dates = remember(ui.items) {
        val fmt = DateTimeFormatter.ofPattern("MM-dd")
        ui.items.map { it.date }.distinct().sortedDescending().take(6).reversed()
    }
    var selected by remember(dates) { mutableStateOf(dates.lastOrNull() ?: LocalDate.now().toString()) }
    val likedIds by vm.likedDaily.collectAsStateWithLifecycle()
    val current = ui.items.firstOrNull { it.date == selected } ?: ui.items.firstOrNull()

    Column(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 18.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            AmllTopBar("每日推荐", onBack = nav.back) {
                Icon(Icons.Rounded.Search, null, tint = Amll.colors.ink3, modifier = Modifier.size(18.dp))
            }

            if (dates.isNotEmpty()) {
                Row(Modifier.fillMaxWidth().height(62.dp), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    dates.forEach { date ->
                        val active = date == selected
                        val d = runCatching { LocalDate.parse(date) }.getOrNull()
                        Column(
                            Modifier
                                .weight(1f)
                                .fillMaxSize()
                                .clip(RoundedCornerShape(16.dp))
                                .background(if (active) Amll.colors.primary else Amll.colors.surface2)
                                .clickable { selected = date },
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Text(
                                weekdayLabel(d),
                                style = Font.micro,
                                color = if (active) Color.White else Amll.colors.ink3,
                            )
                            Spacer(Modifier.height(4.dp))
                            Text(
                                d?.dayOfMonth?.toString() ?: "--",
                                style = Font.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                                color = if (active) Color.White else Amll.colors.ink,
                            )
                        }
                    }
                }
            }

            when {
                ui.loading -> SkeletonList(3)
                current == null -> EmptyState(
                    icon = Icons.Outlined.Inbox,
                    title = "今天暂无推荐",
                    description = "成为今天第一个投稿的人",
                )
                else -> {
                    val liked = current.id in likedIds
                    DailyCard(
                        rec = current,
                        liked = liked,
                        onLike = { vm.toggleDailyLike(current) },
                    ) {
                        nav.openLyric(current.ncmId, current.songName, current.artist, null)
                    }
                }
            }
        }
    }
}

private fun weekdayLabel(date: LocalDate?): String {
    if (date == null) return "--"
    return when (date.dayOfWeek.value) {
        1 -> "一"; 2 -> "二"; 3 -> "三"; 4 -> "四"; 5 -> "五"; 6 -> "六"; else -> "日"
    }
}

@Composable
private fun DailyCard(
    rec: DailyRecDto,
    liked: Boolean,
    onLike: () -> Unit,
    onPlay: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.sheet))
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.sheet))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(250.dp)
                .clip(RoundedCornerShape(16.dp))
                .background(coverBrush(rec.songName)),
        ) {
            Text(
                "TODAY\nRECOMMEND",
                style = Font.navTitle.copy(fontSize = 22.sp),
                color = Color.White,
                modifier = Modifier.padding(18.dp),
            )
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(rec.songName, style = Font.navTitle, color = Amll.colors.ink, maxLines = 1)
                Text(rec.artist, style = Font.caption, color = Amll.colors.ink3, maxLines = 1)
            }
            Box(
                Modifier.size(40.dp).clip(RoundedCornerShape(8.dp)).background(Amll.colors.surface2),
            )
        }
        DividerDots()
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            val date = runCatching { LocalDate.parse(rec.date) }.getOrNull()
            Column {
                Text(
                    date?.format(DateTimeFormatter.ofPattern("MMM")).orEmpty().uppercase(),
                    style = Font.micro.copy(fontWeight = FontWeight.Medium),
                    color = Amll.colors.ink3,
                )
                Text(
                    date?.dayOfMonth?.toString() ?: "--",
                    style = Font.numberXL,
                    color = Amll.colors.ink,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(rec.comment.ifBlank { "今天没有留下评论" }, style = Font.bodySmall, color = Amll.colors.ink2)
                Text(
                    "— 来自 @${rec.submitter} 的评论",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        Text(
            "AMLL Hub | 今日推荐",
            style = Font.micro,
            color = Amll.colors.ink3,
            modifier = Modifier.fillMaxWidth(),
        )
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(
                Modifier.size(48.dp).clip(CircleShape).background(Amll.colors.ink).clickable(onClick = onPlay),
                contentAlignment = Alignment.Center,
            ) {
                Icon(Icons.Rounded.PlayArrow, "播放", tint = Amll.colors.canvas, modifier = Modifier.size(24.dp))
            }
            Text(
                (if (liked) "♥" else "♡") + " ${rec.likeCount}",
                style = Font.caption,
                color = if (liked) Amll.colors.primary else Amll.colors.ink2,
                modifier = Modifier.clickable(onClick = onLike),
            )
            Text("下载图片", style = Font.caption, color = Amll.colors.ink2)
        }
    }
}

@Composable
private fun DividerDots() {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        repeat(4) {
            Box(Modifier.size(4.dp).clip(CircleShape).background(Amll.colors.border))
        }
    }
}

/* ============================ 10 消息 ============================ */

@Composable
fun MessagesScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.messages.value.items.isEmpty()) vm.loadMessages() }
    val ui by vm.messages.collectAsStateWithLifecycle()
    var tab by remember { mutableIntStateOf(0) }
    val tabs = listOf("全部", "审核", "投稿", "评论", "系统")

    TabScaffold(selected = 3, nav = nav) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 8.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PageHeader("消息中心") {
                Text(
                    "全部已读",
                    style = Font.caption,
                    color = Amll.colors.ink3,
                    modifier = Modifier.clickable { vm.markAllRead() },
                )
            }

            Row(Modifier.fillMaxWidth().height(34.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                tabs.forEachIndexed { index, label ->
                    val active = index == tab
                    Box(
                        Modifier
                            .weight(1f)
                            .fillMaxSize()
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (active) Amll.colors.surface else Color.Transparent)
                            .clickable { tab = index },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label,
                            style = Font.caption.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium),
                            color = if (active) Amll.colors.ink else Amll.colors.ink3,
                        )
                    }
                }
            }

            val filtered = remember(ui.items, tab) {
                val key = when (tab) {
                    1 -> "review"; 2 -> "submission"; 3 -> "comment"; 4 -> "system"; else -> null
                }
                if (key == null) ui.items else ui.items.filter { it.type == key }
            }

            when {
                ui.loading -> SkeletonList(5)
                filtered.isEmpty() -> EmptyState(Icons.Outlined.Inbox, "暂无消息", "有新的审核结果会在这里通知你")
                else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    itemsIndexed(filtered) { _, message ->
                        MessageRow(message) { vm.markRead(message.id) }
                    }
                }
            }
        }
    }
}

@Composable
private fun MessageRow(
    message: dev.amll.hub.android.data.remote.MessageDto,
    onRead: () -> Unit,
) {
    val tone = when (message.type) {
        "review" -> ChipTone.SUCCESS
        "submission" -> ChipTone.WARNING
        "comment" -> ChipTone.PRIMARY
        else -> ChipTone.INFO
    }
    Row(
        Modifier.fillMaxWidth().height(64.dp).clickable(onClick = onRead),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(36.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(if (tone == ChipTone.SUCCESS) Amll.colors.successSoft else Amll.colors.surface2),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Inbox, null, tint = Amll.colors.ink2, modifier = Modifier.size(18.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                message.title.ifBlank { "通知" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                message.content,
                style = Font.caption,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            message.createdAt.take(10),
            style = Font.micro,
            color = Amll.colors.ink3,
        )
    }
}

/* ============================ 11 我的 ============================ */

@Composable
fun ProfileScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { vm.loadProfile() }
    val profile by vm.profile.collectAsStateWithLifecycle()
    val displayName = profile?.displayName?.takeIf { it.isNotBlank() }
        ?: profile?.name?.takeIf { it.isNotBlank() }
        ?: "未登录"
    val role = when {
        profile?.isAdmin == true -> "管理员"
        profile?.isReviewer == true -> "审核员"
        else -> "普通用户"
    }

    TabScaffold(selected = 4, nav = nav) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(
                    Modifier
                        .size(62.dp)
                        .clip(CircleShape)
                        .background(Brush.linearGradient(listOf(Color(0xFF5C8CEF), Color(0xFF9E6BF0)))),
                )
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(displayName, style = Font.pageTitle.copy(fontSize = 20.sp), color = Amll.colors.ink)
                    Text(
                        "@" + profile?.name.orEmpty().ifBlank { "amll" } + " · " + role,
                        style = Font.caption,
                        color = Amll.colors.ink3,
                    )
                }
                Box(
                    Modifier
                        .clip(RoundedCornerShape(14.dp))
                        .background(Amll.colors.surface)
                        .border(1.dp, Amll.colors.border, RoundedCornerShape(14.dp))
                        .clickable(onClick = nav.openProfileEdit)
                        .padding(horizontal = 12.dp, vertical = 6.dp),
                ) {
                    Text("编辑资料", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink2)
                }
            }

            AmllCard(padding = 16.dp) {
                Text("账号概览", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(6.dp))
                listOf(
                    "用户名" to profile?.name.orEmpty().ifBlank { "—" },
                    "昵称" to displayName,
                    "邮箱" to profile?.email.orEmpty().ifBlank { "未绑定" },
                    "手机号" to profile?.phone.orEmpty().ifBlank { "未绑定" },
                    "身份" to role,
                ).forEach { (label, value) ->
                    Row(
                        Modifier.fillMaxWidth().height(42.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        Text(label, style = Font.bodySmall, color = Amll.colors.ink3)
                        Text(
                            value,
                            style = Font.bodyMedium,
                            color = if (label == "身份") Amll.colors.warning else Amll.colors.ink,
                        )
                    }
                }
            }

            AmllCard(padding = 16.dp) {
                Text("活动记录", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(12.dp))
                Heatmap()
                Spacer(Modifier.height(10.dp))
                Text(
                    "近 20 周 · 投稿歌词 62 次 / 每日推荐 18 次 / 审核 96 次",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }

            AmllCard(padding = 16.dp) {
                NavRow("我的信息", onClick = nav.openProfileEdit)
                NavRow("账号安全", onClick = nav.openProfileEdit)
                NavRow("数据迁移", onClick = nav.openProfileEdit)
                NavRow("审核中心", onClick = nav.openReview)
            }
        }
    }
}

/** 活动贡献墙 */
@Composable
private fun Heatmap() {
    val cell = 16.dp
    val gap = 8.dp
    Column(verticalArrangement = Arrangement.spacedBy(gap)) {
        repeat(3) { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                repeat(12) { col ->
                    val seed = (row * 12 + col) % 7
                    val color = when (seed) {
                        0, 4 -> Amll.colors.primary
                        2, 6 -> Amll.colors.primary.copy(alpha = 0.35f)
                        1 -> Amll.colors.primary.copy(alpha = 0.16f)
                        else -> Amll.colors.surface2
                    }
                    Box(Modifier.size(cell).clip(RoundedCornerShape(4.dp)).background(color))
                }
            }
        }
    }
}
