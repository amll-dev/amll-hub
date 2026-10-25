package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.SearchHitDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SearchUi(
    val query: String = "",
    val loading: Boolean = false,
    /** all / song / artist / album / lyric / id，与网页端一致 */
    val field: String = "all",
    val hits: List<SearchHitDto> = emptyList(),
    val error: String? = null,
)

@HiltViewModel
class SearchViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val search = MutableStateFlow(SearchUi())

    fun runSearch(keyword: String, field: String = search.value.field) {
        val trimmed = keyword.trim()
        search.update {
            it.copy(query = trimmed, field = field, loading = trimmed.isNotBlank(), error = null)
        }
        if (trimmed.isBlank()) {
            search.update { it.copy(hits = emptyList(), loading = false) }
            return
        }
        viewModelScope.launch {
            val result = repo.search(trimmed, field)
            val hits = result.getOrDefault(emptyList())
            // 输入变化过快时丢弃旧请求的结果
            search.update { ui ->
                if (ui.query != trimmed || ui.field != field) {
                    ui
                } else {
                    ui.copy(
                        loading = false,
                        hits = hits,
                        error = result.exceptionOrNull()?.message
                            ?: if (hits.isEmpty()) "没有找到歌词" else null,
                    )
                }
            }
        }
    }
}
