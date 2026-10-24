package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.QrCodeScanner
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.TabScaffold
import dev.amll.hub.android.ui.bottomBarPadding
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.NavRow
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import java.time.LocalDate

/* ============================ 11 我的 ============================ */

@Composable
fun ProfileScreen(vm: ProfileViewModel, nav: AppNav) {
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

    val ramp = heatRamp()

    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val gap = 3.dp
        val cell = (maxWidth - gap * 19f) * (1f / 20f)
        val cellPx = with(LocalDensity.current) { cell.toPx() }
        val gapPx = with(LocalDensity.current) { gap.toPx() }
        val radius = with(LocalDensity.current) { 3.dp.toPx() }
        // 一次 Canvas 画完 20×7 格：140 个 Box 会产生同样多的布局与语义节点
        Canvas(Modifier.fillMaxWidth().height(cell * 7 + gap * 6)) {
            for (col in 0 until 20) {
                for (row in 0 until 7) {
                    val date = start.plusDays((col * 7 + row).toLong())
                    if (date.isAfter(today)) continue
                    val count = counts[date.toString()] ?: 0
                    drawRoundRect(
                        color = heatColor(count, ramp),
                        topLeft = Offset(col * (cellPx + gapPx), row * (cellPx + gapPx)),
                        size = Size(cellPx, cellPx),
                        cornerRadius = CornerRadius(radius),
                    )
                }
            }
        }
    }
}

@Composable
private fun heatRamp(): List<Color> = listOf(
    Amll.colors.surface2,
    Amll.colors.primary.copy(alpha = 0.28f),
    Amll.colors.primary.copy(alpha = 0.5f),
    Amll.colors.primary.copy(alpha = 0.75f),
    Amll.colors.primary,
)

/** 有序色阶：按当天次数取档，避免把颜色写死在 when 里 */
private fun heatColor(count: Int, ramp: List<Color>): Color {
    val index = when {
        count <= 0 -> 0
        count == 1 -> 1
        count <= 3 -> 2
        count <= 6 -> 3
        else -> 4
    }
    return ramp[index]
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
