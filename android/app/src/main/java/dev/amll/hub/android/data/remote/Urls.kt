package dev.amll.hub.android.data.remote

import dev.amll.hub.android.BuildConfig
import java.net.URLEncoder

/**
 * 拼接后端资源地址。规则与网页端 lib/api.ts 保持一致，
 * 避免各页面自己拼字符串拼出 404。
 */
object Urls {

    private val base: String = BuildConfig.API_BASE_URL.trimEnd('/')

    /** 每日推荐封面：coverKey 是 MinIO 对象 key，传 width 走缩略图 */
    fun dailyCover(key: String?, width: Int? = null): String? {
        val raw = key?.trim().orEmpty()
        if (raw.isEmpty()) return null
        val encoded = URLEncoder.encode(raw, "UTF-8").replace("+", "%20")
        val url = "$base/api/v1/daily-recommendations/image/$encoded"
        return if (width != null) "$url?w=$width" else url
    }

    /** 用户头像等字段可能是相对路径（/uploads/...），统一补成绝对地址 */
    fun absolute(path: String?): String? {
        val raw = path?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return when {
            raw.startsWith("http://") || raw.startsWith("https://") -> raw
            raw.startsWith("//") -> "https:$raw"
            raw.startsWith("/") -> base + raw
            else -> "$base/$raw"
        }
    }
}
