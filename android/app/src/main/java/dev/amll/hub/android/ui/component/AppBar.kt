package dev.amll.hub.android.ui.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ChevronLeft
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Size

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
