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
import dev.amll.hub.android.ui.AppViewModel
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
fun CreatorCenterScreen(vm: AppViewModel, nav: AppNav) {
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

            item { NewSubmissionCard(nav.openSubmit) }

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
                                vm.openSubmission(item)
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
private fun NewSubmissionCard(onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(96.dp)
            .clip(HeroShape)
            .background(Brush.linearGradient(listOf(Amll.colors.primary, Color(0xFF59162E))))
            .clickable(onClick = onClick)
            .padding(18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(
            Modifier.size(38.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.18f)),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Add, "新建投稿", tint = Color.White, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("新建投稿", style = Font.sheetTitle, color = Color.White)
            Text(
                "歌词 / 每日推荐 / 搜索 IP 三类投稿",
                style = Font.micro,
                color = Color.White.copy(alpha = 0.85f),
            )
        }
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

private fun statusOf(status: String): Pair<String, ChipTone> = when (status) {
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

/* ============================ 08 投稿表单 ============================ */

@Composable
fun SubmitScreen(nav: AppNav) {
    var agreed by remember { mutableStateOf(true) }
    Column(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
        Column(
            Modifier
                .weight(1f)
                .statusBarsPadding()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            AmllTopBar("新建投稿", onBack = nav.back) {
                Text("1 / 3", style = Font.caption, color = Amll.colors.ink3)
            }

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                StepChip("1 歌曲信息", true, Modifier.weight(1f))
                StepChip("2 歌词文件", false, Modifier.weight(1f))
                StepChip("3 确认提交", false, Modifier.weight(1f))
            }

            AmllCard(padding = 16.dp) {
                Text("歌曲信息", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FieldRow("歌曲名", "夜に駆ける")
                    FieldRow("歌手", "YOASOBI")
                    FieldRow("语言", "日语")
                }
            }

            AmllCard(padding = 16.dp) {
                Text("投稿文件", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(10.dp))
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    FileRow("歌词文件 (TTML)", "夜に駆ける.ttml · 18 KB", "必填", Amll.colors.primary)
                    FileRow("音频文件", "夜に駆ける.flac · 42.6 MB · 已解析", "可选", Amll.colors.ink3)
                }
            }

            AmllCard(padding = 16.dp) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("标签与备注", style = Font.cardTitle, color = Amll.colors.ink)
                    Text("可选", style = Font.micro, color = Amll.colors.ink3)
                }
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(
                        Modifier.clip(ChipShape).background(Amll.colors.primarySoft).padding(horizontal = 11.dp, vertical = 7.dp),
                    ) {
                        Text("City Pop ×", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.primary)
                    }
                    Box(
                        Modifier
                            .clip(ChipShape)
                            .background(Amll.colors.surface)
                            .border(1.dp, Amll.colors.border, ChipShape)
                            .padding(horizontal = 11.dp, vertical = 7.dp),
                    ) {
                        Text("+ 添加标签", style = Font.micro, color = Amll.colors.ink3)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(48.dp)
                        .clip(RoundedCornerShape(Radius.field))
                        .background(Amll.colors.surface2)
                        .padding(11.dp),
                ) {
                    Text("给审核员的留言，如特殊处理说明等", style = Font.micro, color = Amll.colors.ink3)
                }
            }

            Row(
                Modifier.clickable { agreed = !agreed },
                verticalAlignment = Alignment.Top,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Box(
                    Modifier
                        .size(17.dp)
                        .clip(RoundedCornerShape(5.dp))
                        .background(if (agreed) Amll.colors.primary else Amll.colors.surface2),
                    contentAlignment = Alignment.Center,
                ) {
                    if (agreed) Icon(Icons.Rounded.Check, null, tint = Color.White, modifier = Modifier.size(12.dp))
                }
                Text(
                    "我确认歌词为本人制作或已获授权，并同意《投稿规范》",
                    style = Font.micro,
                    color = Amll.colors.ink2,
                )
            }
        }

        Row(
            Modifier
                .fillMaxWidth()
                .background(Amll.colors.canvas)
                .navigationBarsPadding()
                .padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            GhostButton("存为草稿", onClick = nav.back, modifier = Modifier.weight(1f))
            PrimaryButton("提交审核", onClick = nav.back, modifier = Modifier.weight(1f), enabled = agreed)
        }
    }
}

@Composable
private fun StepChip(text: String, active: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier
            .height(30.dp)
            .clip(RoundedCornerShape(15.dp))
            .background(if (active) Amll.colors.primarySoft else Amll.colors.surface2),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = Font.micro.copy(fontWeight = if (active) FontWeight.Medium else FontWeight.Normal),
            color = if (active) Amll.colors.primary else Amll.colors.ink3,
        )
    }
}

