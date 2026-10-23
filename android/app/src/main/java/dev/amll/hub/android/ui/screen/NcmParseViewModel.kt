package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.data.remote.NcmPlaylistDto
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * 网易云解析页的状态：三种入口共用一份，切换模式不清空彼此的结果，
 * 来回切不用重新请求。
 */
@HiltViewModel
class NcmParseViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    data class UiState(
        /** 0 关键词搜索 / 1 单曲 ID / 2 歌单 ID */
        val mode: Int = 0,
        val query: String = "",
        val searching: Boolean = false,
        val results: List<NcmSongDto> = emptyList(),
        val songInput: String = "",
        val parsing: Boolean = false,
        val parsed: NcmMusicDto? = null,
        val playlistInput: String = "",
        val playlistLoading: Boolean = false,
        val playlist: NcmPlaylistDto? = null,
        val error: String? = null,
    )

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    fun setMode(mode: Int) = _state.update { it.copy(mode = mode, error = null) }

    fun setQuery(value: String) = _state.update { it.copy(query = value, error = null) }

    fun setSongInput(value: String) = _state.update { it.copy(songInput = value, error = null) }

    fun setPlaylistInput(value: String) =
        _state.update { it.copy(playlistInput = value, error = null) }

    fun dismissError() = _state.update { it.copy(error = null) }

    /** 关键词搜索：相当于网页端「搜索」输入框 */
    fun search() {
        val keyword = _state.value.query.trim()
        if (keyword.isBlank()) return
        _state.update { it.copy(searching = true, error = null) }
        viewModelScope.launch {
            val songs = repo.ncmSearch(keyword, limit = 30)
            _state.update {
                it.copy(
                    searching = false,
                    results = songs,
                    error = if (songs.isEmpty()) "没搜到结果，换个关键词试试" else null,
                )
            }
        }
    }

    /**
     * 单曲解析：输入可以是纯 ID、带 id 参数的链接，或者整段分享文案。
     * 后端 utils.ExtractSongID 会自己做规范化，这里只把字符串传过去。
     */
    fun parseSong() {
        val raw = _state.value.songInput.trim()
        if (raw.isBlank()) return
        _state.update { it.copy(parsing = true, parsed = null, error = null) }
        viewModelScope.launch {
            val music = repo.parseMusic(extractSongId(raw))
            _state.update {
                it.copy(
                    parsing = false,
                    parsed = music,
                    error = when {
                        music == null -> "解析失败，请检查 ID 或链接"
                        music.displayUrl.isBlank() -> "解析到了曲目，但没拿到播放地址（可能无版权）"
                        else -> null
                    },
                )
            }
        }
    }

    fun parsePlaylist() {
        val raw = _state.value.playlistInput.trim()
        if (raw.isBlank()) return
        _state.update { it.copy(playlistLoading = true, playlist = null, error = null) }
        viewModelScope.launch {
            val detail = repo.ncmPlaylist(raw)
            _state.update {
                it.copy(
                    playlistLoading = false,
                    playlist = detail,
                    error = if (detail == null) "歌单解析失败，请检查 ID" else null,
                )
            }
        }
    }
}

/**
 * 从链接或分享文案里抠出纯数字 ID。
 * 纯数字直接返回；否则取 `id=xxx`，再退化为最长的一串数字。
 */
internal fun extractSongId(raw: String): String {
    val trimmed = raw.trim()
    if (trimmed.all { it.isDigit() } && trimmed.isNotEmpty()) return trimmed
    val idParam = Regex("[?&]id=(\\d+)").find(trimmed)
    if (idParam != null) return idParam.groupValues[1]
    val longest = Regex("\\d{5,}").findAll(trimmed).maxByOrNull { it.value.length }
    return longest?.value ?: trimmed
}
