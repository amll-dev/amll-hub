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
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.component.SegmentedTabs
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.StatusChip
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius

/* ============================ 07 创作中心 ============================ */

/** 歌词管理的状态筛选，取值与后端 repository 的 status 参数一致 */
private val CREATOR_STATUS = listOf(
    "all" to "全部",
    "draft" to "草稿",
    "processing" to "进行中",
    "approved" to "已通过",
    "rejected" to "未通过",
)

private val CREATOR_TABS = listOf("歌词", "每日推荐", "搜索 IP")

@Composable
fun CreatorCenterScreen(vm: CreatorViewModel, nav: AppNav) {
    LaunchedEffect(Unit) {
        vm.loadSubmissions()
        vm.loadSubmissionStats()
    }
    val stats by vm.submissionStats.collectAsStateWithLifecycle()
    val subUi by vm.submissions.collectAsStateWithLifecycle()
    val dailyUi by vm.dailySubmissions.collectAsStateWithLifecycle()
    val ipUi by vm.searchIpSubmissions.collectAsStateWithLifecycle()
    val status by vm.submissionStatus.collectAsStateWithLifecycle()
    var mainTab by remember { mutableIntStateOf(0) }

    TabScaffold {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(
                start = 20.dp,
                end = 20.dp,
                top = 10.dp,
                bottom = bottomBarPadding(16.dp),
            ),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item { PageHeader("创作中心", "投稿进度、修订确认都在这里") }

            item { SubmissionStatsCard(stats) }

            item {
                SectionHeader("我的投稿")
            }

            item {
                SegmentedTabs(
                    labels = CREATOR_TABS,
                    selectedIndex = mainTab,
                    onSelect = { index ->
                        mainTab = index
                        when (index) {
                            0 -> vm.loadSubmissions()
                            1 -> vm.loadDailySubmissions()
                            else -> vm.loadSearchIpSubmissions()
                        }
                    },
                )
            }

            when (mainTab) {
                0 -> {
                    item {
                        Row(
                            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                        ) {
                            CREATOR_STATUS.forEach { (value, label) ->
                                FilterChip(
                                    label = label,
                                    active = value == status,
                                ) { vm.loadSubmissions(value) }
                            }
                        }
                    }
                    when {
                        subUi.loading -> item { SkeletonList(4) }
                        subUi.items.isEmpty() -> item {
                            EmptyState(
                                icon = Icons.Outlined.Inbox,
                                title = subUi.error ?: "暂无稿件",
                                description = "换个筛选条件试试",
                            )
                        }
                        else -> items(subUi.items, key = { it.id }) { item ->
                            SubmissionRow(item) { id ->
                                nav.openSubmission(id)
                            }
                        }
                    }
                }

                1 -> when {
                    dailyUi.loading -> item { SkeletonList(4) }
                    dailyUi.items.isEmpty() -> item {
                        EmptyState(
                            icon = Icons.Outlined.Inbox,
                            title = dailyUi.error ?: "暂无每日推荐投稿",
                            description = "去投一首今天想推荐给大家的歌",
                        )
                    }
                    else -> items(dailyUi.items, key = { it.id }) { item ->
                        DailySubmissionRow(item)
                    }
                }

                else -> when {
                    ipUi.loading -> item { SkeletonList(4) }
                    ipUi.items.isEmpty() -> item {
                        EmptyState(
                            icon = Icons.Outlined.Inbox,
                            title = ipUi.error ?: "暂无搜索 IP 投稿",
                            description = "搜索 IP 显示投稿会出现在这里",
                        )
                    }
                    else -> items(ipUi.items, key = { it.id }) { item ->
                        Row(
                            Modifier.fillMaxWidth().height(56.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(
                                    item.title.ifBlank { "未命名投稿" },
                                    style = Font.bodyMedium,
                                    color = Amll.colors.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    "#${item.id} · ${item.createdAt.take(10)}",
                                    style = Font.micro,
                                    color = Amll.colors.ink3,
                                )
                            }
                            val (label, tone) = statusOf(item.status)
                            StatusChip(label, tone)
                        }
                    }
                }
            }

            item {
                AmllCard(padding = 14.dp) {
                    Text(
                        "逐字打轴请在电脑端完成，手机端可以查看进度、确认修订版",
                        style = Font.micro,
                        color = Amll.colors.ink3,
                    )
                }
            }
        }
    }
}

/** 统计卡：数字全部来自 /submissions/stats */
@Composable
private fun SubmissionStatsCard(stats: SubmissionStatsDto?) {
    val cells = listOf(
        "进行中" to (stats?.processing ?: 0),
        "已通过" to (stats?.approved ?: 0),
        "待确认" to (stats?.revised ?: 0),
        "未通过" to (stats?.rejected ?: 0),
    )
    AmllCard(padding = 14.dp) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            cells.forEach { (label, value) ->
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(
                        value.toString(),
                        style = Font.numberL.copy(fontSize = 22.sp),
                        color = if (value > 0) Amll.colors.ink else Amll.colors.ink3,
                    )
                    Text(label, style = Font.micro, color = Amll.colors.ink3)
                }
            }
        }
    }
}

@Composable
private fun FilterChip(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .height(30.dp)
            .clip(ChipShape)
            .background(if (active) Amll.colors.primary else Amll.colors.surface2)
            .clickable(enabled = !active, onClick = onClick)
            .padding(horizontal = 13.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            style = Font.micro.copy(fontWeight = FontWeight.Medium),
            color = if (active) Amll.colors.onPrimary else Amll.colors.ink2,
        )
    }
}

@Composable
private fun DailySubmissionRow(item: DailyRecDto) {
    Row(
        Modifier.fillMaxWidth().height(56.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                item.songName.ifBlank { "未命名推荐" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${item.date} · ${item.artist.ifBlank { "未知歌手" }}",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
            )
        }
        val (label, tone) = statusOf(item.status)
        StatusChip(label, tone)
    }
}

@Composable
private fun SubmissionRow(item: SubmissionDto, onOpen: (Long) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(60.dp).clickable { onOpen(item.id) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                item.displayName,
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "#${item.id} · ${item.createdAt.take(10)} · ${languageText(item.language)}",
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
            )
        }
        val (label, tone) = statusOf(item.status)
        StatusChip(label, tone)
    }
}

/** 语言代码 → 中文名，未收录的直接显示原值 */
internal fun languageText(code: String): String {
    if (code.isBlank()) return "未标注"
    return when (code) {
        "zh" -> "汉语"
        "en" -> "英语"
        "ja" -> "日语"
        "ko" -> "韩语"
        "others" -> "其他"
        else -> code
    }
}

internal fun statusOf(status: String): Pair<String, ChipTone> = when (status) {
    "approved" -> "已通过" to ChipTone.SUCCESS
    "pending" -> "待审核" to ChipTone.WARNING
    "reviewing" -> "审核中" to ChipTone.INFO
    "need_revision" -> "需修改" to ChipTone.WARNING
    "missing_audio" -> "缺音频" to ChipTone.WARNING
    "revised" -> "待确认修订" to ChipTone.PRIMARY
    "rejected" -> "未通过" to ChipTone.PRIMARY
    "draft" -> "草稿" to ChipTone.NEUTRAL
    "closed" -> "已关闭" to ChipTone.NEUTRAL
    else -> status.ifBlank { "未知" } to ChipTone.NEUTRAL
}
