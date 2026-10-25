package dev.amll.hub.android.data.remote

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException

/**
 * 统一解析后端 `{code,message,data}` 错误响应，并把网络层异常映射成可展示的异常。
 * ContentRepository / AuthRepository 共用同一套逻辑，避免两处行为漂移。
 */
object ApiErrorParser {

    private val json = Json {
        ignoreUnknownKeys = true
        coerceInputValues = true
    }

    /** 从错误响应体里取 message（转义、嵌套结构都交给 kotlinx.serialization） */
    fun message(e: HttpException): String? = runCatching {
        e.response()?.errorBody()?.string()
            ?.let { json.decodeFromString<ApiResponse<Unit>>(it).message }
            ?.takeIf { it.isNotBlank() }
    }.getOrNull()

    /** 把任意异常映射成带用户可读消息的异常；已是业务异常的原样返回 */
    fun map(e: Throwable, fallbackPrefix: String = "请求失败"): Throwable = when (e) {
        is HttpException -> {
            val backendMessage = message(e)
            if (e.code() == 401) {
                if (backendMessage == null) UnauthorizedException() else UnauthorizedException(backendMessage)
            } else {
                ApiException(e.code(), backendMessage ?: "$fallbackPrefix（HTTP ${e.code()}）")
            }
        }

        is SerializationException -> IOException("响应解析失败：${e.message.orEmpty().take(140)}")
        is IOException -> NetworkException()
        else -> e
    }
}
