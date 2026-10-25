package dev.amll.hub.android.ui.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

/**
 * 推荐语标记语言渲染（与网页端 markup.ts 的核心规则一致）：
 * `[:-:]` 居中、`[-:]` 右对齐、`[_:]` 小字，`[-]` 分割线。
 */
private data class MarkupLine(
    val text: String,
    val align: TextAlign,
    val small: Boolean,
    val separator: Boolean,
)

private val MARKUP_REGEX = Regex("^\\[([:_-]+)\\](.*)$")

private fun parseMarkupLines(source: String): List<MarkupLine> {
    if (source.isBlank()) return emptyList()
    val result = ArrayList<MarkupLine>()
    source.split('\n').forEach { rawLine ->
        val line = rawLine.trim()
        val match = MARKUP_REGEX.find(line)
        if (match == null) {
            result += MarkupLine(line, TextAlign.Start, small = false, separator = false)
            return@forEach
        }
        val spec = match.groupValues[1]
        val content = match.groupValues[2].trim()
        if (spec == "-") {
            if (content.isNotEmpty()) result += MarkupLine(content, TextAlign.Center, false, true)
            return@forEach
        }
        val normalized = spec.replace('_', '-')
        val align = when {
            normalized.contains(":-:") -> TextAlign.Center
            normalized.contains("-:") -> TextAlign.End
            else -> TextAlign.Start
        }
        result += MarkupLine(content, align, small = spec.contains('_'), separator = false)
    }
    return result
}

@Composable
fun MarkupText(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Amll.colors.ink2,
    emptyText: String = "今天没有留下评论",
) {
    val lines = remember(text) { parseMarkupLines(text) }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        if (lines.isEmpty()) {
            Text(emptyText, style = Font.bodySmall, color = Amll.colors.ink3)
            return@Column
        }
        lines.forEach { line ->
            if (line.separator) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Box(Modifier.weight(1f).height(1.dp).background(Amll.colors.border))
                    Text(line.text, style = Font.micro, color = Amll.colors.ink3)
                    Box(Modifier.weight(1f).height(1.dp).background(Amll.colors.border))
                }
            } else {
                Text(
                    line.text,
                    style = Font.bodySmall.copy(
                        fontSize = if (line.small) 12.sp else 15.sp,
                        lineHeight = if (line.small) 18.sp else 23.sp,
                    ),
                    color = color,
                    textAlign = line.align,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
