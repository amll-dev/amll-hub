package dev.amll.hub.android.ui.screen

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.data.remote.CreateDailyRecRequest
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import javax.inject.Inject

/**
 * 每日推荐投稿：对齐网页端 DailyRecommendForm
 * （网易云搜索回填 / 封面自动抓取或相册上传 / 日期查重 / 推荐语标记 / 提交）。
 */
@HiltViewModel
class DailySubmitViewModel @Inject constructor(
    private val repo: ContentRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    data class UiState(
        val date: String = LocalDate.now().toString(),
        val dateChecking: Boolean = false,
        val dateAvailable: Boolean = true,
        val ncmQuery: String = "",
        val ncmSearching: Boolean = false,
        val ncmResults: List<NcmSongDto> = emptyList(),
        val parseSearching: Boolean = false,
        val songName: String = "",
        val artist: String = "",
        val ncmId: String = "",
        /** 预览地址：相册内容 URI 或网易云远程 URL */
        val coverPreview: String = "",
        val coverTempKey: String = "",
        val coverUploading: Boolean = false,
        val coverError: String = "",
        val comment: String = "",
        val submitting: Boolean = false,
        val message: String? = null,
        val messageIsError: Boolean = false,
        val successDate: String? = null,
    ) {
        val canSubmit: Boolean
            get() = date.isNotBlank() &&
                dateAvailable &&
                songName.isNotBlank() &&
                artist.isNotBlank() &&
                comment.isNotBlank() &&
                coverTempKey.isNotBlank() &&
                !coverUploading &&
                !submitting
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var dateJob: Job? = null
    private var searchJob: Job? = null

    init {
        checkDate(_state.value.date)
    }

    fun setDate(value: String) {
        _state.update { it.copy(date = value, message = null) }
        checkDate(value)
    }

    fun setNcmQuery(value: String) =
        _state.update { it.copy(ncmQuery = value, message = null) }

    fun setSongName(value: String) = _state.update { it.copy(songName = value) }

    fun setArtist(value: String) = _state.update { it.copy(artist = value) }

    fun setNcmId(value: String) = _state.update { it.copy(ncmId = value) }

    fun setComment(value: String) = _state.update { it.copy(comment = value) }

    fun dismissMessage() = _state.update { it.copy(message = null) }

    fun searchNcm() {
        val keyword = _state.value.ncmQuery.trim()
        if (keyword.isEmpty()) return
        searchJob?.cancel()
        _state.update { it.copy(ncmSearching = true, message = null) }
        searchJob = viewModelScope.launch {
            repo.ncmSearch(keyword, limit = 8)
                .onSuccess { songs ->
                    _state.update {
                        it.copy(
                            ncmSearching = false,
                            ncmResults = songs,
                            message = if (songs.isEmpty()) "没有找到相关歌曲" else null,
                            messageIsError = songs.isEmpty(),
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            ncmSearching = false,
                            message = e.message ?: "搜索失败",
                            messageIsError = true,
                        )
                    }
                }
        }
    }

    /** 选中搜索结果：回填并自动抓取封面 */
    fun pickNcmSong(song: NcmSongDto) {
        _state.update {
            it.copy(
                songName = song.displayName,
                artist = song.displayArtist,
                ncmId = song.displayId,
                ncmQuery = "",
                ncmResults = emptyList(),
                message = null,
            )
        }
        val cover = song.displayCover
        if (cover.isNotBlank()) fetchCoverFromUrl(cover)
    }

    /** 通过 ID / 链接解析歌曲信息并自动抓取封面 */
    fun parseNcmId() {
        val id = extractSongId(_state.value.ncmId)
        if (id.isBlank()) {
            _state.update { it.copy(message = "请输入有效的网易云 ID 或歌曲链接", messageIsError = true) }
            return
        }
        _state.update { it.copy(parseSearching = true, message = null) }
        viewModelScope.launch {
            repo.parseMusic(id, level = "standard")
                .onSuccess { music ->
                    _state.update {
                        it.copy(
                            parseSearching = false,
                            songName = music.displayName.ifBlank { music.songName },
                            artist = music.displayArtist.ifBlank { music.artistName },
                            ncmId = id,
                        )
                    }
                    val cover = music.displayCover
                    if (cover.isNotBlank()) fetchCoverFromUrl(cover)
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            parseSearching = false,
                            message = e.message ?: "解析失败",
                            messageIsError = true,
                        )
                    }
                }
        }
    }

    /** 相册选图：先预览再上传临时区 */
    fun pickCover(uri: Uri) {
        _state.update {
            it.copy(
                coverPreview = uri.toString(),
                coverTempKey = "",
                coverUploading = true,
                coverError = "",
                message = null,
            )
        }
        viewModelScope.launch {
            val bytes = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                    .getOrNull()
            }
            if (bytes == null) {
                _state.update { it.copy(coverUploading = false, coverError = "读取图片失败") }
                return@launch
            }
            val name = displayName(uri)
            val mime = context.contentResolver.getType(uri).orEmpty().ifBlank { "image/jpeg" }
            repo.uploadDailyCover(name, bytes, mime)
                .onSuccess { key ->
                    _state.update {
                        it.copy(coverTempKey = key, coverUploading = false, coverError = "")
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            coverUploading = false,
                            coverError = e.message ?: "封面上传失败",
                        )
                    }
                }
        }
    }

    fun removeCover() {
        _state.update {
            it.copy(coverPreview = "", coverTempKey = "", coverUploading = false, coverError = "")
        }
    }

    fun submit() {
        val current = _state.value
        if (!current.canSubmit) return
        viewModelScope.launch {
            _state.update { it.copy(submitting = true, message = null) }
            repo.createDailyRecommendation(
                CreateDailyRecRequest(
                    songName = current.songName.trim(),
                    artist = current.artist.trim(),
                    coverTempKey = current.coverTempKey,
                    date = current.date,
                    comment = current.comment,
                    ncmId = current.ncmId.trim().takeIf { it.isNotEmpty() },
                ),
            )
                .onSuccess { id ->
                    _state.update {
                        it.copy(
                            submitting = false,
                            message = "投稿成功！",
                            messageIsError = false,
                            successDate = current.date,
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            submitting = false,
                            message = e.message ?: "投稿失败",
                            messageIsError = true,
                        )
                    }
                }
        }
    }

    private fun fetchCoverFromUrl(url: String) {
        _state.update {
            it.copy(
                coverPreview = url,
                coverTempKey = "",
                coverUploading = true,
                coverError = "",
                message = null,
            )
        }
        viewModelScope.launch {
            repo.uploadDailyCoverFromUrl(url)
                .onSuccess { key ->
                    _state.update {
                        it.copy(coverTempKey = key, coverUploading = false, coverError = "")
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(
                            coverUploading = false,
                            coverError = e.message ?: "封面自动载入失败",
                            message = "封面自动载入失败，请手动上传",
                            messageIsError = true,
                        )
                    }
                }
        }
    }

    private fun checkDate(date: String) {
        dateJob?.cancel()
        _state.update { it.copy(dateChecking = true) }
        dateJob = viewModelScope.launch {
            repo.checkDailyDate(date)
                .onSuccess { available ->
                    _state.update { it.copy(dateChecking = false, dateAvailable = available) }
                }
                .onFailure {
                    // 与网页端一致：查重失败不阻塞投稿
                    _state.update { it.copy(dateChecking = false, dateAvailable = true) }
                }
        }
    }

    private fun displayName(uri: Uri): String {
        val fromResolver = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor -> if (cursor.moveToFirst()) cursor.getString(0) else null }
        }.getOrNull()
        return fromResolver?.takeIf { it.isNotBlank() } ?: "cover.jpg"
    }
}
