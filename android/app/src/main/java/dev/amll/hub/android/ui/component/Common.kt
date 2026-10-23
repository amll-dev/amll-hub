package dev.amll.hub.android.ui.component

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.CardShape
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.PillOuterShape
import dev.amll.hub.android.ui.theme.Radius
import dev.amll.hub.android.ui.theme.Size
import dev.amll.hub.android.ui.theme.Space

/** 页面顶部栏 */
@Composable
fun AmllTopBar(
    title: String,
    modifier: Modifier = Modifier,
    onBack: (() -> Unit)? = null,
    titleStyle: androidx.compose.ui.text.TextStyle = Font.navTitle,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Row(
        modifier = modifier.fillMaxWidth().height(Size.topBar),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (onBack != null) {
            Icon(
                imageVector = Icons.Rounded.ChevronLeft,
                contentDescription = "返回",
                tint = Amll.colors.ink,
                modifier = Modifier
                    .size(18.dp)
                    .clickable(onClick = onBack),
            )
            Spacer(Modifier.width(12.dp))
        }
        Text(
            text = title,
            style = titleStyle,
            color = Amll.colors.ink,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        trailing()
    }
}

/** 大标题页头：24sp Bold + 可选副标题 */
@Composable
fun PageHeader(
    title: String,
    subtitle: String? = null,
    modifier: Modifier = Modifier,
    trailing: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(title, style = Font.pageTitle, color = Amll.colors.ink, modifier = Modifier.weight(1f))
            trailing()
        }
        if (subtitle != null) {
            Spacer(Modifier.height(6.dp))
            Text(subtitle, style = Font.bodySmall, color = Amll.colors.ink3)
        }
    }
}

data class TabItem(val label: String, val icon: ImageVector)

/** 底部胶囊导航：62dp 胶囊 + 会「滑过去」的选中块 */
@Composable
fun PillTabBar(
    items: List<TabItem>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    val target = selectedIndex.coerceIn(0, (items.size - 1).coerceAtLeast(0))
    // 选中块按索引做位移动画，切 Tab 时是滑过去而不是直接跳
    val progress by animateFloatAsState(
        targetValue = target.toFloat(),
        animationSpec = spring(dampingRatio = 0.86f, stiffness = Spring.StiffnessMediumLow),
        label = "tabIndicator",
    )

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .navigationBarsPadding()
            // 左右 12dp：每个 Tab 的槽位更宽，圆形指示块才铺得开
            .padding(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 18.dp),
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(Size.tabPill)
                // 先裁圆角再叠毛玻璃，否则模糊会画到胶囊外面
                .clip(PillOuterShape)
                .then(modifier)
                .border(0.5.dp, Amll.colors.border.copy(alpha = 0.55f), PillOuterShape)
                .padding(4.dp),
        ) {
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val slot = maxWidth / items.size.toFloat()
                // 指示块是圆的：直径取「槽位宽」与「胶囊内高」的较小值，水平居中在槽位里
                val diameter = minOf(slot, maxHeight)
                Box(
                    Modifier
                        .offset(x = slot * progress + (slot - diameter) / 2)
                        .size(diameter)
                        .clip(CircleShape)
                        .background(Amll.colors.primary),
                )
            }
            Row(Modifier.fillMaxSize()) {
                items.forEachIndexed { index, item ->
                    val active = index == target
                    val tint by animateColorAsState(
                        targetValue = if (active) Amll.colors.onPrimary else Amll.colors.ink3,
                        animationSpec = tween(180),
                        label = "tabTint$index",
                    )
                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .fillMaxHeight()
                            .clickable { onSelect(index) },
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

/** 分段切换：登录方式、验证码载体这类二选一 */
@Composable
fun SegmentedTabs(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(38.dp)
            .clip(RoundedCornerShape(Radius.chip))
            .background(Amll.colors.surface2)
            .padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        labels.forEachIndexed { index, label ->
            val active = index == selectedIndex
            Box(
                Modifier
                    .weight(1f)
                    .fillMaxHeight()
                    .clip(RoundedCornerShape(Radius.field))
                    .background(if (active) Amll.colors.surface else Color.Transparent)
                    .then(
                        if (active) Modifier.border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.field))
                        else Modifier,
                    )
                    .clickable { onSelect(index) },
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    style = Font.caption.copy(fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal),
                    color = if (active) Amll.colors.ink else Amll.colors.ink3,
                )
            }
        }
    }
}

