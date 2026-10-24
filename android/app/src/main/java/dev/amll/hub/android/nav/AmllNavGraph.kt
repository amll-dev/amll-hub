package dev.amll.hub.android.nav

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import dev.amll.hub.android.R
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppShell
import dev.amll.hub.android.ui.screen.CreatorCenterScreen
import dev.amll.hub.android.ui.screen.CreatorViewModel
import dev.amll.hub.android.ui.screen.DailyScreen
import dev.amll.hub.android.ui.screen.DailySubmitScreen
import dev.amll.hub.android.ui.screen.DailyViewModel
import dev.amll.hub.android.ui.screen.DiscoverScreen
import dev.amll.hub.android.ui.screen.HomeScreen
import dev.amll.hub.android.ui.screen.HomeViewModel
import dev.amll.hub.android.ui.screen.LatestSongsScreen
import dev.amll.hub.android.ui.screen.LoginScreen
import dev.amll.hub.android.ui.screen.LyricScreen
import dev.amll.hub.android.ui.screen.LyricSubmitScreen
import dev.amll.hub.android.ui.screen.LyricViewModel
import dev.amll.hub.android.ui.screen.MessagesScreen
import dev.amll.hub.android.ui.screen.MessagesViewModel
import dev.amll.hub.android.ui.screen.NcmParseScreen
import dev.amll.hub.android.ui.screen.PlaybackViewModel
import dev.amll.hub.android.ui.screen.ProfileEditScreen
import dev.amll.hub.android.ui.screen.ProfileScreen
import dev.amll.hub.android.ui.screen.ProfileViewModel
import dev.amll.hub.android.ui.screen.RankingScreen
import dev.amll.hub.android.ui.screen.RankingViewModel
import dev.amll.hub.android.ui.screen.ReviewQueueScreen
import dev.amll.hub.android.ui.screen.ScanScreen
import dev.amll.hub.android.ui.screen.SearchScreen
import dev.amll.hub.android.ui.screen.SearchViewModel
import dev.amll.hub.android.ui.screen.SubmissionDetailScreen
import dev.amll.hub.android.ui.session.SessionState
import dev.amll.hub.android.ui.session.SessionViewModel
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/** Tab 在底栏中的下标；非 Tab 页面返回 null，用于判断左右滑动方向 */
private fun NavBackStackEntry.tabIndex(): Int? =
    TabRouteNames.indexOf(destination.route.orEmpty()).takeIf { it >= 0 }

/** 目标页在右（或无法判断）时向前；否则向后 */
private fun AnimatedContentTransitionScope<NavBackStackEntry>.forward(): Boolean {
    val from = initialState.tabIndex()
    val to = targetState.tabIndex()
    return from == null || to == null || to >= from
}

/** 是不是歌词页（它自己带纵向转场，周围页面不应该再横向滑动） */
private fun NavBackStackEntry.isLyricRoute(): Boolean =
    destination.route == LyricRouteName

/**
 * 顶层导航：登录态决定进 App 还是登录页，登录后是 5 Tab + 二级页。
 * 转场统一为横向滑动：推进从右滑入，返回从左侧退回；Tab 之间按目标下标决定方向。
 */
@Composable
fun AmllNavGraph(
    pendingTicket: String? = null,
    onTicketConsumed: () -> Unit = {},
    sessionViewModel: SessionViewModel = hiltViewModel(),
) {
    val session by sessionViewModel.state.collectAsStateWithLifecycle()

    when (session) {
        SessionState.Loading -> SplashScreen()

        is SessionState.LoggedIn -> LoggedInNav(
            pendingTicket = pendingTicket,
            onTicketConsumed = onTicketConsumed,
        )

        SessionState.LoggedOut -> LoginScreen(
            onLoggedIn = { sessionViewModel.onLoggedIn(it) },
        )
    }
}

