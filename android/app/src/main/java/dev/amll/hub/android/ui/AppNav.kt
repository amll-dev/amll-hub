package dev.amll.hub.android.ui

import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import dev.amll.hub.android.nav.DailyRoute
import dev.amll.hub.android.nav.LatestRoute
import dev.amll.hub.android.nav.LyricRoute
import dev.amll.hub.android.nav.NcmRoute
import dev.amll.hub.android.nav.ProfileEditRoute
import dev.amll.hub.android.nav.RankingRoute
import dev.amll.hub.android.nav.ReviewRoute
import dev.amll.hub.android.nav.ScanRoute
import dev.amll.hub.android.nav.SearchRoute
import dev.amll.hub.android.nav.SubmissionRoute
import dev.amll.hub.android.nav.TabRoutes

/**
 * 页面跳转集合：统一封装 [NavController]，路由用类型安全对象。
 *
 * 成员保持「函数值」形式，这样调用方既能 `nav.back()` 也能 `onBack = nav.back`。
 */
class AppNav(
    private val navController: NavController,
    /** 打开歌词前的副作用：解析音源 + 拉歌词，由 NavGraph 注入 */
    onOpenTrack: (
        songId: String,
        title: String,
        artist: String,
        cover: String?,
        rawLyricFile: String?,
    ) -> Unit = { _, _, _, _, _ -> },
    /** 从播放条进歌词页：补一次当前曲目的歌词 */
    onPlayerLyric: () -> Unit = {},
) {

    val back: () -> Unit = { navController.popBackStack() }

    val openRanking: () -> Unit = { navController.navigate(RankingRoute) }
    val openDaily: () -> Unit = { navController.navigate(DailyRoute) }
    val openSearch: () -> Unit = { navController.navigate(SearchRoute) }
    val openLatest: () -> Unit = { navController.navigate(LatestRoute) }

    /** 网易云解析：粘 ID / 链接 或 关键词搜索后直接播放 */
    val openNcm: () -> Unit = { navController.navigate(NcmRoute) }
    val openScan: () -> Unit = { navController.navigate(ScanRoute()) }

    val openLyric: (songId: String, title: String, artist: String, cover: String?) -> Unit =
        { songId, title, artist, cover ->
            onOpenTrack(songId, title, artist, cover, null)
            navController.navigate(LyricRoute)
        }

    /** 搜索命中的歌词：多带一个词库 TTML 文件名，优先于 ncm-lyrics 目录 */
    val openLyricFile: (
        songId: String,
        title: String,
        artist: String,
        cover: String?,
        rawLyricFile: String?,
    ) -> Unit = { songId, title, artist, cover, rawLyricFile ->
        onOpenTrack(songId, title, artist, cover, rawLyricFile)
        navController.navigate(LyricRoute)
    }

    /** 直接打开当前播放曲目的歌词页（迷你播放器用） */
    val openPlayer: () -> Unit = {
        onPlayerLyric()
        navController.navigate(LyricRoute)
    }

    val openSubmission: (Long) -> Unit = { id -> navController.navigate(SubmissionRoute(id)) }
    val openProfileEdit: () -> Unit = { navController.navigate(ProfileEditRoute) }
    val openReview: () -> Unit = { navController.navigate(ReviewRoute) }

    val switchTab: (Int) -> Unit = { index ->
        TabRoutes.getOrNull(index)?.let { route ->
            navController.navigate(route) {
                // 每个 Tab 各自保留返回栈与状态，切回来不重建
                popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
                restoreState = true
            }
        }
    }
}
