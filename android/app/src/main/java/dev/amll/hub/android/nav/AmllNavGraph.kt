package dev.amll.hub.android.nav

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import dev.amll.hub.android.ui.screen.HomeScreen
import dev.amll.hub.android.ui.screen.LoginScreen
import dev.amll.hub.android.ui.screen.ScanScreen

object Routes {
    const val LOGIN = "login"
    const val HOME = "home"

    /** 扫码页，ticket 可为空（手动进入扫码器）或由 deep link 带入 */
    const val SCAN = "scan?ticket={ticket}"
    fun scan(ticket: String? = null): String =
        if (ticket.isNullOrBlank()) "scan" else "scan?ticket=$ticket"
}

@Composable
fun AmllNavGraph(
    navController: NavHostController = rememberNavController(),
    /** deep link 带进来的 ticket，非空时直接跳扫码确认页 */
    pendingTicket: String? = null,
    onTicketConsumed: () -> Unit = {},
) {
    // deep link 优先于当前页面：用户点二维码就是为了来授权的
    LaunchedEffect(pendingTicket) {
        val ticket = pendingTicket ?: return@LaunchedEffect
        onTicketConsumed()
        navController.navigate(Routes.scan(ticket)) {
            popUpTo(Routes.LOGIN) { inclusive = true }
        }
    }

    NavHost(navController = navController, startDestination = Routes.LOGIN) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoggedIn = {
                    navController.navigate(Routes.HOME) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
                onScanQr = { navController.navigate(Routes.scan()) },
            )
        }

        composable(Routes.HOME) {
            HomeScreen(
                onScanQr = { navController.navigate(Routes.scan()) },
                onLoggedOut = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(Routes.HOME) { inclusive = true }
                    }
                },
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
                    // 扫码页带参数，popUpTo 用 route 模式匹配不到，直接清栈
                    navController.navigate(Routes.HOME) {
                        popUpTo(0) { inclusive = true }
                    }
                },
            )
        }
    }
}
