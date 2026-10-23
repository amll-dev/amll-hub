package dev.amll.hub.android.nav

import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.AppShell
import dev.amll.hub.android.ui.AppViewModel
import dev.amll.hub.android.ui.screen.CreatorCenterScreen
import dev.amll.hub.android.ui.screen.DailyScreen
import dev.amll.hub.android.ui.screen.DiscoverScreen
import dev.amll.hub.android.ui.screen.HomeScreen
import dev.amll.hub.android.ui.screen.LatestSongsScreen
import dev.amll.hub.android.ui.screen.LoginScreen
import dev.amll.hub.android.ui.screen.LyricScreen
import dev.amll.hub.android.ui.screen.MessagesScreen
import dev.amll.hub.android.ui.screen.NcmParseScreen
import dev.amll.hub.android.ui.screen.ProfileEditScreen
import dev.amll.hub.android.ui.screen.ProfileScreen
import dev.amll.hub.android.ui.screen.RankingScreen
import dev.amll.hub.android.ui.screen.ReviewQueueScreen
import dev.amll.hub.android.ui.screen.ScanScreen
import dev.amll.hub.android.ui.screen.SearchScreen
import dev.amll.hub.android.ui.screen.SubmissionDetailScreen
import dev.amll.hub.android.ui.screen.SubmitScreen
import dev.amll.hub.android.ui.session.SessionState
import dev.amll.hub.android.ui.session.SessionViewModel
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

object Routes {
    const val HOME = "home"
    const val DISCOVER = "discover"
    const val CREATOR = "creator"
    const val MESSAGES = "messages"
    const val PROFILE = "profile"

    const val RANKING = "ranking"
    const val DAILY = "daily"
    const val LYRIC = "lyric"
    const val SEARCH = "search"
    const val LATEST = "latest"
    const val NCM = "ncm"
    const val SUBMIT = "submit"
    const val SUBMISSION = "submission"
    const val PROFILE_EDIT = "profile-edit"
    const val REVIEW = "review"

    const val SCAN = "scan?ticket={ticket}"
    fun scan(ticket: String? = null): String =
        if (ticket.isNullOrBlank()) "scan" else "scan?ticket=$ticket"

    val tabs = listOf(HOME, DISCOVER, CREATOR, MESSAGES, PROFILE)
}

