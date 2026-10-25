package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.playback.NcmQuality
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font

/** 网易云音质选择：胶囊按钮 + 下拉菜单，所有入口共用页面音质 */
@Composable
fun QualityPicker(
    selected: NcmQuality,
    onSelect: (NcmQuality) -> Unit,
    modifier: Modifier = Modifier,
) {
    var expanded by remember { mutableStateOf(false) }

    Box(modifier) {
        Row(
            Modifier
                .height(28.dp)
                .clip(ChipShape)
                .background(Amll.colors.surface2)
                .clickable { expanded = true }
                .padding(horizontal = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(3.dp),
        ) {
            Text(
                "音质 · ${selected.label}",
                style = Font.micro,
                color = Amll.colors.ink2,
                maxLines = 1,
            )
            Icon(
                Icons.Rounded.ExpandMore,
                null,
                tint = Amll.colors.ink3,
                modifier = Modifier.size(14.dp),
            )
        }

        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            NcmQuality.ORDER.forEach { quality ->
                val active = quality == selected
                DropdownMenuItem(
                    text = {
                        Text(
                            quality.label,
                            style = Font.caption,
                            color = if (active) Amll.colors.primary else Amll.colors.ink,
                        )
                    },
                    onClick = {
                        expanded = false
                        onSelect(quality)
                    },
                    trailingIcon = if (active) {
                        {
                            Icon(
                                Icons.Rounded.Check,
                                null,
                                tint = Amll.colors.primary,
                                modifier = Modifier.size(16.dp),
                            )
                        }
                    } else {
                        null
                    },
                )
            }
        }
    }
}
