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
import dev.amll.hub.android.ui.AppViewModel
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
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius
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
fun SearchField(
    placeholder: String,
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .clip(RoundedCornerShape(15.dp))
            .background(Amll.colors.surface2)
            // 上下留白取左右的一半，比原来 46dp 定高更紧凑
            .padding(horizontal = 14.dp, vertical = 7.dp),
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
    LaunchedEffect(Unit) {
        if (vm.home.value.latest.isEmpty()) vm.loadHome()
        vm.loadProfile()
    }
    val ui by vm.home.collectAsStateWithLifecycle()
    val profile by vm.profile.collectAsStateWithLifecycle()

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
            item {
                HomeHeader(
                    avatar = profile?.avatar,
                    onScan = nav.openScan,
                )
            }

            item { SearchField("搜歌名、歌手，或粘贴歌词片段", onClick = nav.openSearch) }

            item {
                TodayHero(ui.today) {
                    val rec = ui.today
                    if (rec != null) {
                        nav.openLyric(rec.ncmId, rec.songName, rec.artist, Urls.dailyCover(rec.coverKey, 480))
                    } else {
                        nav.openDaily()
                    }
                }
            }

            item { SectionHeader("最新收录", action = "查看全部", onAction = nav.openLatest) }

            when {
                ui.loading -> item { SkeletonList(3) }
                ui.latest.isEmpty() -> item {
                    Text("暂无最新收录", style = Font.bodySmall, color = Amll.colors.ink3)
                }
                // 歌曲之间 2dp：外层 16dp 的 section 间距会把列表拉得很散
                else -> item {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        ui.latest.take(6).forEach { song ->
                            SongRow(
                                title = song.title,
                                subtitle = song.artist,
                                coverUrl = song.coverUrl.ifBlank { null },
                                onClick = {
                                    nav.openLyric(song.ncmId, song.title, song.artist, song.coverUrl)
                                },
                            )
                        }
                    }
                }
            }

            item { RankingTeaser(ui.ranking.firstOrNull(), onClick = nav.openRanking) }
        }
    }
}

@Composable
private fun HomeHeader(
    avatar: String?,
    onScan: () -> Unit,
) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("AMLL Hub", style = Font.pageTitle, color = Amll.colors.ink, modifier = Modifier.weight(1f))
        Icon(
            Icons.Rounded.QrCodeScanner,
            "扫一扫",
            tint = Amll.colors.ink,
            modifier = Modifier.size(21.dp).clickable(onClick = onScan),
        )
        Spacer(Modifier.width(14.dp))
        Avatar(avatar, 32.dp)
    }
}