/** Tab 在底栏中的下标；非 Tab 页面返回 null，用于判断左右滑动方向 */
private fun NavBackStackEntry.tabIndex(): Int? =
    Routes.tabs.indexOf(destination.route.orEmpty()).takeIf { it >= 0 }

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
    vm: AppViewModel = hiltViewModel(),
) {
    val navController = rememberNavController()

    LaunchedEffect(pendingTicket) {
        val ticket = pendingTicket?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        onTicketConsumed()
        navController.navigate(Routes.scan(ticket))
    }

    val nav = AppNav(
        back = { navController.popBackStack() },
        openRanking = { navController.navigate(Routes.RANKING) },
        openDaily = { navController.navigate(Routes.DAILY) },
        openSearch = { navController.navigate(Routes.SEARCH) },
        openLatest = { navController.navigate(Routes.LATEST) },
        openNcm = { navController.navigate(Routes.NCM) },
        openScan = { navController.navigate(Routes.scan()) },
        openLyric = { songId, title, artist, cover ->
            vm.openTrack(songId, title, artist, cover)
            navController.navigate(Routes.LYRIC)
        },
        openLyricFile = { songId, title, artist, cover, rawLyricFile ->
            vm.openTrack(songId, title, artist, cover, rawLyricFile)
            navController.navigate(Routes.LYRIC)
        },
        openPlayer = {
            vm.ensurePlayerLyric()
            navController.navigate(Routes.LYRIC)
        },
        openSubmit = { navController.navigate(Routes.SUBMIT) },
        openSubmission = { navController.navigate(Routes.SUBMISSION) },
        openProfileEdit = { navController.navigate(Routes.PROFILE_EDIT) },
        openReview = { navController.navigate(Routes.REVIEW) },
        switchTab = { index ->
            if (index in Routes.tabs.indices) {
                navController.navigate(Routes.tabs[index]) {
                    // 每个 Tab 各自保留返回栈与状态，切回来不重建
                    popUpTo(Routes.HOME) { saveState = true }
                    launchSingleTop = true
                    restoreState = true
                }
            }
        },
    )

    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val selectedTab = Routes.tabs.indexOf(currentRoute.orEmpty())

    // 底栏挂在外壳上：切页时只有内容滑动，栏本身不动
    AppShell(
        vm = vm,
        nav = nav,
        selectedTab = selectedTab,
        tabsVisible = selectedTab >= 0,
    ) {
        NavHost(
            navController = navController,
            startDestination = Routes.HOME,
            enterTransition = {
                val from = initialState.tabIndex()
                val to = targetState.tabIndex()
                val fromRight = from == null || to == null || to >= from
                slideInHorizontally(animationSpec = tween(280)) { width ->
                    if (fromRight) width else -width
                }
            },
            exitTransition = {
                val from = initialState.tabIndex()
                val to = targetState.tabIndex()
                val toLeft = from == null || to == null || to >= from
                slideOutHorizontally(animationSpec = tween(280)) { width ->
                    if (toLeft) -width / 5 else width / 5
                }
            },
            popEnterTransition = {
                slideInHorizontally(animationSpec = tween(280)) { width -> -width / 4 }
            },
            popExitTransition = {
                slideOutHorizontally(animationSpec = tween(280)) { width -> width }
            },
        ) {
            composable(Routes.HOME) { HomeScreen(vm, nav) }
            composable(Routes.DISCOVER) { DiscoverScreen(vm, nav) }
            composable(Routes.CREATOR) { CreatorCenterScreen(vm, nav) }
            composable(Routes.MESSAGES) { MessagesScreen(vm, nav) }
            composable(Routes.PROFILE) { ProfileScreen(vm, nav) }

            composable(Routes.RANKING) { RankingScreen(vm, nav) }
            composable(Routes.DAILY) { DailyScreen(vm, nav) }
            // 歌词页从下往上滑入，退出时滑回底部（对齐网页端的 translate-y 动画）
            composable(
                route = Routes.LYRIC,
                enterTransition = {
                    slideInVertically(animationSpec = tween(340)) { height -> height }
                },
                popExitTransition = {
                    slideOutVertically(animationSpec = tween(300)) { height -> height }
                },
            ) {
                LyricScreen(vm, nav)
            }
            composable(Routes.SEARCH) { SearchScreen(vm, nav) }
            composable(Routes.LATEST) { LatestSongsScreen(vm, nav) }
            composable(Routes.NCM) { NcmParseScreen(nav) }
            composable(Routes.SUBMIT) { SubmitScreen(nav) }
            composable(Routes.SUBMISSION) { SubmissionDetailScreen(vm, nav) }
            composable(Routes.PROFILE_EDIT) { ProfileEditScreen(vm, nav) }
            composable(Routes.REVIEW) { ReviewQueueScreen(vm, nav) }

            composable(
                route = Routes.SCAN,
                arguments = listOf(
                    navArgument("ticket") {
                        type = NavType.StringType
                        nullable = true
                        defaultValue = null
                    },
                ),
            ) { entry ->
                ScanScreen(
                    initialTicket = entry.arguments?.getString("ticket"),
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
            Box(
                Modifier
                    .size(96.dp)
                    .clip(RoundedCornerShape(22.dp))
                    .background(Amll.colors.primary),
                contentAlignment = Alignment.Center,
            ) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.width(52.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.White))
                    Box(Modifier.width(38.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.White))
                    Box(Modifier.width(26.dp).height(8.dp).clip(RoundedCornerShape(4.dp)).background(Color.White))
                }
            }
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
