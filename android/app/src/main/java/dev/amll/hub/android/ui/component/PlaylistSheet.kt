package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.QueueMusic
import androidx.compose.material3.BottomSheetDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.playback.PlayerController
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import dev.amll.hub.android.ui.theme.SheetShape

/**
 * 播放列表底部弹层：展示当前队列，可切歌、移除、清空。
 *
 * 队列数据与播放状态都来自 [PlayerController.State]；点击条目只切歌并关闭弹层，
 * 不导航离开当前页面。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlaylistSheet(
    state: PlayerController.State,
    onDismiss: () -> Unit,
    onPlayAt: (Int) -> Unit,
    onRemove: (Int) -> Unit,
    onClear: () -> Unit,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val listState = rememberLazyListState()
    val currentIndex = state.currentIndex

    // 打开时与切歌后都把当前曲目滚到可见位置（留两行上下文）
    LaunchedEffect(currentIndex, state.queue.size) {
        if (currentIndex in state.queue.indices) {
            listState.animateScrollToItem((currentIndex - 2).coerceAtLeast(0))
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = SheetShape,
        containerColor = Amll.colors.surface,
        dragHandle = { BottomSheetDefaults.DragHandle(color = Amll.colors.border) },
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 24.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("播放列表", style = Font.sheetTitle, color = Amll.colors.ink)
                Spacer(Modifier.size(8.dp))
                Text(
                    "${state.queue.size} 首",
                    style = Font.caption,
                    color = Amll.colors.ink3,
                )
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onClear, enabled = state.queue.isNotEmpty()) {
                    Icon(
                        imageVector = Icons.Rounded.DeleteSweep,
                        contentDescription = "清空播放列表",
                        tint = if (state.queue.isNotEmpty()) {
                            Amll.colors.ink3
                        } else {
                            Amll.colors.ink3.copy(alpha = 0.35f)
                        },
                        modifier = Modifier.size(20.dp),
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(
                        imageVector = Icons.Rounded.Close,
                        contentDescription = "关闭",
                        tint = Amll.colors.ink3,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            if (state.queue.isEmpty()) {
                EmptyState(
                    icon = Icons.Rounded.QueueMusic,
                    title = "播放列表为空",
                    description = "在网易云解析页选一首歌，或点「播放全部」",
                )
            } else {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxWidth().fillMaxHeight(0.62f),
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                ) {
                    itemsIndexed(state.queue) { index, item ->
                        val selected = index == currentIndex
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(Radius.chip))
                                .background(if (selected) Amll.colors.primarySoft else Color.Transparent)
                                .clickable { onPlayAt(index) }
                                .padding(horizontal = 8.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            // 固定宽度占位，非当前曲目也保持封面左对齐
                            Box(Modifier.size(16.dp), contentAlignment = Alignment.Center) {
                                if (selected) {
                                    Icon(
                                        imageVector = Icons.Rounded.PlayArrow,
                                        contentDescription = null,
                                        tint = Amll.colors.primary,
                                        modifier = Modifier.size(16.dp),
                                    )
                                }
                            }
                            CoverImage(item.coverUrl, item.name, 42.dp)
                            Column(
                                Modifier.weight(1f),
                                verticalArrangement = Arrangement.spacedBy(2.dp),
                            ) {
                                Text(
                                    item.name.ifBlank { "未知歌曲" },
                                    style = Font.bodyMedium,
                                    color = if (selected) Amll.colors.primary else Amll.colors.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    item.artists.ifBlank { "未知歌手" },
                                    style = Font.micro,
                                    color = Amll.colors.ink3,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                            // IconButton 自己消费点击，不会触发行点击
                            IconButton(onClick = { onRemove(index) }) {
                                Icon(
                                    imageVector = Icons.Rounded.Close,
                                    contentDescription = "从播放列表移除",
                                    tint = Amll.colors.ink3,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
