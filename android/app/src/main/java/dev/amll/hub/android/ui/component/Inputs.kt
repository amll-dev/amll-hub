package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Close
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/** 分段切换：登录方式、验证码载体这类二选一 */
@Composable
fun SegmentedTabs(
    labels: List<String>,
    selectedIndex: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        labels.forEachIndexed { index, label ->
            val active = index == selectedIndex
            SegmentedButton(
                selected = active,
                onClick = { onSelect(index) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = labels.size),
                colors = SegmentedButtonDefaults.colors(
                    activeContainerColor = Amll.colors.surface,
                    activeContentColor = Amll.colors.ink,
                    activeBorderColor = Amll.colors.border,
                    inactiveContainerColor = Amll.colors.surface2,
                    inactiveContentColor = Amll.colors.ink3,
                    inactiveBorderColor = Color.Transparent,
                ),
                // 不加 M3 默认的对勾：这里的状态只用底色区分
                icon = {},
                label = {
                    Text(
                        label,
                        style = Font.caption.copy(
                            fontWeight = if (active) FontWeight.SemiBold else FontWeight.Normal,
                        ),
                    )
                },
            )
        }
    }
}

/** 圆角输入框：登录页与表单统一用这套，底层是 M3 OutlinedTextField */
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
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            textStyle = Font.body,
            placeholder = {
                Text(placeholder, style = Font.bodySmall, color = Amll.colors.ink3)
            },
            singleLine = true,
            shape = RoundedCornerShape(Radius.chip),
            visualTransformation = visualTransformation,
            trailingIcon = trailing,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onImeAction?.invoke() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedContainerColor = Amll.colors.surface2,
                unfocusedContainerColor = Amll.colors.surface2,
                focusedTextColor = Amll.colors.ink,
                unfocusedTextColor = Amll.colors.ink,
                cursorColor = Amll.colors.primary,
                focusedBorderColor = Amll.colors.primary,
                unfocusedBorderColor = Color.Transparent,
                focusedPlaceholderColor = Amll.colors.ink3,
                unfocusedPlaceholderColor = Amll.colors.ink3,
            ),
        )
    }
}

/** 胶囊搜索框：搜索页专用样式，图标 + 占位符 + 清除按钮 */
@Composable
fun SearchPillField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "搜索",
    focusRequester: FocusRequester? = null,
    onSearch: (() -> Unit)? = null,
    onClear: () -> Unit = {},
) {
    Row(
        modifier
            .height(42.dp)
            .clip(RoundedCornerShape(Radius.chip))
            .background(Amll.colors.surface2)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Search, null, tint = Amll.colors.ink3, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
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
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { onSearch?.invoke() }),
                modifier = Modifier
                    .fillMaxWidth()
                    .then(if (focusRequester != null) Modifier.focusRequester(focusRequester) else Modifier),
            )
        }
        if (value.isNotEmpty()) {
            Icon(
                Icons.Rounded.Close,
                "清空",
                tint = Amll.colors.ink3,
                modifier = Modifier.size(16.dp).clickable(onClick = onClear),
            )
        }
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
