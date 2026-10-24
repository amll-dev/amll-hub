package dev.amll.hub.android.data.lyric

import android.util.Xml
import org.xmlpull.v1.XmlPullParser
import java.io.StringReader

/**
 * 极简 TTML 解析器，只关心 Apple Music 风格歌词里 App 会用到的部分：
 * - <p begin end> 一行
 * - 行内 <span begin end> 逐字
 * - ttm:role="x-translation" 翻译
 * - ttm:role="x-roman" 音译
 * - ttm:role="x-bg" 背景和声（可含逐字）
 *
 * 解析失败时退化为「按行纯文本」，保证歌词页永远有东西可显示。
 */
data class Word(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val roman: String = "",
)

data class LyricLine(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val translation: String = "",
    val romanization: String = "",
    val isBackground: Boolean = false,
    val words: List<Word> = emptyList(),
)

object TtmlParser {

    fun parse(xml: String): List<LyricLine> =
        runCatching { parseInternal(xml) }
            .getOrElse { fallback(xml) }

    private fun parseInternal(xml: String): List<LyricLine> {
        val parser = Xml.newPullParser()
        parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES, false)
        parser.setInput(StringReader(xml))

        val lines = mutableListOf<LyricLine>()
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG && parser.name == "p") {
                val start = parseTime(attr(parser, "begin"))
                val end = parseTime(attr(parser, "end"))
                val isBg = attr(parser, "role") == "x-bg"
                val line = readParagraph(parser, start, end, isBg)
                if (line.text.isNotBlank()) lines += line
            }
            event = parser.next()
        }
        return lines.sortedBy { it.startMs }
    }

    /** 读到 </p> 为止，收集 span 里的逐字、翻译、音译与背景行 */
    private fun readParagraph(
        parser: XmlPullParser,
        startMs: Long,
        endMs: Long,
        isBackground: Boolean,
    ): LyricLine {
        val words = mutableListOf<Word>()
        val plain = StringBuilder()
        var translation = ""
        var roman = ""

        var event = parser.next()
        while (event != XmlPullParser.END_TAG || parser.name != "p") {
            if (event == XmlPullParser.END_DOCUMENT) break
            if (event == XmlPullParser.START_TAG && parser.name == "span") {
                val role = attr(parser, "role")
                val spanStart = parseTime(attr(parser, "begin"))
                val spanEnd = parseTime(attr(parser, "end"))
                when (role) {
                    "x-translation" -> translation = readText(parser, "span")
                    "x-roman" -> roman = readText(parser, "span")
                    "x-bg" -> readBackground(parser, spanStart, spanEnd)
                    else -> {
                        // 逐字 span，内部可能还有嵌套 span（背景行里会出现）
                        val wordText = readText(parser, "span")
                        if (wordText.isNotBlank()) {
                            words += Word(
                                text = wordText,
                                startMs = if (spanStart > 0) spanStart else startMs,
                                endMs = if (spanEnd > 0) spanEnd else endMs,
                            )
                        }
                    }
                }
            }
            event = parser.next()
        }

        val text = if (words.isNotEmpty()) words.joinToString("") { it.text } else plain.toString()
        return LyricLine(
            text = text,
            startMs = startMs,
            endMs = if (endMs > startMs) endMs else startMs + 4000,
            translation = translation,
            romanization = roman,
            isBackground = isBackground,
            words = words,
        )
    }

    private fun readBackground(parser: XmlPullParser, startMs: Long, endMs: Long): LyricLine {
        val words = mutableListOf<Word>()
        var event = parser.next()
        while (event != XmlPullParser.END_TAG || parser.name != "span") {
            if (event == XmlPullParser.END_DOCUMENT) break
            if (event == XmlPullParser.START_TAG && parser.name == "span") {
                val text = readText(parser, "span")
                if (text.isNotBlank()) {
                    words += Word(text, startMs, endMs)
                }
            }
            event = parser.next()
        }
        return LyricLine(
            text = words.joinToString("") { it.text },
            startMs = startMs,
            endMs = endMs,
            isBackground = true,
            words = words,
        )
    }

    /** 读取当前标签内的纯文本，直到同名结束标签 */
    private fun readText(parser: XmlPullParser, tag: String): String {
        val sb = StringBuilder()
        var event = parser.next()
        while (event != XmlPullParser.END_TAG || parser.name != tag) {
            if (event == XmlPullParser.END_DOCUMENT) break
            if (event == XmlPullParser.TEXT) sb.append(parser.text)
            event = parser.next()
        }
        return sb.toString().trim()
    }

    private fun attr(parser: XmlPullParser, local: String): String {
        for (i in 0 until parser.attributeCount) {
            val name = parser.getAttributeName(i)
            if (name == local || name.endsWith(":$local")) return parser.getAttributeValue(i)
        }
        return ""
    }

    /** 支持 hh:mm:ss.mmm / mm:ss.mmm / 12.5s / 12500 */
    fun parseTime(raw: String): Long {
        if (raw.isBlank()) return 0
        val value = raw.trim().removeSuffix("s")
        if (!value.contains(":")) {
            val seconds = value.toDoubleOrNull() ?: return 0
            return if (seconds > 1000) seconds.toLong() else (seconds * 1000).toLong()
        }
        val parts = value.split(":")
        var hours = 0L
        var minutes = 0L
        var seconds = 0.0
        when (parts.size) {
            3 -> {
                hours = parts[0].toLongOrNull() ?: 0
                minutes = parts[1].toLongOrNull() ?: 0
                seconds = parts[2].toDoubleOrNull() ?: 0.0
            }
            2 -> {
                minutes = parts[0].toLongOrNull() ?: 0
                seconds = parts[1].toDoubleOrNull() ?: 0.0
            }
        }
        return hours * 3600_000 + minutes * 60_000 + (seconds * 1000).toLong()
    }

    /** 拿不到结构化 TTML 时，按纯文本切行，至少能滚动 */
    private fun fallback(xml: String): List<LyricLine> =
        xml.split("\n")
            .map { it.trim() }
            .filter { it.isNotEmpty() && !it.startsWith("<") }
            .mapIndexed { index, text ->
                LyricLine(text = text, startMs = index * 4000L, endMs = index * 4000L + 3800L)
            }
}
