package dev.amll.hub.android.ui

/**
 * 页面跳转集合：避免每个屏幕都塞十几个 lambda 参数。
 */
data class AppNav(
    val back: () -> Unit = {},
    val openRanking: () -> Unit = {},
    val openDaily: () -> Unit = {},
    val openSearch: () -> Unit = {},
    val openLatest: () -> Unit = {},
    /** 网易云解析：粘 ID / 链接 或 关键词搜索后直接播放 */
    val openNcm: () -> Unit = {},
    val openScan: () -> Unit = {},
    val openLyric: (songId: String, title: String, artist: String, cover: String?) -> Unit = { _, _, _, _ -> },
    /** 搜索命中的歌词：多带一个词库 TTML 文件名，优先于 ncm-lyrics 目录 */
    val openLyricFile: (
        songId: String,
        title: String,
        artist: String,
        cover: String?,
        rawLyricFile: String?,
    ) -> Unit = { _, _, _, _, _ -> },
    /** 直接打开当前播放曲目的歌词页（迷你播放器用） */
    val openPlayer: () -> Unit = {},
    val openSubmit: () -> Unit = {},
    val openSubmission: (id: Long) -> Unit = {},
    val openProfileEdit: () -> Unit = {},
    val openReview: () -> Unit = {},
    val switchTab: (Int) -> Unit = {},
)
