package dev.amll.hub.android.ui.screen

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * 扫码内容解析：需与后端 auth_qrcode.go 生成的
 * `amllhub://qrlogin?ticket=xxx` 格式对等。
 */
class ScanTicketParseTest {

    private fun extract(raw: String): String {
        val trimmed = raw.trim()
        val marker = "ticket="
        val index = trimmed.indexOf(marker)
        return if (index >= 0) {
            trimmed.substring(index + marker.length).substringBefore('&').trim()
        } else {
            trimmed
        }
    }

    @Test
    fun `解析标准 deep link`() {
        val ticket = extract("amllhub://qrlogin?ticket=abc123XYZ")
        assertEquals("abc123XYZ", ticket)
    }

    @Test
    fun `解析带额外查询参数与空格的 deep link`() {
        val ticket = extract("  amllhub://qrlogin?ticket=abc123&from=web  ")
        assertEquals("abc123", ticket)
    }

    @Test
    fun `裸 ticket 也能解析`() {
        assertEquals("abc123", extract("abc123"))
    }

    @Test
    fun `空内容解析为空串`() {
        assertEquals("", extract(""))
        assertEquals("", extract("   "))
    }
}