@Composable
private fun LoggedInNav(
    pendingTicket: String?,
    onTicketConsumed: () -> Unit,
) {
    val navController = rememberNavController()

    // 各 feature ViewModel 挂在 Activity 作用域：切 Tab 不重复请求，
    // 首页/我的共用同一份 profile，创作中心三个页面共用同一份稿件列表
    val homeVm: HomeViewModel = hiltViewModel()
    val rankingVm: RankingViewModel = hiltViewModel()
    val dailyVm: DailyViewModel = hiltViewModel()
    val messagesVm: MessagesViewModel = hiltViewModel()
    val creatorVm: CreatorViewModel = hiltViewModel()
    val searchVm: SearchViewModel = hiltViewModel()
    val profileVm: ProfileViewModel = hiltViewModel()
    val lyricVm: LyricViewModel = hiltViewModel()
    val playbackVm: PlaybackViewModel = hiltViewModel()

    val nav = remember(navController, lyricVm) {
        AppNav(
            navController = navController,
            onOpenTrack = { songId, title, artist, cover, rawLyricFile ->
                lyricVm.openTrack(songId, title, artist, cover, rawLyricFile)
            },
            onPlayerLyric = { lyricVm.ensurePlayerLyric() },
        )
    }

    LaunchedEffect(pendingTicket) {
        val ticket = pendingTicket?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        onTicketConsumed()
        navController.navigate(ScanRoute(ticket))
    }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val selectedTab = TabRouteNames.indexOf(currentRoute.orEmpty())

    // 底栏挂在外壳上：切页时只有内容滑动，栏本身不动
    AppShell(
        playerVm = playbackVm,
        lyricVm = lyricVm,
        nav = nav,
        selectedTab = selectedTab,
        tabsVisible = selectedTab >= 0,
    ) {
        NavHost(
            navController = navController,
            startDestination = HomeRoute,
            // 歌词页只有纵向转场；它进出的那一侧保持静止，否则会多出一段左移动画
            enterTransition = {
                if (initialState.isLyricRoute()) EnterTransition.None else slideInHorizontal(forward())
            },
            exitTransition = {
                if (targetState.isLyricRoute()) ExitTransition.None else slideOutHorizontal(forward())
            },
            popEnterTransition = {
                if (initialState.isLyricRoute()) EnterTransition.None else popEnterHorizontal()
            },
            popExitTransition = {
                if (targetState.isLyricRoute()) ExitTransition.None else popExitHorizontal()
            },
        ) {
            composable<HomeRoute> { HomeScreen(homeVm, profileVm, nav) }
            composable<DiscoverRoute> { DiscoverScreen(homeVm, nav) }
            composable<CreatorRoute> { CreatorCenterScreen(creatorVm, nav) }
            composable<MessagesRoute> { MessagesScreen(messagesVm, nav) }
            composable<ProfileRoute> { ProfileScreen(profileVm, nav) }

            composable<RankingRoute> { RankingScreen(rankingVm, nav) }
            composable<DailyRoute> { DailyScreen(dailyVm, nav) }
            // 歌词页从下往上滑入，退出时滑回底部（对齐网页端的 translate-y 动画）
            composable<LyricRoute>(
                enterTransition = {
                    slideInVertically(animationSpec = tween(340)) { height -> height }
                },
                popExitTransition = {
                    slideOutVertically(animationSpec = tween(300)) { height -> height }
                },
            ) {
                LyricScreen(lyricVm, playbackVm, nav)
            }
            composable<SearchRoute> { SearchScreen(searchVm, nav) }
            composable<LatestRoute> { LatestSongsScreen(homeVm, nav) }
            composable<NcmRoute> { NcmParseScreen(nav) }
            composable<SubmissionRoute> { entry ->
                SubmissionDetailScreen(entry.toRoute<SubmissionRoute>().id, creatorVm, nav)
            }
            composable<ProfileEditRoute> { ProfileEditScreen(profileVm, nav) }
            composable<ReviewRoute> { ReviewQueueScreen(creatorVm, nav) }
            composable<LyricSubmitRoute> { LyricSubmitScreen(nav) }
            composable<DailySubmitRoute> { DailySubmitScreen(nav, dailyVm) }

            composable<ScanRoute> { entry ->
                ScanScreen(
                    initialTicket = entry.toRoute<ScanRoute>().ticket,
                    onBack = { navController.popBackStack() },
                    onDone = { navController.popBackStack() },
                )
            }
        }
    }
}

/** 17 启动页：图标 + 字标 + 标语 */
@Composable
private fun SplashScreen() {
    Box(
        Modifier.fillMaxSize().background(Amll.colors.canvas),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Image(
                painter = painterResource(R.drawable.ic_brand),
                contentDescription = null,
                modifier = Modifier.size(96.dp),
            )
            Text("AMLL Hub", style = Font.pageTitle.copy(fontSize = 26.sp), color = Amll.colors.ink)
            Text("让每一句歌词，都跟着唱出来", style = Font.caption, color = Amll.colors.ink3)
        }
        Text(
            "逐字歌词 · 社区共建",
            style = Font.micro,
            color = Amll.colors.ink3.copy(alpha = 0.7f),
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 34.dp),
        )
    }
}
