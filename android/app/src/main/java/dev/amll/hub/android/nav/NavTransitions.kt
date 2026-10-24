package dev.amll.hub.android.nav

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.navigation.NavBackStackEntry

/**
 * 统一转场：推进时按 Tab 方向横向滑入，返回时反向；
 * 歌词页用纵向转场（在 NavHost 里单独覆盖）。
 */
fun AnimatedContentTransitionScope<NavBackStackEntry>.slideInHorizontal(forward: Boolean): EnterTransition =
    slideInHorizontally(animationSpec = tween(280)) { width -> if (forward) width else -width }

fun AnimatedContentTransitionScope<NavBackStackEntry>.slideOutHorizontal(forward: Boolean): ExitTransition =
    slideOutHorizontally(animationSpec = tween(280)) { width -> if (forward) -width else width } +
        fadeOut(animationSpec = tween(200))

fun AnimatedContentTransitionScope<NavBackStackEntry>.popEnterHorizontal(): EnterTransition =
    slideInHorizontally(animationSpec = tween(280)) { width -> -width }

fun AnimatedContentTransitionScope<NavBackStackEntry>.popExitHorizontal(): ExitTransition =
    slideOutHorizontally(animationSpec = tween(280)) { width -> width } +
        fadeOut(animationSpec = tween(200))
