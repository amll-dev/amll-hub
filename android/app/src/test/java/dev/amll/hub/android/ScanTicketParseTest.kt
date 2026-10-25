package dev.amll.hub.android.data

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 扫码内容解析：需与后端 auth_qrcode.go 生成的
 * `amllhub://qrlogin?ticket=xxx` 格式对等。
 */
class ScanTicketParseTest {

    @Test
    fun `解析标准 deep link`() {
        assertEquals("abc123XYZ", QrTicketParser.parse("amllhub://qrlogin?ticket=abc123XYZ"))
    }

    @Test
    fun `解析带额外查询参数与空格的 deep link`() {
        assertEquals("abc123", QrTicketParser.parse("  amllhub://qrlogin?ticket=abc123&from=web  "))
    }

    @Test
    fun `裸 ticket 也能解析`() {
        assertEquals("abc123", QrTicketParser.parse("abc123"))
    }

    @Test
    fun `空内容解析为空串`() {
        assertEquals("", QrTicketParser.parse(""))
        assertEquals("", QrTicketParser.parse("   "))
    }
}
