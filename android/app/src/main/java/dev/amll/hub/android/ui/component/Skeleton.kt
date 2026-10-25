package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Radius
import dev.amll.hub.android.ui.theme.Space

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
