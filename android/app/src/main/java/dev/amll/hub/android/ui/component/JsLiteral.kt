package dev.amll.hub.android.ui.component

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

private val json = Json

/**
 * 把任意字符串编码成合法的 JS/JSON 字面量（含引号）。
 * 换行、控制字符、Unicode 分隔符都由 kotlinx.serialization 统一处理。
 */
internal fun jsStringLiteral(value: String): String = json.encodeToString(value)
