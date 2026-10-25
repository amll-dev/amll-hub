package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.TabScaffold
import dev.amll.hub.android.ui.bottomBarPadding
import dev.amll.hub.android.ui.component.ChipTone
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.PageHeader
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/* ============================ 10 消息 ============================ */

@Composable
fun MessagesScreen(vm: MessagesViewModel, nav: AppNav) {
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
                    1 -> "review"
                    2 -> "submission"
                    3 -> "comment"
                    4 -> "system"
                    else -> null
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
