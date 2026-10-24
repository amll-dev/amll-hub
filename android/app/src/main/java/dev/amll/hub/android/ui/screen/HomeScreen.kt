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
fun HomeScreen(vm: HomeViewModel, profileVm: ProfileViewModel, nav: AppNav) {
    LaunchedEffect(Unit) {
        if (vm.home.value.latest.isEmpty()) vm.loadHome()
        profileVm.loadProfile()
    }
    val ui by vm.home.collectAsStateWithLifecycle()
    val profile by profileVm.profile.collectAsStateWithLifecycle()

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
                if (ui.loading) {
                    TodayHeroSkeleton()
                } else {
                    TodayHero(ui.today) {
                        val rec = ui.today
                        if (rec != null) {
                            nav.openLyric(rec.ncmId, rec.songName, rec.artist, Urls.dailyCover(rec.coverKey, 480))
                        } else {
                            nav.openDaily()
                        }
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

            item {
                SectionHeader(
                    title = "请求数最高的待补歌词",
                    action = "查看完整排行",
                    onAction = nav.openRanking,
                )
            }

            item {
                when {
                    ui.loading -> SkeletonList(3)
                    ui.ranking.isEmpty() -> AmllCard(padding = 14.dp) {
                        Text(
                            "最近 7 天没有缺歌词请求",
                            style = Font.caption,
                            color = Amll.colors.ink3,
                        )
                    }
                    else -> AmllCard(padding = 6.dp) {
                        ui.ranking.take(5).forEachIndexed { index, entry ->
                            HomeRankRow(rank = index + 1, item = entry) {
                                nav.openLyric(
                                    entry.platformId,
                                    entry.songName,
                                    entry.artists.joinToString("/"),
                                    entry.cover,
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 首页排行榜行：序号 + 封面 + 歌名/歌手 + 请求次数（对齐网页端 NotFoundRanking） */
@Composable
private fun HomeRankRow(rank: Int, item: RankingItemDto, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            "$rank",
            style = Font.bodyMedium.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold),
            color = if (rank == 1) Amll.colors.primary else Amll.colors.ink3,
            modifier = Modifier.width(16.dp),
        )
        CoverImage(item.cover.ifBlank { null }, item.songName, 40.dp, radius = Radius.field)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                item.songName.ifBlank { "未知歌曲" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (item.artists.isNotEmpty()) {
                Text(
                    item.artists.joinToString(" / "),
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        Text(
            "${item.requestCount} 次请求",
            style = Font.micro,
            color = Amll.colors.ink2,
        )
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

/** 头像：加载中/无地址时统一显示灰色底，与网页端一致 */
@Composable
fun Avatar(url: String?, size: androidx.compose.ui.unit.Dp, modifier: Modifier = Modifier) {
    val model = Urls.absolute(url)
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Amll.colors.surface2),
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
                        // PlayArrow 字形在视口内略偏右，仅做 0.5dp 的视觉回正，
                        // 避免整格居中后因为三角形重心靠左而显得偏左
                        modifier = Modifier.size(28.dp).offset(x = (-0.5).dp),
                    )
                }
            }
        }
    }
}

/** 今日推荐加载态：与 TodayHero 同尺寸，避免加载时显示「今日暂无推荐」 */
@Composable
private fun TodayHeroSkeleton() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(168.dp)
            .clip(HeroShape)
            .background(Amll.colors.surface2),
    ) {
        Row(
            Modifier.fillMaxSize().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                Modifier
                    .size(104.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(Amll.colors.surface),
            )
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(
                    Modifier
                        .width(56.dp)
                        .height(18.dp)
                        .clip(RoundedCornerShape(9.dp))
                        .background(Amll.colors.surface),
                )
                Box(
                    Modifier
                        .fillMaxWidth(0.7f)
                        .height(18.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Amll.colors.surface),
                )
                Box(
                    Modifier
                        .fillMaxWidth(0.5f)
                        .height(12.dp)
                        .clip(RoundedCornerShape(6.dp))
                        .background(Amll.colors.surface),
                )
            }
        }
    }
}
