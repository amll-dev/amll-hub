package dev.amll.hub.android.data.remote

import kotlinx.serialization.SerializationException
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/** 网络异常 → 用户可读异常的映射，登录失效与业务错误最容易回归 */
class ApiErrorParserTest {

    private fun httpException(code: Int, body: String): HttpException =
        HttpException(Response.error<Unit>(code, body.toResponseBody(JSON)))

    @Test
    fun `从错误响应体提取后端 message`() {
        val e = httpException(400, """{"code":400,"message":"歌名不能为空"}""")

        assertEquals("歌名不能为空", ApiErrorParser.message(e))
    }

    @Test
    fun `401 映射为登录失效并保留后端提示`() {
        val mapped = ApiErrorParser.map(httpException(401, """{"code":401,"message":"token 已过期"}"""))

        assertTrue(mapped is UnauthorizedException)
        assertEquals("token 已过期", mapped.message)
    }

    @Test
    fun `401 无响应体时使用默认提示`() {
        val mapped = ApiErrorParser.map(httpException(401, ""))

        assertTrue(mapped is UnauthorizedException)
        assertEquals("登录状态已过期，请重新登录", mapped.message)
    }

    @Test
    fun `其它 HTTP 错误映射为带状态码的业务异常`() {
        val mapped = ApiErrorParser.map(httpException(500, ""))

        assertTrue(mapped is ApiException)
        mapped as ApiException
        assertEquals(500, mapped.code)
        assertEquals("请求失败（HTTP 500）", mapped.message)
    }

    @Test
    fun `IO 异常映射为网络异常`() {
        val mapped = ApiErrorParser.map(IOException("timeout"))

        assertTrue(mapped is NetworkException)
    }

    @Test
    fun `反序列化异常映射为可读的解析失败`() {
        val mapped = ApiErrorParser.map(SerializationException("unexpected json"))

        assertTrue(mapped is IOException)
        assertTrue(mapped.message.orEmpty().startsWith("响应解析失败"))
    }

    private companion object {
        val JSON = "application/json".toMediaType()
    }
}
