package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PlayArrow
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.Urls
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.MarkupText
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

/* ============================ 04 每日推荐 ============================ */

private val WEEKDAYS = listOf("日", "一", "二", "三", "四", "五", "六")

@Composable
fun DailyScreen(vm: DailyViewModel, nav: AppNav) {
    val ui by vm.daily.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { if (vm.daily.value.items.isEmpty()) vm.loadDaily() }

    val today = remember { LocalDate.now() }
    val todayKey = today.toString()
    var selectedDate by remember { mutableStateOf(todayKey) }
    var currentMonth by remember { mutableStateOf(YearMonth.from(today)) }
    val likedIds by vm.likedDaily.collectAsStateWithLifecycle()

    // 从「每日推荐投稿」跳进来时定位到刚投稿的日期
    LaunchedEffect(Unit) {
        vm.pendingSelectDate?.let { date ->
            selectedDate = date
            runCatching { YearMonth.from(LocalDate.parse(date)) }.getOrNull()?.let {
                currentMonth = it
            }
            vm.pendingSelectDate = null
            // 刚投稿成功，重新拉一次列表
            vm.loadDaily()
        }
    }

    val recommendMap = remember(ui.items) { ui.items.associateBy { it.date } }
    val recommendDates = remember(ui.items) { ui.items.map { it.date }.toSet() }
    val selected = recommendMap[selectedDate]

    // 网页端进入卡片时会拉一次服务端点赞状态，这里切换日期后同样补一次
    LaunchedEffect(selected?.id) {
        selected?.let { vm.loadLikeStatus(it) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AmllTopBar("每日推荐", onBack = nav.back)

            DailyCalendar(
                currentMonth = currentMonth,
                todayKey = todayKey,
                selectedDate = selectedDate,
                recommendDates = recommendDates,
                onMonthChange = { currentMonth = it },
                onSelectDate = { date ->
                    selectedDate = date
                    val month = runCatching { YearMonth.from(LocalDate.parse(date)) }.getOrNull()
                    if (month != null && month != currentMonth) currentMonth = month
                },
            )

            when {
                ui.loading -> DailyCardSkeleton()
                selected == null -> {
                    val emptyDate = runCatching { LocalDate.parse(selectedDate) }.getOrNull() ?: today
                    EmptyState(
                        icon = Icons.Rounded.MusicNote,
                        title = "${emptyDate.year}年${emptyDate.monthValue}月${emptyDate.dayOfMonth}日 暂无推荐",
                        description = "选择其他日期看看，或成为今天第一个投稿的人",
                    )
                }
                else -> DailyPosterCard(
                    rec = selected,
                    liked = selected.id in likedIds,
                    onLike = { vm.toggleDailyLike(selected) },
                    onPlay = {
                        nav.openLyric(
                            selected.ncmId,
                            selected.songName,
                            selected.artist,
                            Urls.dailyCover(selected.coverKey, 480),
                        )
                    },
                )
            }
        }
    }
}

/* ------------------------------ 整月日历 ------------------------------ */

