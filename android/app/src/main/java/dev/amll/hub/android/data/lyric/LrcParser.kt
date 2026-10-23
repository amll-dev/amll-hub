package dev.amll.hub.android.data.lyric

/**
 * LRC 解析：TTML 拿不到时的兜底，与网页端 `parseLrc` 的分支一致。
 *
 * 网易云返回的 `lyric` / `tlyric` 都是 LRC，只有行级时间戳；
 * 逐字信息缺失时 AMLL 会退化成整行高亮，至少能跟着唱。
 */
object LrcParser {

    /** [mm:ss] / [mm:ss.xx] / [mm:ss:xx]，一行可以有多个时间戳 */
    private val TIME_TAG = Regex("""\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?]""")

    /** 把 LRC 文本解析成歌词行；行结束时间取下一行的开始时间 */
    fun parse(lrc: String): List<LyricLine> {
        if (lrc.isBlank()) return emptyList()

        val starts = LinkedHashMap<Long, String>()
        lrc.lineSequence().forEach { raw ->
            val tags = TIME_TAG.findAll(raw).toList()
            if (tags.isEmpty()) return@forEach
            val text = raw.substring(tags.last().range.last + 1).trim()
            if (text.isEmpty()) return@forEach
            tags.forEach { tag ->
                val minute = tag.groupValues[1].toLongOrNull() ?: 0L
                val second = tag.groupValues[2].toLongOrNull() ?: 0L
                val fraction = tag.groupValues[3]
                val millis = when (fraction.length) {
                    0 -> 0L
                    1 -> fraction.toLongOrNull()?.times(100) ?: 0L
                    2 -> fraction.toLongOrNull()?.times(10) ?: 0L
                    else -> fraction.take(3).toLongOrNull() ?: 0L
                }
                val start = (minute * 60 + second) * 1000 + millis
                // 同一时间戳重复出现时拼接，避免丢词
                val exist = starts[start]
                starts[start] = if (exist.isNullOrBlank()) text else "$exist $text"
            }
        }
        if (starts.isEmpty()) return emptyList()

        val sorted = starts.entries.sortedBy { it.key }
        return sorted.mapIndexed { index, entry ->
            val next = sorted.getOrNull(index + 1)?.key
            LyricLine(
                text = entry.value,
                startMs = entry.key,
                // 最后一个时间戳没有下一行，给 4 秒的展示窗口
                endMs = next ?: (entry.key + 4_000L),
            )
        }
    }

    /**
     * 合并翻译：按开始时间精确对齐（网页端用的是同一个时间戳 Map）。
     */
    fun withTranslation(lines: List<LyricLine>, tlyric: String): List<LyricLine> {
        if (lines.isEmpty() || tlyric.isBlank()) return lines
        val translated = parse(tlyric)
        if (translated.isEmpty()) return lines

        val byStart = translated.associate { it.startMs to it.text }
        return lines.map { line ->
            val text = byStart[line.startMs]
            if (text.isNullOrBlank()) line else line.copy(translation = text)
        }
    }
}