/** 圆角输入框：登录页与表单统一用这套，不再混用 Material3 OutlinedTextField */
@Composable
fun AmllTextField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    label: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Next,
    visualTransformation: VisualTransformation = VisualTransformation.None,
    onImeAction: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (label != null) {
            Text(label, style = Font.micro, color = Amll.colors.ink3)
        }
        Row(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .clip(RoundedCornerShape(Radius.chip))
                .background(Amll.colors.surface2)
                .padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.weight(1f)) {
                if (value.isEmpty()) {
                    Text(placeholder, style = Font.bodySmall, color = Amll.colors.ink3)
                }
                BasicTextField(
                    value = value,
                    onValueChange = onValueChange,
                    singleLine = true,
                    textStyle = TextStyle(fontSize = 13.5.sp, color = Amll.colors.ink),
                    cursorBrush = SolidColor(Amll.colors.primary),
                    visualTransformation = visualTransformation,
                    keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
                    keyboardActions = KeyboardActions(onAny = { onImeAction?.invoke() }),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            trailing?.invoke()
        }
    }
}

/** 白底描边卡片 */
@Composable
fun AmllCard(
    modifier: Modifier = Modifier,
    padding: Dp = Space.xxl,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(CardShape)
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, CardShape)
            .padding(padding),
        content = content,
    )
}

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Row(
        modifier.fillMaxWidth().height(22.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(title, style = Font.section.copy(fontSize = 14.sp), color = Amll.colors.ink)
        if (action != null) {
            Text(
                action,
                style = Font.caption,
                color = Amll.colors.ink3,
                modifier = Modifier.clickable(enabled = onAction != null) { onAction?.invoke() },
            )
        }
    }
}

/** 封面：有 URL 走 Coil，没有则按标题生成稳定渐变，避免一排灰块 */
@Composable
fun CoverImage(
    url: String?,
    seed: String,
    size: Dp,
    modifier: Modifier = Modifier,
    radius: Dp = Radius.field,
) {
    val shape = RoundedCornerShape(radius)
    Box(modifier.size(size).clip(shape).background(coverBrush(seed))) {
        if (!url.isNullOrBlank()) {
            AsyncImage(
                model = url,
                contentDescription = seed,
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

private val coverPalettes = listOf(
    listOf(Color(0xFF4A5BD6), Color(0xFF8C3AB8)),
    listOf(Color(0xFFF2A85C), Color(0xFFC74A3C)),
    listOf(Color(0xFF3DB38C), Color(0xFF24618C)),
    listOf(Color(0xFF8C50C7), Color(0xFF402868)),
    listOf(Color(0xFF4A9BD6), Color(0xFF2E3B8C)),
    listOf(Color(0xFFDB7080), Color(0xFF6B2947)),
    listOf(Color(0xFF8C9AA8), Color(0xFF2E3A44)),
    listOf(Color(0xFFEBBD6B), Color(0xFFA85C38)),
)

fun coverBrush(seed: String): Brush {
    val index = (seed.hashCode().let { if (it == Int.MIN_VALUE) 0 else kotlin.math.abs(it) }) % coverPalettes.size
    val colors = coverPalettes[index]
    return Brush.linearGradient(colors)
}

enum class ChipTone { PRIMARY, SUCCESS, WARNING, INFO, NEUTRAL }

@Composable
fun StatusChip(text: String, tone: ChipTone = ChipTone.NEUTRAL, modifier: Modifier = Modifier) {
    val (fg, bg) = when (tone) {
        ChipTone.PRIMARY -> Amll.colors.primary to Amll.colors.primarySoft
        ChipTone.SUCCESS -> Amll.colors.success to Amll.colors.successSoft
        ChipTone.WARNING -> Amll.colors.warning to Amll.colors.warningSoft
        ChipTone.INFO -> Amll.colors.info to Amll.colors.infoSoft
        ChipTone.NEUTRAL -> Amll.colors.ink3 to Amll.colors.surface2
    }
    Box(
        modifier
            .clip(ChipShape)
            .background(bg)
            .padding(horizontal = 9.dp, vertical = 4.dp),
    ) {
        Text(text, style = Font.micro.copy(fontWeight = FontWeight.Medium), color = fg)
    }
}

/** 通用列表行：封面 + 两行文字 + 尾部 */
@Composable
fun SongRow(
    title: String,
    subtitle: String,
    modifier: Modifier = Modifier,
    coverUrl: String? = null,
    coverSize: Dp = Size.coverRow,
    leading: (@Composable () -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            // 上下 4dp：封面本身 48dp 已经把行撑开，再留 8dp 会显得松散
            .padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.l),
    ) {
        leading?.invoke()
        CoverImage(coverUrl, title, coverSize)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, style = Font.bodyMedium, color = Amll.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(subtitle, style = Font.caption, color = Amll.colors.ink3, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        // 右侧统一收一个播放按钮，行尾不会空掉（曲目接口没有时长字段）
        if (trailing != null) trailing.invoke() else if (onClick != null) PlayCircleButton()
    }
}

/** 列表行尾的圆形播放按钮，纯装饰，点击由整行处理 */
@Composable
fun PlayCircleButton(
    modifier: Modifier = Modifier,
    size: Dp = 30.dp,
) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Amll.colors.primarySoft),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = Icons.Rounded.PlayArrow,
            contentDescription = null,
            tint = Amll.colors.primary,
            // PlayArrow 字形自带约 1/4 空白，按比例放大才和圆匹配
            modifier = Modifier.size(size * 0.62f).offset(x = 0.5.dp),
        )
    }
}

