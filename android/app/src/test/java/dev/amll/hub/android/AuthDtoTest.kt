package dev.amll.hub.android

import kotlinx.serialization.json.Json
import dev.amll.hub.android.data.remote.ApiResponse
import dev.amll.hub.android.data.remote.LoginResult
import dev.amll.hub.android.data.remote.QrTicketStatus
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
}
