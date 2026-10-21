package dev.amll.hub.android.ui

/**
 * 页面跳转集合：避免每个屏幕都塞十几个 lambda 参数。
 */
data class AppNav(
    val back: () -> Unit = {},
    val openRanking: () -> Unit = {},
    val openDaily: () -> Unit = {},
    val openLyric: (songId: String, title: String, artist: String, cover: String?) -> Unit = { _, _, _, _ -> },
    val openImmersive: () -> Unit = {},
    val openSubmit: () -> Unit = {},
    val openSubmission: (id: Long) -> Unit = {},
    val openProfileEdit: () -> Unit = {},
    val openReview: () -> Unit = {},
    val switchTab: (Int) -> Unit = {},
)