/** 头像：有地址走网络图，没有就退回渐变占位，避免出现空洞 */
@Composable
fun Avatar(url: String?, size: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val model = Urls.absolute(url)
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.linearGradient(listOf(Color(0xFF5C8CEF), Color(0xFF9E6BF0)))),
    ) {
        if (model != null) {
            AsyncImage(
                model = model,
                contentDescription = "头像",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun TodayHero(today: DailyRecDto?, onClick: () -> Unit) {
    val cover = Urls.dailyCover(today?.coverKey, 480)
    Box(
        Modifier
            .fillMaxWidth()
            .height(168.dp)
            .clip(HeroShape)
            .clickable(onClick = onClick),
    ) {
        // 背景：封面高斯模糊；拿不到封面时用标题生成的渐变兜底
        Box(
            Modifier
                .fillMaxSize()
                .background(coverBrush(today?.songName ?: "AMLL")),
        )
        if (cover != null) {
            AsyncImage(
                model = cover,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier
                    .fillMaxSize()
                    .then(
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            Modifier.blur(26.dp)
                        } else {
                            Modifier
                        },
                    ),
            )
        }
        // 压一层暗角，保证左侧白字在任何封面上都可读
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.horizontalGradient(
                        listOf(Color.Black.copy(alpha = 0.78f), Color.Black.copy(alpha = 0.42f)),
                    ),
                ),
        )

        Row(
            Modifier.fillMaxSize().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(104.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Color.White.copy(alpha = 0.12f)),
            ) {
                if (cover != null) {
                    AsyncImage(
                        model = cover,
                        contentDescription = today?.songName,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(Color.White.copy(alpha = 0.22f))
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                ) {
                    Text(
                        "今日推荐",
                        style = Font.micro.copy(fontWeight = FontWeight.Medium),
                        color = Color.White,
                    )
                }
                Text(
                    today?.songName ?: "今日暂无推荐",
                    style = Font.navTitle.copy(fontSize = 19.sp),
                    color = Color.White,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    today?.let { "${it.artist} · 来自 @${it.submitter}" } ?: "成为今天第一个投稿的人",
                    style = Font.caption,
                    color = Color.White.copy(alpha = 0.82f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (today != null) {
                Box(
                    Modifier
                        .size(38.dp)
                        .clip(CircleShape)
                        .background(Color.White),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        Icons.Rounded.PlayArrow,
                        "播放",
                        tint = Amll.colors.primary,
                        // PlayArrow 字形自带约 1/4 的透明边距，28dp 才撑满 38dp 的圆
                        modifier = Modifier.size(28.dp).offset(x = 1.dp),
                    )
                }
            }
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
                        gradient = listOf(Color(0xFF3D5CDF), Color(0xFF7040C7)),
                        modifier = Modifier.weight(1f),
                        onClick = nav.openSearch,
                    )
                    DiscoverCard(
                        title = "每日推荐",
                        desc = "看看今天大家都在听什么",
                        gradient = listOf(Color(0xFFE0303F), Color(0xFF8C2148)),
                        modifier = Modifier.weight(1f),
                        onClick = nav.openDaily,
                    )
                }
            }

            item {
                DiscoverCard(
                    title = "网易云解析",
                    desc = "粘贴歌曲 ID / 链接，或按关键词搜到就能直接播",
                    gradient = listOf(Color(0xFFE0303F), Color(0xFFC93A6E)),
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
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 10.dp),
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
                        nav.openLyric(
                            current.ncmId,
                            current.songName,
                            current.artist,
                            Urls.dailyCover(current.coverKey, 480),
                        )
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
            val cover = Urls.dailyCover(rec.coverKey, 720)
            if (cover != null) {
                AsyncImage(
                    model = cover,
                    contentDescription = rec.songName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
                Box(
                    Modifier
                        .fillMaxSize()
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Black.copy(alpha = 0.18f), Color.Black.copy(alpha = 0.55f)),
                            ),
                        ),
                )
            }
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

    TabScaffold {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 20.dp, end = 20.dp, top = 10.dp),
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
                else -> LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(2.dp),
                    contentPadding = PaddingValues(bottom = bottomBarPadding(8.dp)),
                ) {
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
    LaunchedEffect(Unit) {
        vm.loadProfile()
        vm.loadActivity()
    }
    val profile by vm.profile.collectAsStateWithLifecycle()
    val activity by vm.activity.collectAsStateWithLifecycle()
    val activityLoading by vm.activityLoading.collectAsStateWithLifecycle()
    val displayName = profile?.displayName?.takeIf { it.isNotBlank() }
        ?: profile?.name?.takeIf { it.isNotBlank() }
        ?: "未登录"
    val role = when {
        profile?.isAdmin == true -> "管理员"
        profile?.isReviewer == true -> "审核员"
        else -> "普通用户"
    }

    TabScaffold {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(
                    start = 20.dp,
                    end = 20.dp,
                    top = 14.dp,
                    bottom = bottomBarPadding(16.dp),
                ),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                Avatar(profile?.avatar, 62.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(displayName, style = Font.pageTitle.copy(fontSize = 20.sp), color = Amll.colors.ink)
                    Text(
                        "@" + profile?.name.orEmpty().ifBlank { "amll" } + " · " + role,
                        style = Font.caption,
                        color = Amll.colors.ink3,
                    )
                }
                Icon(
                    Icons.Rounded.QrCodeScanner,
                    "扫一扫",
                    tint = Amll.colors.ink2,
                    modifier = Modifier.size(20.dp).clickable(onClick = nav.openScan),
                )
                Spacer(Modifier.width(10.dp))
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
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("活动记录", style = Font.cardTitle, color = Amll.colors.ink, modifier = Modifier.weight(1f))
                    Text(
                        activity?.year?.let { "$it 年" } ?: "",
                        style = Font.micro,
                        color = Amll.colors.ink3,
                    )
                }
                Spacer(Modifier.height(12.dp))
                ActivityHeatmap(activity)
                Spacer(Modifier.height(10.dp))
                Text(
                    activitySummary(activity, activityLoading),
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }

            AmllCard(padding = 16.dp) {
                NavRow("扫一扫", value = "授权网页登录", onClick = nav.openScan)
                NavRow("我的信息", onClick = nav.openProfileEdit)
                NavRow("账号安全", onClick = nav.openProfileEdit)
                NavRow("审核中心", onClick = nav.openReview)
            }
        }
    }
}

/** 活动贡献墙：最近 20 周 × 7 天，颜色深浅对应当天次数 */
@Composable
private fun ActivityHeatmap(activity: UserActivityDto?) {
    val counts = remember(activity) {
        activity?.days?.associate { it.date to it.count }.orEmpty()
    }
    val today = remember { LocalDate.now() }
    val start = remember(today) {
        today.with(java.time.DayOfWeek.MONDAY).minusWeeks(19)
    }

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = 3.dp
        val cell = (maxWidth - gap * 19f) * (1f / 20f)
        Column(verticalArrangement = Arrangement.spacedBy(gap)) {
            repeat(7) { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    repeat(20) { col ->
                        val date = start.plusDays((col * 7 + row).toLong())
                        val future = date.isAfter(today)
                        val count = counts[date.toString()] ?: 0
                        Box(
                            Modifier
                                .size(cell)
                                .clip(RoundedCornerShape(3.dp))
                                .background(if (future) Color.Transparent else heatColor(count)),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun heatColor(count: Int): Color = when {
    count <= 0 -> Amll.colors.surface2
    count == 1 -> Amll.colors.primary.copy(alpha = 0.28f)
    count <= 3 -> Amll.colors.primary.copy(alpha = 0.5f)
    count <= 6 -> Amll.colors.primary.copy(alpha = 0.75f)
    else -> Amll.colors.primary
}

private fun activitySummary(activity: UserActivityDto?, loading: Boolean): String {
    if (activity == null) return if (loading) "正在加载活动记录…" else "暂无活动记录"
    val byType = activity.byType
    val parts = listOfNotNull(
        byType["lyric"]?.takeIf { it > 0 }?.let { "投稿歌词 $it 次" },
        byType["daily"]?.takeIf { it > 0 }?.let { "每日推荐 $it 次" },
        byType["review"]?.takeIf { it > 0 }?.let { "审核 $it 次" },
        byType["search_ip"]?.takeIf { it > 0 }?.let { "歌词 IP $it 次" },
    )
    return if (parts.isEmpty()) "今年还没有留下记录" else "今年共 ${activity.total} 次 · " + parts.joinToString(" / ")
}
