package dev.amll.hub.android.data.lyric

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** LRC 兜底解析：网页端 parseLrc 的 Kotlin 版本必须保持同样行为 */
class LrcParserTest {

    @Test
    fun `解析基础时间戳并顺序串联结束时间`() {
        val lines = LrcParser.parse(
            """
            [00:01.50]第一行
            [00:03.000]第二行
            [00:05:25]第三行
            """.trimIndent(),
        )

        assertEquals(3, lines.size)
        assertEquals("第一行", lines[0].text)
        assertEquals(1_500L, lines[0].startMs)
        assertEquals(3_000L, lines[0].endMs)
        assertEquals(3_000L, lines[1].startMs)
        // [mm:ss:xx] 与 [mm:ss.xx] 等价
        assertEquals(5_250L, lines[2].startMs)
        // 最后一行没有下一行，补 4 秒展示窗口
        assertEquals(9_250L, lines[2].endMs)
    }

    @Test
    fun `一行多个时间戳会拆成多行`() {
        val lines = LrcParser.parse("[00:01.00][00:02.00]重复的歌词")

        assertEquals(2, lines.size)
        assertEquals(1_000L, lines[0].startMs)
        assertEquals(2_000L, lines[1].startMs)
        assertTrue(lines.all { it.text == "重复的歌词" })
    }

    @Test
    fun `不同位数的小数秒按毫秒换算`() {
        val lines = LrcParser.parse(
            """
            [00:01.5]一位
            [00:02.50]两位
            [00:03.250]三位
            """.trimIndent(),
        )

        // [00:01.5] = 1 秒 + 500 毫秒
        assertEquals(1_500L, lines[0].startMs)
        assertEquals(2_500L, lines[1].startMs)
        assertEquals(3_250L, lines[2].startMs)
    }

    @Test
    fun `空行与纯时间戳行会被忽略`() {
        val lines = LrcParser.parse(
            """
            [00:01.00]
            [00:02.00]   

            [00:03.00]有效行
            """.trimIndent(),
        )

        assertEquals(1, lines.size)
        assertEquals("有效行", lines.single().text)
    }

    @Test
    fun `翻译按开始时间精确对齐`() {
        val lines = LrcParser.parse("[00:01.00]hello\n[00:05.00]world")
        val merged = LrcParser.withTranslation(lines, "[00:01.00]你好")

        assertEquals("你好", merged[0].translation)
        assertEquals("", merged[1].translation)
    }

    @Test
    fun `空输入返回空列表`() {
        assertTrue(LrcParser.parse("").isEmpty())
        assertTrue(LrcParser.parse("   ").isEmpty())
    }
}