@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(RoundedCornerShape(Radius.chip))
            .background(if (enabled) Amll.colors.primary else Amll.colors.surface2)
            .clickable(enabled = enabled, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text,
            style = Font.body.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
            color = if (enabled) Amll.colors.onPrimary else Amll.colors.ink3,
        )
    }
}

@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(50.dp)
            .clip(RoundedCornerShape(Radius.chip))
            .background(Amll.colors.surface)
            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.chip))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = Font.body.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink)
    }
}

/** 空态：图标 + 标题 + 说明 + 可选按钮 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    description: String,
    modifier: Modifier = Modifier,
    actionText: String? = null,
    onAction: (() -> Unit)? = null,
) {
    Column(
        modifier.fillMaxWidth().padding(vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier
                .size(64.dp)
                .clip(RoundedCornerShape(20.dp))
                .background(Amll.colors.surface2),
            contentAlignment = Alignment.Center,
        ) {
            Icon(icon, null, tint = Amll.colors.ink3, modifier = Modifier.size(28.dp))
        }
        Text(title, style = Font.section.copy(fontSize = 15.sp), color = Amll.colors.ink)
        Text(description, style = Font.bodySmall, color = Amll.colors.ink3)
        if (actionText != null && onAction != null) {
            Box(
                Modifier
                    .height(38.dp)
                    .clip(RoundedCornerShape(19.dp))
                    .background(Amll.colors.surface)
                    .border(1.dp, Amll.colors.border, RoundedCornerShape(19.dp))
                    .clickable(onClick = onAction)
                    .padding(horizontal = 18.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(actionText, style = Font.caption.copy(fontWeight = FontWeight.Medium), color = Amll.colors.ink)
            }
        }
    }
}

/** 骨架行 */
@Composable
fun SkeletonRow(modifier: Modifier = Modifier) {
    Row(
        modifier.fillMaxWidth().padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Space.l),
    ) {
        Box(Modifier.size(48.dp).clip(RoundedCornerShape(Radius.field)).background(Amll.colors.surface2))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.fillMaxWidth(0.62f).height(11.dp).clip(RoundedCornerShape(5.dp)).background(Amll.colors.surface2))
            Box(Modifier.fillMaxWidth(0.36f).height(9.dp).clip(RoundedCornerShape(4.dp)).background(Amll.colors.surface2))
        }
    }
}

@Composable
fun SkeletonList(count: Int = 4, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Space.s)) {
        repeat(count) { SkeletonRow() }
    }
}

/** 表单行：左侧标签 + 右侧值 */
@Composable
fun FieldRow(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueColor: Color? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(44.dp)
            .clip(RoundedCornerShape(Radius.field))
            .background(Amll.colors.surface2)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = Font.bodySmall, color = Amll.colors.ink3)
        Text(value, style = Font.bodyMedium, color = valueColor ?: Amll.colors.ink, maxLines = 1)
    }
}

/** 卡片内的一行：标题 + 右侧箭头 */
@Composable
fun NavRow(
    label: String,
    modifier: Modifier = Modifier,
    value: String? = null,
    onClick: (() -> Unit)? = null,
) {
    Row(
        modifier
            .fillMaxWidth()
            .height(46.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = Font.body, color = Amll.colors.ink, modifier = Modifier.weight(1f))
        if (value != null) {
            Text(value, style = Font.caption, color = Amll.colors.ink3)
            Spacer(Modifier.width(6.dp))
        }
        Icon(
            Icons.Rounded.ChevronRight,
            null,
            tint = Amll.colors.ink3,
            modifier = Modifier.size(16.dp),
        )
    }
}
