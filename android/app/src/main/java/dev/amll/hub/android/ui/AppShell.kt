package dev.amll.hub.android.ui

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.component.MiniPlayer
import dev.amll.hub.android.ui.component.PillTabBar
import dev.amll.hub.android.ui.screen.AppTabs
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Size
import dev.chrisbanes.haze.HazeInput
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.blur.HazeBlurStyle
import dev.chrisbanes.haze.blur.hazeBlur
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.rememberHazeState

/** 播放条高度：54dp 信息行 + 2dp 进度线 */
private val MiniPlayerHeight = 56.dp

/** 胶囊导航占用的高度（不含系统导航栏）：8dp 上边距 + 胶囊 + 18dp 下边距 */
private val TabBarHeight = 8.dp + Size.tabPill + 18.dp

/**
 * 底部栏在内容区需要额外预留的高度。
 *
 * 底栏是浮在内容之上的，列表要能滚动到最后一个条目，所以各页的滚动容器
 * 用这个值补一个底部内边距；这样中间的内容依然会从底栏后面穿过去，
 * 模糊才有东西可糊。
 */
val LocalBottomBarSpace = compositionLocalOf { 0.dp }

/**
 * App 外壳：内容区 + 常驻底部栏。
 *
 * 底栏放在 NavHost 外面，切页时只有内容滑动，栏本身不动；
 * 进二级页时栏整体淡出（与网页端一致）。
 */
@Composable
fun AppShell(
    vm: AppViewModel,
    nav: AppNav,
    selectedTab: Int,
    tabsVisible: Boolean,
    content: @Composable () -> Unit,
) {
    val player by vm.playerState.collectAsStateWithLifecycle()
    val lyric by vm.lyric.collectAsStateWithLifecycle()
    val navBarBottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()

    val hasTrack = player.track != null
    val bottomSpace = if (tabsVisible) {
        TabBarHeight + navBarBottom + if (hasTrack) MiniPlayerHeight else 0.dp
    } else {
        0.dp
    }

    val hazeState: HazeState = rememberHazeState()
    // 底色用卡片色（网页端顶栏是 bg-card/80，不是页面底色）。
    // 底栏自己还有一层 0.97 的实心底兜底（haze 在源内容静止时会跳过绘制），
    // 所以这里的透明度可以低一些，让模糊在滚动时更明显
    val blurSupported = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val tint = Amll.colors.surface.copy(alpha = if (blurSupported) 0.72f else 0.98f)
    val blurStyle = remember(tint) {
        HazeBlurStyle {
            blurRadius(36.dp)
            backgroundColor(tint)
        }
    }

    CompositionLocalProvider(LocalBottomBarSpace provides bottomSpace) {
        Box(Modifier.fillMaxSize().background(Amll.colors.canvas)) {
            // 内容铺满整屏（含底栏区域），haze 从这里采样
            Box(Modifier.fillMaxSize().hazeSource(state = hazeState)) {
                content()
            }

            AnimatedVisibility(
                visible = tabsVisible,
                modifier = Modifier.align(Alignment.BottomCenter),
                enter = fadeIn(tween(160)),
                exit = fadeOut(tween(120)),
            ) {
                Column(Modifier.fillMaxWidth()) {
                    MiniPlayer(
                        state = player,
                        loading = lyric.loading,
                        error = player.error,
                        onOpen = nav.openPlayer,
                        onToggle = vm::togglePlay,
                        modifier = Modifier.hazeBlur(
                            input = HazeInput.Sources(state = hazeState),
                            style = blurStyle,
                        ),
                    )
                    PillTabBar(
                        items = AppTabs,
                        selectedIndex = selectedTab.coerceAtLeast(0),
                        onSelect = nav.switchTab,
                        modifier = Modifier.hazeBlur(
                            input = HazeInput.Sources(state = hazeState),
                            style = blurStyle,
                        ),
                    )
                }
            }
        }
    }
}

/**
 * Tab 页的公共容器：只负责状态栏避让。
 *
 * 底部内边距由各页通过 LocalBottomBarSpace 补给滚动容器，
 * 这里不能直接 padding 掉，否则内容就不会从底栏后面滑过了。
 */
@Composable
fun TabScaffold(content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding(),
        content = content,
    )
}

/** Tab 页滚动容器的底部内边距：栏高 + 页面自身留白 */
@Composable
fun bottomBarPadding(extra: Dp = 18.dp): Dp = LocalBottomBarSpace.current + extra
