package dev.amll.hub.android.data.remote

import dev.amll.hub.android.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

/**
 * 拼接后端资源地址。统一走 OkHttp HttpUrl，路径段与查询参数由它负责转义，
 * 避免手写 URLEncoder 时漏掉 `/`、`&`、`#` 等字符。
 */
object Urls {

    private val baseUrl = BuildConfig.API_BASE_URL.trimEnd('/').toHttpUrlOrNull()

    /** 每日推荐封面：coverKey 是 MinIO 对象 key，传 width 走缩略图 */
    fun dailyCover(key: String?, width: Int? = null): String? {
        val raw = key?.trim().orEmpty()
        if (raw.isEmpty()) return null
        val base = baseUrl ?: return null
        val builder = base.newBuilder()
            .addPathSegments("api/v1/daily-recommendations/image")
            .addPathSegment(raw)
        if (width != null) builder.addQueryParameter("w", width.toString())
        return builder.build().toString()
    }

    /** 用户头像等字段可能是相对路径（/uploads/...），统一补成绝对地址 */
    fun absolute(path: String?): String? {
        val raw = path?.trim().orEmpty()
        if (raw.isEmpty()) return null
        return when {
            raw.startsWith("http://") || raw.startsWith("https://") -> raw
            raw.startsWith("//") -> "https:$raw"
            baseUrl == null -> null
            else -> baseUrl.newBuilder()
                .addPathSegments(raw.removePrefix("/"))
                .build()
                .toString()
        }
    }
}
