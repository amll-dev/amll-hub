package dev.amll.hub.android.data.repo

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 一首歌拿到的原始歌词文本。
 *
 * 解析不在原生侧做：页面里的 AMLL 官方解析器（@applemusic-like-lyrics/lyric）
 * 与网页端 PlayerBoot 用的是同一个库，逐字空格等信息只有它处理得对。
 */
data class LyricSource(
    /** 原始歌词文本（TTML 或 LRC）；空串表示没有歌词 */
    val text: String = "",
    /** "ttml" / "lrc"；空串表示没有歌词 */
    val format: String = "",
    /** LRC 的翻译文本（tlyric）；TTML 自带翻译，这里为空 */
    val translation: String = "",
    /** 原始 TTML，交给播放器缓存；LRC 兜底时为空 */
    val ttml: String = "",
)

/**
 * 歌词获取与三级回退（与网页端 PlayerBoot 一致）：
 * 1. 词库 TTML（搜索命中的 rawLyricFile）
 * 2. ncm-lyrics 目录下的 TTML
 * 3. parse-music 返回的 LRC（+ tlyric 合并翻译）
 *
 * 这里只负责取原文，格式判断与解析全部交给歌词页。
 */
@Singleton
class LyricRepository @Inject constructor(
    private val repo: ContentRepository,
) {

    suspend fun load(
        songId: String,
        rawLyricFile: String?,
        ncmLyric: String,
        ncmTLyric: String,
    ): LyricSource = withContext(Dispatchers.Default) {
        val candidates = listOfNotNull(
            rawLyricFile?.takeIf { it.isNotBlank() }?.let { repo.rawLyricTtml(it).getOrNull() },
            repo.lyricTtml(songId).getOrNull(),
        )
        val ttml = candidates.firstOrNull { !it.isNullOrBlank() }
        if (!ttml.isNullOrBlank()) {
            return@withContext LyricSource(text = ttml, format = "ttml", ttml = ttml)
        }

        if (ncmLyric.isNotBlank()) {
            return@withContext LyricSource(text = ncmLyric, format = "lrc", translation = ncmTLyric)
        }
        LyricSource()
    }
}
