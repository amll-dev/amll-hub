package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.FileDownload
import androidx.compose.material.icons.rounded.MoreHoriz
import androidx.compose.material.icons.rounded.PlayArrow
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.data.remote.DailyRecDto
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.data.remote.SubmissionStatsDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.TabScaffold
import dev.amll.hub.android.ui.bottomBarPadding
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.ChipTone
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SegmentedTabs
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.StatusChip
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius

/* ============================ 20 审核队列 ============================ */

@Composable
fun ReviewQueueScreen(vm: CreatorViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.submissions.value.items.isEmpty()) vm.loadSubmissions() }
    val ui by vm.submissions.collectAsStateWithLifecycle()
    var typeIndex by remember { mutableIntStateOf(0) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        AmllTopBar("审核中心", onBack = nav.back) {
            Text("筛选", style = Font.caption, color = Amll.colors.ink3)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("歌词投稿", "每日推荐", "搜索 IP").forEachIndexed { index, label ->
                val active = index == typeIndex
                Box(
                    Modifier
                        .clip(ChipShape)
                        .background(if (active) Amll.colors.primarySoft else Amll.colors.surface2)
                        .clickable { typeIndex = index }
                        .padding(horizontal = 12.dp, vertical = 7.dp),
                ) {
                    Text(
                        label,
                        style = Font.micro.copy(fontWeight = FontWeight.Medium),
                        color = if (active) Amll.colors.primary else Amll.colors.ink3,
                    )
                }
            }
        }

        val pendingCount = ui.items.count { it.status == "pending" }
        val reviewingCount = ui.items.count { it.status == "reviewing" }
        val revisedCount = ui.items.count { it.status == "revised" }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip("待审核 $pendingCount", ChipTone.PRIMARY)
            StatusChip("审核中 $reviewingCount", ChipTone.NEUTRAL)
            StatusChip("待确认 $revisedCount", ChipTone.NEUTRAL)
        }

        when {
            ui.loading -> SkeletonList(4)
            ui.items.isEmpty() -> EmptyState(Icons.Outlined.Inbox, "暂无稿件", "换个筛选条件试试")
            else -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                ui.items.forEach { item ->
                    Row(
                        Modifier.fillMaxWidth().height(74.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Text(
                                item.displayName.ifBlank { "未命名稿件" },
                                style = Font.bodyMedium,
                                color = Amll.colors.ink,
                                maxLines = 1,
                            )
                            Text(
                                "${item.artist.ifBlank { "未知歌手" }} · 投稿人 ${item.submitter.ifBlank { "匿名" }}",
                                style = Font.micro,
                                color = Amll.colors.ink3,
                            )
                            Text(
                                "已等待 ${item.createdAt.take(10)}",
                                style = Font.micro,
                                color = Amll.colors.ink3.copy(alpha = 0.7f),
                            )
                        }
                        val (label, tone) = statusOf(item.status)
                        StatusChip(label, tone)
                    }
                }
            }
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(40.dp)
                .clip(RoundedCornerShape(Radius.field))
                .background(Amll.colors.surface2)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            Text("进入详情即占用该稿件，离开或超时自动释放", style = Font.micro, color = Amll.colors.ink3)
        }
    }
}
