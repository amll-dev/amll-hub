package dev.amll.hub.android.playback

/** 杜比全景声在移动端 ExoPlayer 上无法正常解码，播放前统一给出提示 */
const val DOLBY_UNSUPPORTED_HINT = "杜比全景声暂不支持播放，可改选其它音质；或下载后用本地播放器收听"

/** 网易云 8 档音质，顺序即档位高低（standard 最低、dolby 最高） */
enum class NcmQuality(val key: String, val label: String) {
    STANDARD("standard", "标准"),
    EXHIGH("exhigh", "极高"),
    LOSSLESS("lossless", "无损"),
    HIRES("hires", "Hi-Res"),
    JYEFFECT("jyeffect", "高清臻音"),
    JYMASTER("jymaster", "超清母带"),
    SKY("sky", "沉浸环绕声"),
    DOLBY("dolby", "杜比全景声"),
    ;

    companion object {
        val ORDER: List<NcmQuality> = NcmQuality.entries

        /** key 与中文 label 都接，大小写不敏感 */
        fun fromKey(raw: String): NcmQuality? {
            val value = raw.trim()
            if (value.isEmpty()) return null
            return ORDER.firstOrNull {
                it.key.equals(value, ignoreCase = true) || it.label.equals(value, ignoreCase = true)
            }
        }

        /** 严格移植网页端 frontend/src/lib/quality.ts 的 normalizeNcmLevel */
        fun normalizeLevel(raw: String?): NcmQuality? {
            val value = raw?.trim().orEmpty()
            if (value.isEmpty()) return null

            val lower = value.lowercase()
            if (lower in PLACEHOLDERS) return null

            fromKey(value)?.let { return it }

            EXACT_MAP[value]?.let { return it }

            qualityFromBitrate(value)?.let { return it }

            for ((pattern, quality) in KEYWORD_RULES) {
                if (pattern.containsMatchIn(value)) return quality
            }
            return null
        }

        /** 档位序号，越大越高；null / 未知返回 -1 */
        fun rank(q: NcmQuality?): Int = if (q == null) -1 else ORDER.indexOf(q)

        fun isDowngraded(actual: NcmQuality?, selected: NcmQuality): Boolean =
            actual != null && rank(actual) < rank(selected)
    }
}

/** 上游 FormatLevel 的中文描述 */
private val EXACT_MAP: Map<String, NcmQuality> = mapOf(
    "标准" to NcmQuality.STANDARD,
    "极高(HQ)" to NcmQuality.EXHIGH,
    "无损(SQ)" to NcmQuality.LOSSLESS,
    "高解析度无损(Hi-Res)" to NcmQuality.HIRES,
    "高清臻音(Spatial Audio)" to NcmQuality.JYEFFECT,
    "超清母带(Master)" to NcmQuality.JYMASTER,
    "沉浸环绕声(Surround Audio)" to NcmQuality.SKY,
    "杜比全景声(Dolby Atmos)" to NcmQuality.DOLBY,
)

private val KEYWORD_RULES: List<Pair<Regex, NcmQuality>> = listOf(
    Regex("杜比|dolby|atmos", RegexOption.IGNORE_CASE) to NcmQuality.DOLBY,
    Regex("沉浸|环绕|surround", RegexOption.IGNORE_CASE) to NcmQuality.SKY,
    Regex("母带|master", RegexOption.IGNORE_CASE) to NcmQuality.JYMASTER,
    Regex("臻音|jyeffect|spatial", RegexOption.IGNORE_CASE) to NcmQuality.JYEFFECT,
    Regex("hi-?res| hires|解析度", RegexOption.IGNORE_CASE) to NcmQuality.HIRES,
    Regex("无损|lossless|\\bsq\\b|\\bflac\\b", RegexOption.IGNORE_CASE) to NcmQuality.LOSSLESS,
    Regex("母带|jymaster", RegexOption.IGNORE_CASE) to NcmQuality.JYMASTER,
    Regex("极高|exhigh|hq", RegexOption.IGNORE_CASE) to NcmQuality.EXHIGH,
    Regex("标准|standard", RegexOption.IGNORE_CASE) to NcmQuality.STANDARD,
)

/** 上游认不出来时的占位文案，出现即视为无效 */
private val PLACEHOLDERS = setOf("未知音质", "未知", "unknown", "none", "null", "undefined")

private val BITRATE = Regex("^(\\d{2,5})\\s*(k|kb|kbps|bps)$", RegexOption.IGNORE_CASE)

/** 128k 附近归标准，320k 归极高，1000k+ 归无损 */
private fun qualityFromBitrate(value: String): NcmQuality? {
    val match = BITRATE.matchEntire(value) ?: return null
    val digits = match.groupValues[1].toLongOrNull() ?: return null
    val unit = match.groupValues[2].lowercase()
    val kbps = if (unit == "bps") digits / 1000.0 else digits.toDouble()
    if (kbps <= 0) return null
    return when {
        kbps <= 145 -> NcmQuality.STANDARD
        kbps <= 345 -> NcmQuality.EXHIGH
        else -> NcmQuality.LOSSLESS
    }
}
