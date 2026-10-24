package dev.amll.hub.android.nav

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * 类型安全路由（Navigation 2.8+）：参数由序列化对象承载，
 * 不再手写 `"scan?ticket={ticket}"` 这类字符串与 query 拼接。
 */
@Serializable
@SerialName("home")
data object HomeRoute

@Serializable
@SerialName("discover")
data object DiscoverRoute

@Serializable
@SerialName("creator")
data object CreatorRoute

@Serializable
@SerialName("messages")
data object MessagesRoute

@Serializable
@SerialName("profile")
data object ProfileRoute

@Serializable
@SerialName("ranking")
data object RankingRoute

@Serializable
@SerialName("daily")
data object DailyRoute

@Serializable
@SerialName("lyric")
data object LyricRoute

@Serializable
@SerialName("search")
data object SearchRoute

@Serializable
@SerialName("latest")
data object LatestRoute

@Serializable
@SerialName("ncm")
data object NcmRoute

@Serializable
@SerialName("submission")
data class SubmissionRoute(val id: Long)

@Serializable
@SerialName("profile-edit")
data object ProfileEditRoute

@Serializable
@SerialName("review")
data object ReviewRoute

@Serializable
@SerialName("scan")
data class ScanRoute(val ticket: String? = null)

/** 底栏 5 个 Tab，顺序即底栏下标 */
val TabRoutes: List<Any> = listOf(
    HomeRoute,
    DiscoverRoute,
    CreatorRoute,
    MessagesRoute,
    ProfileRoute,
)

/** 与上面的路由 SerialName 一一对应，用于判断当前页是哪个 Tab */
val TabRouteNames: List<String> = listOf(
    "home",
    "discover",
    "creator",
    "messages",
    "profile",
)
