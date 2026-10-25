package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.EmptyState
import dev.amll.hub.android.ui.component.SkeletonList
import dev.amll.hub.android.ui.component.SongRow
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/**
 * 最新收录全量列表：首页/发现只放前几条，这里展示接口返回的全部。
 */
@Composable
fun LatestSongsScreen(vm: HomeViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { if (vm.home.value.latest.isEmpty()) vm.loadHome() }
    val ui by vm.home.collectAsStateWithLifecycle()

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        AmllTopBar("最新收录", onBack = nav.back) {
            Text(
                if (ui.latest.isEmpty()) "" else "共 ${ui.latest.size} 首",
                style = Font.caption,
                color = Amll.colors.ink3,
            )
        }

        when {
            ui.loading -> Column(Modifier.fillMaxWidth()) { SkeletonList(6) }
            ui.latest.isEmpty() -> EmptyState(
                icon = Icons.Outlined.Inbox,
                title = "暂无最新收录",
                description = "等第一首歌词通过审核后会出现在这里",
            )
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(top = 4.dp, bottom = 24.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(ui.latest) { item ->
                    SongRow(
                        title = item.title,
                        subtitle = item.artist,
                        coverUrl = item.coverUrl.ifBlank { null },
                        onClick = { nav.openLyric(item.ncmId, item.title, item.artist, item.coverUrl) },
                    )
                }
            }
        }
    }
}
