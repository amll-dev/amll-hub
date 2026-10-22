package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import dev.amll.hub.android.data.remote.SubmissionDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.ChipTone
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.StatusChip
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.HeroShape
import dev.amll.hub.android.ui.theme.Radius

/* ============================ 07 创作中心 ============================ */

@Composable
fun CreatorCenterScreen(vm: AppViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.submissions.value.items.isEmpty()) vm.loadSubmissions() }
    val ui by vm.submissions.collectAsStateWithLifecycle()
    var typeIndex by remember { mutableIntStateOf(0) }
    val types = listOf("歌词投稿", "每日推荐投稿", "搜索 IP 投稿")

    TabScaffold(vm, selected = 2, nav = nav) {
        Column(
            Modifier
                .fillMaxSize()
                .padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            PageHeader("创作中心")

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                types.forEachIndexed { index, label ->
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

            Row(
                Modifier
                    .fillMaxWidth()
                    .height(96.dp)
                    .clip(HeroShape)
                    .background(Brush.linearGradient(listOf(Amll.colors.primary, Color(0xFF59162E))))
                    .clickable(onClick = nav.openSubmit)
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

            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("稿件列表", style = Font.section.copy(fontSize = 14.sp), color = Amll.colors.ink)
                Text("全部稿件", style = Font.caption, color = Amll.colors.ink3)
            }

            when {
                ui.loading -> SkeletonList(3)
                ui.items.isEmpty() -> EmptyState(
                    icon = Icons.Outlined.Inbox,
                    title = "暂无稿件",
                    description = "换个筛选条件试试",
                )
                else -> Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    ui.items.take(4).forEach { item ->
                        SubmissionRow(item) { id ->
                            vm.openSubmission(item)
                            nav.openSubmission(id)
                        }
                    }
                }
            }

            AmllCard(padding = 14.dp) {
                Text(
                    "逐字打轴请在电脑端完成，手机端可微调时间戳",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                )
            }
        }
    }
}

@Composable
private fun SubmissionRow(item: SubmissionDto, onOpen: (Long) -> Unit) {
    Row(
        Modifier.fillMaxWidth().height(56.dp).clickable { onOpen(item.id) },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                item.displayName.ifBlank { "未命名稿件" },
                style = Font.bodyMedium,
                color = Amll.colors.ink,
                maxLines = 1,
            )
            Text(item.createdAt.take(10), style = Font.micro, color = Amll.colors.ink3)
        }
        val (label, tone) = statusOf(item.status)
        StatusChip(label, tone)
    }
}

private fun statusOf(status: String): Pair<String, ChipTone> = when (status) {
    "approved" -> "已通过" to ChipTone.SUCCESS
    "pending" -> "待审核" to ChipTone.WARNING
    "reviewing" -> "审核中" to ChipTone.INFO
    "revised" -> "待投稿者确认" to ChipTone.WARNING
    "rejected" -> "未通过" to ChipTone.PRIMARY
    "draft" -> "草稿" to ChipTone.NEUTRAL
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
    val (statusLabel, statusTone) = statusOf(detail?.status.orEmpty())
    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        AmllTopBar("稿件详情", onBack = nav.back) {
            Icon(Icons.Rounded.MoreHoriz, "更多", tint = Amll.colors.ink, modifier = Modifier.size(20.dp))
        }

        AmllCard(padding = 16.dp) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatusChip(statusLabel, statusTone)
                Text(
                    detail?.createdAt?.take(10)?.takeIf { it.isNotBlank() } ?: "等待审核",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        val songTitle = detail?.displayName?.takeIf { it.isNotBlank() } ?: "未命名稿件"
        AmllCard(padding = 16.dp) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                CoverImage(null, songTitle, 48.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text(songTitle, style = Font.bodyMedium, color = Amll.colors.ink, maxLines = 1)
                    Text(
                        listOfNotNull(
                            detail?.artist?.takeIf { it.isNotBlank() },
                            detail?.createdAt?.take(10)?.takeIf { it.isNotBlank() },
                        ).joinToString(" · ").ifBlank { "—" },
                        style = Font.micro,
                        color = Amll.colors.ink3,
                    )
                }
                Icon(Icons.Rounded.PlayArrow, "播放", tint = Amll.colors.ink3, modifier = Modifier.size(22.dp))
            }
        }

        AmllCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                listOf(
                    Triple("提交投稿", (detail?.createdAt?.take(10) ?: "—") + " · TTML + 音频", Amll.colors.ink3),
                    Triple("当前状态", statusLabel, Amll.colors.ink3),
                ).forEach { (title, meta, dot) ->
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Top) {
                        Box(Modifier.padding(top = 5.dp).size(8.dp).clip(CircleShape).background(dot))
                        Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            Text(title, style = Font.bodySmall.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink)
                            Text(meta, style = Font.micro, color = Amll.colors.ink3)
                        }
                    }
                }
            }
        }

        Column(
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(Amll.colors.surface2)
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text("评论", style = Font.micro.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink3)
            Text("打轴很准，对唱段落分得很清楚，已通过。", style = Font.bodySmall, color = Amll.colors.ink2)
        }

        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            GhostButton("电脑端继续编辑", onClick = {}, modifier = Modifier.weight(1f))
            PrimaryButton("上传音频", onClick = {}, modifier = Modifier.weight(1f))
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
