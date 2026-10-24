package dev.amll.hub.android.ui.component

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

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
    Button(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(50.dp),
        enabled = enabled,
        shape = RoundedCornerShape(Radius.chip),
        colors = ButtonDefaults.buttonColors(
            containerColor = Amll.colors.primary,
            contentColor = Amll.colors.onPrimary,
            disabledContainerColor = Amll.colors.surface2,
            disabledContentColor = Amll.colors.ink3,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        Text(
            text,
            style = Font.body.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp),
        )
    }
}

@Composable
fun GhostButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedButton(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().height(50.dp),
        shape = RoundedCornerShape(Radius.chip),
        border = BorderStroke(1.dp, Amll.colors.border),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = Amll.colors.surface,
            contentColor = Amll.colors.ink,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp),
    ) {
        Text(text, style = Font.body.copy(fontWeight = FontWeight.Medium))
    }
}