@Composable
private fun DailyCalendar(
    currentMonth: YearMonth,
    todayKey: String,
    selectedDate: String,
    recommendDates: Set<String>,
    onMonthChange: (YearMonth) -> Unit,
    onSelectDate: (String) -> Unit,
) {
    val today = remember { LocalDate.now() }
    val monthLabel = "${currentMonth.year}年${currentMonth.monthValue}月"
    // 与网页端一致：6 行 × 7 列，含上下月补位
    val cells = remember(currentMonth) { buildCalendarCells(currentMonth) }

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.sheet))
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.sheet))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            CalendarNavButton(Icons.Rounded.ChevronLeft, "上个月") {
                onMonthChange(currentMonth.minusMonths(1))
            }
            Row(
                Modifier.weight(1f),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(monthLabel, style = Font.section.copy(fontSize = 15.sp), color = Amll.colors.ink)
                if (selectedDate != todayKey) {
                    Spacer(Modifier.width(8.dp))
                    Box(
                        Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(Amll.colors.primary)
                            .clickable {
                                onMonthChange(YearMonth.from(today))
                                onSelectDate(todayKey)
                            }
                            .padding(horizontal = 8.dp, vertical = 4.dp),
                    ) {
                        Text("今天", style = Font.micro, color = Amll.colors.onPrimary)
                    }
                }
            }
            CalendarNavButton(Icons.Rounded.ChevronRight, "下个月") {
                onMonthChange(currentMonth.plusMonths(1))
            }
        }

        Row(Modifier.fillMaxWidth()) {
            WEEKDAYS.forEach { label ->
                Text(
                    label,
                    style = Font.micro.copy(fontWeight = FontWeight.SemiBold),
                    color = Amll.colors.ink2,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f).padding(vertical = 2.dp),
                )
            }
        }

        cells.chunked(7).forEach { week ->
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                week.forEach { cell ->
                    CalendarDayCell(
                        cell = cell,
                        isToday = cell.dateKey == todayKey,
                        isSelected = cell.dateKey == selectedDate,
                        hasRecommend = cell.dateKey in recommendDates,
                        onClick = { onSelectDate(cell.dateKey) },
                        modifier = Modifier.weight(1f),
                    )
                }
            }
        }
    }
}

private data class CalendarCell(val dateKey: String, val day: Int, val inMonth: Boolean)

private fun buildCalendarCells(month: YearMonth): List<CalendarCell> {
    val first = month.atDay(1)
    // DayOfWeek 以周一为 1，这里换成「周日为 0」的列号
    val leading = first.dayOfWeek.value % 7
    val daysInMonth = month.lengthOfMonth()
    val prevMonth = month.minusMonths(1)
    val nextMonth = month.plusMonths(1)
    val cells = ArrayList<CalendarCell>(42)
    for (i in leading - 1 downTo 0) {
        val day = prevMonth.lengthOfMonth() - i
        cells += CalendarCell(prevMonth.atDay(day).toString(), day, false)
    }
    for (day in 1..daysInMonth) {
        cells += CalendarCell(month.atDay(day).toString(), day, true)
    }
    var nextDay = 1
    while (cells.size < 42) {
        cells += CalendarCell(nextMonth.atDay(nextDay).toString(), nextDay, false)
        nextDay++
    }
    return cells
}

@Composable
private fun CalendarNavButton(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    description: String,
    onClick: () -> Unit,
) {
    Box(
        Modifier
            .size(30.dp)
            .clip(RoundedCornerShape(8.dp))
            .border(1.dp, Amll.colors.border, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, description, tint = Amll.colors.ink, modifier = Modifier.size(17.dp))
    }
}

@Composable
private fun CalendarDayCell(
    cell: CalendarCell,
    isToday: Boolean,
    isSelected: Boolean,
    hasRecommend: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val bg = when {
        isToday -> Amll.colors.primary
        isSelected -> Amll.colors.primarySoft
        cell.inMonth -> Amll.colors.surface2
        else -> Amll.colors.canvas
    }
    val borderColor = when {
        isToday -> Amll.colors.primary
        isSelected -> Amll.colors.primary
        hasRecommend -> Amll.colors.success
        else -> Amll.colors.border
    }
    val textColor = when {
        isToday -> Amll.colors.onPrimary
        !cell.inMonth -> Amll.colors.ink3.copy(alpha = 0.6f)
        else -> Amll.colors.ink
    }
    Box(
        modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .border(1.dp, borderColor, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            cell.day.toString(),
            style = Font.bodySmall.copy(
                fontWeight = if (isToday || isSelected) FontWeight.SemiBold else FontWeight.Normal,
            ),
            color = textColor,
        )
        if (hasRecommend && !isToday) {
            Box(
                Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 4.dp)
                    .size(4.dp)
                    .clip(CircleShape)
                    .background(Amll.colors.success),
            )
        }
    }
}

