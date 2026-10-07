package dev.amll.hub.android

import kotlinx.serialization.json.Json
import dev.amll.hub.android.data.remote.ApiResponse
import dev.amll.hub.android.data.remote.LoginResult
import dev.amll.hub.android.data.remote.QrTicketStatus
import dev.amll.hub.android.data.remote.SendCodeRequest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** 校验后端响应反序列化与扫码票据状态判定 */
class AuthDtoTest {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        coerceInputValues = true
    }

    @Test
    fun `解析统一响应包装`() {
        val body = """{"code":200,"message":"success","data":{"token":"jwt-123","user":{"name":"alice","displayName":"爱丽丝","email":"a@b.c","avatar":"https://x/y.png","isReviewer":true}}}"""
        val resp = json.decodeFromString<ApiResponse<LoginResult>>(body)
        assertEquals(200, resp.code)
        assertEquals("jwt-123", resp.data?.token)
        assertEquals("爱丽丝", resp.data?.user?.displayName)
        assertTrue(resp.data?.user?.isReviewer == true)
    }

    @Test
    fun `扫码票据状态判定`() {
        val pending = json.decodeFromString<QrTicketStatus>("""{"status":"pending"}""")
        assertTrue(pending.isPending)
        assertFalse(pending.isConfirmed)
        assertNull(pending.token)

        val confirmed = json.decodeFromString<QrTicketStatus>(
            """{"status":"confirmed","token":"jwt-456","user":{"name":"bob"}}"""
        )
        assertTrue(confirmed.isConfirmed)
        assertEquals("jwt-456", confirmed.token)
        assertEquals("bob", confirmed.user?.name)
    }

    @Test
    fun `忽略后端新增的未知字段`() {
        val body = """{"status":"scanned","brandNewField":"whatever"}"""
        val status = json.decodeFromString<QrTicketStatus>(body)
        assertTrue(status.isScanned)
    }

    @Test
    fun `无 data 字段的成功响应应可解析`() {
        // 后端 OKWithMsg(c, nil, ...)（发码 / 扫码确认取消）因 `data,omitempty`
        // 会直接省略 data 字段，客户端不能把 data 缺失当成错误
        val resp = json.decodeFromString<ApiResponse<Unit>>(
            """{"code":200,"message":"验证码已发送"}"""
        )
        assertEquals(200, resp.code)
        assertEquals("验证码已发送", resp.message)
        assertNull(resp.data)
    }

    @Test
    fun `发码请求省略可选项，由后端补齐人机验证参数`() {
        // Json 未开启 encodeDefaults（默认 false），带默认值的字段不会出现在请求体里。
        // 后端因此走 captchaType == "" 分支，按 Casdoor 配置自动补齐；method 默认 login。
        val body = json.encodeToString(SendCodeRequest(checkType = "phone", dest = "13800000000"))
        assertEquals("""{"checkType":"phone","dest":"13800000000"}""", body)
    }
}
