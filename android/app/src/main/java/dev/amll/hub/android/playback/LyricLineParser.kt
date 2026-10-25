package dev.amll.hub.android.playback

data class TimedLyricLine(val timeMs: Long, val text: String)

private val LRC_TAG = Regex("\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?]")

private val TTML_P = Regex(
    "<p\\b([^>]*)>(.*?)</p>",
    setOf(RegexOption.DOT_MATCHES_ALL, RegexOption.IGNORE_CASE),
)
private val TTML_BEGIN = Regex("begin\\s*=\\s*\"([^\"]+)\"", RegexOption.IGNORE_CASE)
private val XML_TAG = Regex("<[^>]+>")
private val XML_ENTITY = Regex("&(#x?[0-9a-fA-F]+|lt|gt|quot|apos|amp);")

/**
 * 把歌词原文解析成带时间轴的行。
 * [format] 为 "ttml" 时按 TTML 解析，否则按 LRC 解析。
 */
fun parseTimedLyric(text: String, format: String): List<TimedLyricLine> {
    if (text.isBlank()) return emptyList()
    return if (format.equals("ttml", ignoreCase = true)) parseTtml(text) else parseLrc(text)
}

/** 当前应显示的一行：最后一个 timeMs <= positionMs 的文本 */
fun currentLyricLine(lines: List<TimedLyricLine>, positionMs: Long, playing: Boolean): String? {
    if (!playing || lines.isEmpty()) return null
    return lines.lastOrNull { it.timeMs <= positionMs }?.text
}

/** LRC：[mm:ss.xx] / [mm:ss]，允许一行多个时间标签，跳过 [ar:] 等元信息与空行 */
private fun parseLrc(text: String): List<TimedLyricLine> {
    val result = ArrayList<TimedLyricLine>()
    for (raw in text.lineSequence()) {
        val tags = LRC_TAG.findAll(raw).toList()
        if (tags.isEmpty()) continue
        val content = raw.substring(tags.last().range.last + 1).trim()
        if (content.isEmpty()) continue
        for (tag in tags) {
            val minutes = tag.groupValues[1].toLongOrNull() ?: continue
            val seconds = tag.groupValues[2].toLongOrNull() ?: continue
            val fraction = fractionMs(tag.groupValues[3])
            result += TimedLyricLine(minutes * 60_000 + seconds * 1_000 + fraction, content)
        }
    }
    return result.sortedBy { it.timeMs }
}

private fun fractionMs(raw: String): Long = when (raw.length) {
    0 -> 0L
    1 -> (raw.toLongOrNull() ?: 0L) * 100
    2 -> (raw.toLongOrNull() ?: 0L) * 10
    else -> raw.take(3).toLongOrNull() ?: 0L
}

/** TTML：<p ... begin="...">...</p>，begin 支持纯秒数与 hh:mm:ss.mmm */
private fun parseTtml(text: String): List<TimedLyricLine> {
    val result = ArrayList<TimedLyricLine>()
    for (match in TTML_P.findAll(text)) {
        val begin = TTML_BEGIN.find(match.groupValues[1])?.groupValues?.get(1) ?: continue
        val timeMs = parseTtmlTime(begin) ?: continue
        val plain = decodeXml(XML_TAG.replace(match.groupValues[2], "")).trim()
        if (plain.isEmpty()) continue
        result += TimedLyricLine(timeMs, plain)
    }
    return result.sortedBy { it.timeMs }
}

private fun parseTtmlTime(raw: String): Long? {
    val value = raw.trim()
    value.toDoubleOrNull()?.let { seconds ->
        if (seconds >= 0) return (seconds * 1000).toLong()
    }
    val parts = value.split(':')
    if (parts.size !in 2..3) return null
    val hours: Long
    val minutes: Long
    val seconds: Double
    if (parts.size == 3) {
        hours = parts[0].toLongOrNull() ?: return null
        minutes = parts[1].toLongOrNull() ?: return null
        seconds = parts[2].toDoubleOrNull() ?: return null
    } else {
        hours = 0L
        minutes = parts[0].toLongOrNull() ?: return null
        seconds = parts[1].toDoubleOrNull() ?: return null
    }
    return hours * 3_600_000 + minutes * 60_000 + (seconds * 1000).toLong()
}

private fun decodeXml(value: String): String = XML_ENTITY.replace(value) { match ->
    val entity = match.groupValues[1]
    when (entity) {
        "lt" -> "<"
        "gt" -> ">"
        "quot" -> "\""
        "apos" -> "'"
        "amp" -> "&"
        else -> runCatching {
            val code = if (entity.startsWith("#x") || entity.startsWith("#X")) {
                entity.drop(2).toInt(16)
            } else {
                entity.drop(1).toInt()
            }
            String(Character.toChars(code))
        }.getOrDefault(match.value)
    }
}
