package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.lyric.LrcParser
import dev.amll.hub.android.data.lyric.LyricLine
import dev.amll.hub.android.data.lyric.TtmlParser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 歌词获取与三级回退（与网页端 PlayerBoot 一致）：
 * 1. 词库 TTML（搜索命中的 rawLyricFile）
 * 2. ncm-lyrics 目录下的 TTML
 * 3. parse-music 返回的 LRC（+ tlyric 合并翻译）
 */
@Singleton
class LyricRepository @Inject constructor(
    private val repo: ContentRepository,
) {

    /** 返回解析好的行和原始 TTML（LRC 兜底时 ttml 为空） */
    suspend fun load(
        songId: String,
        rawLyricFile: String?,
        ncmLyric: String,
        ncmTLyric: String,
    ): Pair<List<LyricLine>, String> = withContext(Dispatchers.Default) {
        val candidates = listOfNotNull(
            rawLyricFile?.takeIf { it.isNotBlank() }?.let { repo.rawLyricTtml(it).getOrNull() },
            repo.lyricTtml(songId).getOrNull(),
        )
        candidates.firstOrNull { !it.isNullOrBlank() }?.let { ttml ->
            val parsed = TtmlParser.parse(ttml)
            if (parsed.isNotEmpty()) return@withContext parsed to ttml
        }

        if (ncmLyric.isNotBlank()) {
            val parsed = LrcParser.withTranslation(LrcParser.parse(ncmLyric), ncmTLyric)
            if (parsed.isNotEmpty()) return@withContext parsed to ""
        }
        emptyList<LyricLine>() to ""
    }
}
