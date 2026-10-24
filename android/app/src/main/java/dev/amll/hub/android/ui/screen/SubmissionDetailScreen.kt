package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.StatusChip
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/* ============================ 09 稿件详情 ============================ */

@Composable
fun SubmissionDetailScreen(id: Long, vm: CreatorViewModel, nav: AppNav) {
    LaunchedEffect(id) { vm.loadSubmission(id) }
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
            // 稿件本身没有封面，这里只展示歌曲信息，不放占位图
            val songTitle = detail?.displayName ?: "未命名稿件"
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
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
