package dev.amll.hub.android.ui.screen

/** 通用列表状态：区分「加载中 / 成功但为空 / 请求失败」 */
data class ListUi<T>(
    val loading: Boolean = true,
    val items: List<T> = emptyList(),
    val error: String? = null,
)