/* ------------------------------ 推荐卡片 ------------------------------ */

@Composable
private fun DotSeparator(modifier: Modifier = Modifier) {
    // 颜色在组合阶段取好，Canvas 的绘制 lambda 不是 @Composable 上下文
    val color = Amll.colors.ink3.copy(alpha = 0.5f)
    Canvas(modifier.fillMaxWidth().height(3.dp)) {
        val radius = 1.5.dp.toPx()
        val step = 13.dp.toPx()
        var x = 0f
        while (x <= size.width) {
            drawCircle(color = color, radius = radius, center = Offset(x, size.height / 2))
            x += step
        }
    }
}

@Composable
private fun DailyPosterCard(
    rec: DailyRecDto,
    liked: Boolean,
    onLike: () -> Unit,
    onPlay: () -> Unit,
) {
    val cover = Urls.dailyCover(rec.coverKey, 720)
    val date = runCatching { LocalDate.parse(rec.date) }.getOrNull()
    val monthAbbr = date?.month?.getDisplayName(TextStyle.SHORT, Locale.US)?.uppercase().orEmpty()

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.sheet))
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.sheet))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        // 封面：正方形海报图，未加载时保持灰底
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(Amll.colors.surface2),
        ) {
            if (cover != null) {
                AsyncImage(
                    model = cover,
                    contentDescription = rec.songName,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }

        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                rec.songName.ifBlank { "未命名推荐" },
                style = Font.navTitle.copy(fontSize = 18.sp),
                color = Amll.colors.ink,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                rec.artist.ifBlank { "未知歌手" },
                style = Font.caption.copy(fontWeight = FontWeight.SemiBold),
                color = Amll.colors.ink2,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }

        DotSeparator()

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(18.dp)) {
            Column(
                Modifier.width(62.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    monthAbbr,
                    style = Font.micro.copy(fontWeight = FontWeight.Medium),
                    color = Amll.colors.ink2,
                )
                Text(
                    date?.dayOfMonth?.toString() ?: "--",
                    style = Font.numberXL.copy(fontSize = 40.sp),
                    color = Amll.colors.ink,
                )
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                MarkupText(rec.comment)
                Text(
                    "--来自 @${rec.submitter.ifBlank { "匿名用户" }} 的评论",
                    style = Font.micro,
                    color = Amll.colors.ink2,
                    textAlign = TextAlign.End,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        DotSeparator()

        Text(
            "AMLL Hub | 今日推荐",
            style = Font.caption.copy(fontWeight = FontWeight.Light),
            color = Amll.colors.ink2,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )

        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(Amll.colors.ink)
                    .clickable(onClick = onPlay),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    Icons.Rounded.PlayArrow,
                    "播放",
                    tint = Amll.colors.canvas,
                    modifier = Modifier.size(24.dp).offset(x = 0.5.dp),
                )
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(5.dp),
                modifier = Modifier.clickable(onClick = onLike),
            ) {
                Icon(
                    imageVector = if (liked) Icons.Filled.Favorite else Icons.Outlined.FavoriteBorder,
                    contentDescription = if (liked) "取消点赞" else "点赞",
                    tint = if (liked) Amll.colors.primary else Amll.colors.ink2,
                    modifier = Modifier.size(20.dp),
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

@Composable
private fun DailyCardSkeleton() {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(Radius.sheet))
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.sheet))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f)
                .clip(RoundedCornerShape(12.dp))
                .background(Amll.colors.surface2),
        )
        Box(Modifier.fillMaxWidth(0.6f).height(18.dp).clip(RoundedCornerShape(6.dp)).background(Amll.colors.surface2))
        Box(Modifier.fillMaxWidth(0.35f).height(12.dp).clip(RoundedCornerShape(6.dp)).background(Amll.colors.surface2))
        Box(Modifier.fillMaxWidth().height(70.dp).clip(RoundedCornerShape(8.dp)).background(Amll.colors.surface2))
    }
}
