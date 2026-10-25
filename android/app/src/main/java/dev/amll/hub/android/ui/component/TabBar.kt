package dev.amll.hub.android.ui.component

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.PillOuterShape
import dev.amll.hub.android.ui.theme.Size
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

data class TabItem(val label: String, val icon: ImageVector)

/**
 * 底部胶囊导航。
 *
 * 选中块可以「拖着走」：按住左右拖，指示块跟手，松手吸附到最近的 Tab。
 */
@Composable
fun PillTabBar(
    items: List<TabItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val target = selectedIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    val scope = rememberCoroutineScope()
    // 用 Animatable 而不是 animateFloatAsState：拖动结束时要先 snap 到手指位置，
    // 再从那里接着弹到目标，animateFloatAsState 做不到中途接管
    val progress = remember { Animatable(target.toFloat()) }
    val springSpec = spring<Float>(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow)
    LaunchedEffect(target) {
        progress.animateTo(target.toFloat(), springSpec)
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            // 左右 12dp：每个 Tab 的槽位更宽，指示块才铺得开
            .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 18.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(Size.tabPill)
                // 投影让底栏在「后面没内容」时也能和页面区分开；
                // 否则毛玻璃糊出来的是纯色，看起来就像没有这一层
                .shadow(elevation = 8.dp, shape = PillOuterShape, clip = false)
                // 先裁圆角再叠毛玻璃，否则模糊会画到胶囊外面
                .clip(PillOuterShape)
                // haze 在源内容静止/不可用时整个跳过绘制（连底色都不画），
                // 这层实心底就是那时的兜底，避免底栏透明
                .background(Amll.colors.surface.copy(alpha = 0.97f))
                .then(modifier)
                .border(0.5.dp, Amll.colors.border.copy(alpha = 0.55f), PillOuterShape)
                .padding(4.dp),
        ) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val slot = maxWidth / items.size.toFloat()
                val slotPx = with(LocalDensity.current) { slot.toPx() }
                // 拖动量按像素累计，渲染时换算成槽位数叠加
                var dragPx by remember(slotPx) { mutableFloatStateOf(0f) }
                val dragSlots = if (slotPx > 0f) dragPx / slotPx else 0f
                val position = (progress.value + dragSlots)
                    .coerceIn(0f, (items.size - 1).toFloat())

                // 选中态是「包住图标+文字」的扁圆角块，左右各留 4dp。
                // 圆角用 50%（= 高度一半），和外壳胶囊是同一档弧度，不会是「内方外圆」
                val indicatorWidth = slot - 8.dp
                Box(
                    Modifier
                        .offset(x = slot * position + 4.dp)
                        .width(indicatorWidth)
                        .fillMaxHeight()
                        .clip(RoundedCornerShape(percent = 50))
                        .background(Amll.colors.primarySoft),
                )

                Row(
                    Modifier
                        .fillMaxSize()
                        .pointerInput(items.size, slotPx) {
                            detectHorizontalDragGestures(
                                onDragStart = { dragPx = 0f },
                                onDragCancel = { dragPx = 0f },
                                onHorizontalDrag = { change, amount ->
                                    change.consume()
                                    dragPx += amount
                                },
                                onDragEnd = {
                                    val delta = if (slotPx > 0f) dragPx / slotPx else 0f
                                    val landed = (target + delta)
                                        .coerceIn(0f, (items.size - 1).toFloat())
                                    val next = landed.roundToInt()
                                    dragPx = 0f
                                    scope.launch {
                                        // 先落到手指松开的位置，避免弹回原处再出发
                                        progress.snapTo(landed)
                                        if (next != target) {
                                            onSelect(next)
                                        } else {
                                            progress.animateTo(target.toFloat(), springSpec)
                                        }
                                    }
                                },
                            )
                        },
                ) {
                    items.forEachIndexed { index, item ->
                        val active = index == target
                        val tint by animateColorAsState(
                            targetValue = if (active) Amll.colors.primary else Amll.colors.ink3,
                            animationSpec = tween(180),
                            label = "tabTint$index",
                        )
                        Column(
                            modifier = Modifier
                                .weight(1f)
                                .fillMaxHeight()
                                // 不要正方形水波纹：只响应点击，不画指示
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                ) { onSelect(index) },
                            verticalArrangement = Arrangement.Center,
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            Icon(
                                imageVector = item.icon,
                                contentDescription = item.label,
                                tint = tint,
                                modifier = Modifier.size(18.dp),
                            )
                            Spacer(Modifier.height(3.dp))
                            Text(item.label, style = Font.tabLabel, color = tint)
                        }
                    }
                }
            }
        }
    }
}
