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
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.AddCircleOutline
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Explore
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.PersonOutline
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.HorizontalDivider
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
import java.time.format.TextStyle
import java.util.Locale

/* ============================ 04 每日推荐 ============================ */

@Composable
fun DailyScreen(vm: DailyViewModel, nav: AppNav) {
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

private fun weekdayLabel(date: LocalDate?): String =
    date?.dayOfWeek?.getDisplayName(TextStyle.NARROW, Locale.CHINA) ?: "--"

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
        HorizontalDivider(color = Amll.colors.border, thickness = 1.dp)
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
                Icon(
                    Icons.Rounded.PlayArrow,
                    "播放",
                    tint = Amll.colors.canvas,
                    // 同上：仅做 0.5dp 视觉回正，三角形不再偏左
                    modifier = Modifier.size(24.dp).offset(x = (-0.5).dp),
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                modifier = Modifier.clickable(onClick = onLike),
            ) {
                Icon(
                    imageVector = if (liked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    contentDescription = if (liked) "取消点赞" else "点赞",
                    tint = if (liked) Amll.colors.primary else Amll.colors.ink2,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    "${rec.likeCount}",
                    style = Font.caption,
                    color = if (liked) Amll.colors.primary else Amll.colors.ink2,
                )
            }
        }
    }
}
