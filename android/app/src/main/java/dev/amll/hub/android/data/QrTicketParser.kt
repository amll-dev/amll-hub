package dev.amll.hub.android.data

/**
 * 扫码内容解析：兼容 `amllhub://qrlogin?ticket=xxx` 与裸 ticket。
 * 生产代码与单元测试共用这一份实现。
 */
object QrTicketParser {

    fun parse(raw: String): String {
        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return ""
        val marker = "ticket="
        val index = trimmed.indexOf(marker)
        return if (index >= 0) {
            trimmed.substring(index + marker.length).substringBefore('&').trim()
        } else {
            trimmed
        }
    }
}