@Composable
private fun FileRow(label: String, meta: String, state: String, stateColor: Color) {
    Row(
        Modifier
            .fillMaxWidth()
            .height(52.dp)
            .clip(RoundedCornerShape(Radius.field))
            .background(Amll.colors.surface2)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(Icons.Rounded.FileDownload, null, tint = Amll.colors.ink2, modifier = Modifier.size(20.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(label, style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink)
            Text(meta, style = Font.micro, color = Amll.colors.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(state, style = Font.micro.copy(fontWeight = FontWeight.Medium), color = stateColor)
    }
}

/* ============================ 09 稿件详情 ============================ */

@Composable
fun SubmissionDetailScreen(vm: AppViewModel, nav: AppNav) {
    val detail by vm.submissionDetail.collectAsStateWithLifecycle()
    var working by remember { mutableStateOf(false) }
    val (statusLabel, statusTone) = statusOf(detail?.status.orEmpty())
    val status = detail?.status.orEmpty()

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AmllTopBar("稿件详情", onBack = nav.back) {
            StatusChip(statusLabel, statusTone)
        }

        AmllCard(padding = 16.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                val songTitle = detail?.displayName ?: "未命名稿件"
                CoverImage(null, songTitle, 48.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(songTitle, style = Font.bodyMedium, color = Amll.colors.ink, maxLines = 2)
                    Text(
                        listOfNotNull(
                            detail?.artist?.takeIf { it.isNotBlank() },
                            detail?.ncmId?.takeIf { it.isNotBlank() }?.let { "网易云 $it" },
                        ).joinToString(" · ").ifBlank { "—" },
                        style = Font.micro,
                        color = Amll.colors.ink3,
                    )
                }
            }
        }

        AmllCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                FieldRow("稿件编号", detail?.id?.takeIf { it > 0 }?.let { "#$it" } ?: "—")
                FieldRow("当前状态", statusLabel)
                FieldRow("语言", languageText(detail?.language.orEmpty()))
                FieldRow("提交时间", detail?.createdAt?.take(16)?.replace('T', ' ') ?: "—")
                FieldRow("最近更新", detail?.updatedAt?.take(16)?.replace('T', ' ') ?: "—")
                val fileName = detail?.fileName.orEmpty()
                if (fileName.isNotBlank()) FieldRow("文件", fileName)
            }
        }

        // 审核意见：有才显示，空的不占位
        val comment = detail?.reviewComment.orEmpty()
        if (comment.isNotBlank()) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(14.dp))
                    .background(Amll.colors.surface2)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text("审核意见", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink3)
                Text(comment, style = Font.bodySmall, color = Amll.colors.ink2)
            }
        }

        // 修订版待确认：投稿者必须处理的一步
        if (status == "revised") {
            AmllCard(padding = 16.dp) {
                Text("审核员提交了修订版", style = Font.cardTitle, color = Amll.colors.ink)
                Spacer(Modifier.height(4.dp))
                Text(
                    "采用后按通过处理；退回则需要继续修改。",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton(
                    text = "退回修改",
                    onClick = {
                        val id = detail?.id ?: 0L
                        if (id > 0L && !working) {
                            working = true
                            vm.rejectRevision(id) { working = false }
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
                PrimaryButton(
                    text = "采用修订版",
                    onClick = {
                        val id = detail?.id ?: 0L
                        if (id > 0L && !working) {
                            working = true
                            vm.adoptRevision(id) { working = false }
                        }
                    },
                    modifier = Modifier.weight(1f),
                    enabled = !working,
                )
            }
        }

        // 未完结的稿件可以关闭（撤回）
        if (status in setOf("draft", "pending", "reviewing", "need_revision", "missing_audio")) {
            GhostButton(
                text = if (working) "处理中…" else "关闭这篇稿件",
                onClick = {
                    val id = detail?.id ?: 0L
                    if (id > 0L && !working) {
                        working = true
                        vm.closeSubmission(id) {
                            working = false
                            nav.back()
                        }
                    }
                },
            )
        }
    }
}

/* ============================ 12 资料编辑 ============================ */

@Composable
fun ProfileEditScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { vm.loadProfile() }
    val profile by vm.profile.collectAsStateWithLifecycle()
    var name by remember(profile) { mutableStateOf(profile?.displayName.orEmpty()) }
    var saving by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        AmllTopBar("编辑资料", onBack = nav.back)
        Avatar(profile?.avatar, 82.dp)
        Text("更换头像", style = Font.caption.copy(fontWeight = FontWeight.Medium), color = Amll.colors.primary)
        AmllCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(Radius.field))
                        .background(Amll.colors.surface2)
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("昵称", style = Font.bodySmall, color = Amll.colors.ink3)
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.weight(1f)) {
                        if (name.isBlank()) {
                            Text("输入昵称", style = Font.bodyMedium, color = Amll.colors.ink3)
                        }
                        BasicTextField(
                            value = name,
                            onValueChange = { name = it },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(
                                fontSize = 13.5.sp,
                                color = Amll.colors.ink,
                            ),
                            cursorBrush = SolidColor(Amll.colors.primary),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                FieldRow("用户名", profile?.name.orEmpty().ifBlank { "—" })
            }
        }
        Text(
            "用户名注册后不可修改；昵称会显示在评论与投稿记录里。",
            style = Font.micro,
            color = Amll.colors.ink3,
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(
            text = if (saving) "保存中…" else "保存修改",
            enabled = name.isNotBlank() && !saving,
            onClick = {
                saving = true
                vm.saveDisplayName(name) { ok ->
                    saving = false
                    if (ok) nav.back()
                }
            },
        )
    }
}

/* ============================ 20 审核队列 ============================ */

@Composable
fun ReviewQueueScreen(vm: AppViewModel, nav: AppNav) {
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

        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            StatusChip("待审核 ${ui.items.size}", ChipTone.PRIMARY)
            StatusChip("审核中 0", ChipTone.NEUTRAL)
            StatusChip("待确认 0", ChipTone.NEUTRAL)
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
                                "${item.artist.ifBlank { "未知歌手" }} · 投稿人 @${item.id}",
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
