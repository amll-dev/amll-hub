package dev.amll.hub.android.nav

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.amll.hub.android.data.remote.UserProfile
import dev.amll.hub.android.ui.screen.HomeScreen
import dev.amll.hub.android.ui.screen.LoginScreen
import dev.amll.hub.android.ui.screen.ScanScreen
import dev.amll.hub.android.ui.session.SessionState
import dev.amll.hub.android.ui.session.SessionViewModel

object Routes {
    const val HOME = "home"

    /** 扫码页，ticket 可为空（手动进入扫码器）或由 deep link 带入 */
    const val SCAN = "scan?ticket={ticket}"
    fun scan(ticket: String? = null): String =
        if (ticket.isNullOrBlank()) "scan" else "scan?ticket=$ticket"
}

/**
 * 顶层导航，完全由 [SessionViewModel] 的持久化登录态驱动：
 * - Loading：读本地 token 期间的启动占位，避免登录页一闪而过
 * - LoggedIn：首页 + 扫码授权页
 * - LoggedOut：仅登录页，未登录不提供「扫码登录网页端」入口
 *
 * 登录 / 登出只更新登录态，分区切换由状态完成，无需手动推栈。
 */
@Composable
fun AmllNavGraph(
    /** deep link 带进来的 ticket，非空时登录后直接弹扫码确认页 */
    pendingTicket: String? = null,
    onTicketConsumed: () -> Unit = {},
    sessionViewModel: SessionViewModel = hiltViewModel(),
) {
    val session by sessionViewModel.state.collectAsStateWithLifecycle()

    when (val state = session) {
        SessionState.Loading -> SplashPane()

        is SessionState.LoggedIn -> LoggedInNav(
            profile = state.profile,
            pendingTicket = pendingTicket,
            onTicketConsumed = onTicketConsumed,
            onLoggedOut = { sessionViewModel.logout() },
            onRefreshProfile = { sessionViewModel.refreshProfile() },
        )

        SessionState.LoggedOut -> LoginScreen(
            onLoggedIn = { sessionViewModel.onLoggedIn(it) },
        )
    }
}

/** 登录后的导航分区：首页 + 扫码授权页 */
@Composable
private fun LoggedInNav(
    profile: UserProfile?,
    pendingTicket: String?,
    onTicketConsumed: () -> Unit,
    onLoggedOut: () -> Unit,
    onRefreshProfile: () -> Unit,
) {
    val navController = rememberNavController()

    // 已登录时 deep link 直接进扫码确认页；未登录时 ticket 会被保留，登录后再处理
    LaunchedEffect(pendingTicket) {
        val ticket = pendingTicket?.takeIf { it.isNotBlank() } ?: return@LaunchedEffect
        onTicketConsumed()
        navController.navigate(Routes.scan(ticket))
    }

    NavHost(navController = navController, startDestination = Routes.HOME) {
        composable(Routes.HOME) {
            HomeScreen(
                profile = profile,
                onScanQr = { navController.navigate(Routes.scan()) },
                onLoggedOut = onLoggedOut,
                onRefreshProfile = onRefreshProfile,
            )
        }

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
                onDone = {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.HOME) { inclusive = true }
                    }
                },
            )
        }
    }
}

/** 读取本地登录态期间的启动占位，避免登录页一闪而过 */
@Composable
private fun SplashPane() {
    Surface(color = MaterialTheme.colorScheme.background) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.fillMaxSize(),
        ) {
            CircularProgressIndicator()
        }
    }
}
