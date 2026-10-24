package dev.amll.hub.android.ui.screen

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import dev.amll.hub.android.data.remote.CreateSubmissionRequest
import dev.amll.hub.android.data.remote.TtmlValidationDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import java.util.Locale
import javax.inject.Inject

/** 本地选中的文件（TTML / 音源） */
data class PickedFile(
    val uri: Uri,
    val name: String,
    val size: Long = 0,
    val mime: String = "",
)

/**
 * 歌词投稿：对齐网页端 LyricSubmitForm 的核心流程
 * （TTML 选择 → /validate 校验 → 语言/标签/备注 → 上传 TTML → 创建投稿 → 上传音源）。
 */
@HiltViewModel
class LyricSubmitViewModel @Inject constructor(
    private val repo: ContentRepository,
    @ApplicationContext private val context: Context,
) : ViewModel() {

    data class UiState(
        val fileName: String = "",
        val validating: Boolean = false,
        val validation: TtmlValidationDto? = null,
        val validateError: String? = null,
        val notes: String = "",
        val languages: List<String> = emptyList(),
        val otherLanguages: List<String> = emptyList(),
        val otherLangInput: String = "",
        val tags: List<String> = emptyList(),
        val tagInput: String = "",
        val agreed: Boolean = false,
        val audioFiles: List<PickedFile> = emptyList(),
        val submitting: Boolean = false,
        val audioProgress: String = "",
        val message: String? = null,
        val messageIsError: Boolean = false,
        val successId: Long? = null,
    ) {
        val languagesText: List<String> get() = languages + otherLanguages
        val canSubmit: Boolean
            get() = fileName.isNotBlank() && validation?.valid == true && !submitting
    }

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private var ttmlUri: Uri? = null

    fun setNotes(value: String) = _state.update { it.copy(notes = value) }

    fun setTagInput(value: String) = _state.update { it.copy(tagInput = value) }

    fun setOtherLangInput(value: String) = _state.update { it.copy(otherLangInput = value) }

    fun setAgreed(value: Boolean) = _state.update { it.copy(agreed = value) }

    fun dismissMessage() = _state.update { it.copy(message = null) }

    fun pickTtml(uri: Uri) {
        ttmlUri = uri
        val name = displayName(uri)
        _state.update {
            it.copy(
                fileName = name,
                validating = true,
                validation = null,
                validateError = null,
                message = null,
            )
        }
        viewModelScope.launch {
            val text = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                    .getOrNull()
            }
            if (text == null) {
                _state.update { it.copy(validating = false, validateError = "读取文件失败") }
                return@launch
            }
            val content = text.toString(Charsets.UTF_8)
            repo.validateTtml(content)
                .onSuccess { result ->
                    val autoLanguage = languageCode(result.language)
                    _state.update { current ->
                        current.copy(
                            validating = false,
                            validation = result,
                            validateError = null,
                            // 与网页端一致：自动识别语言，但只补第一次，不覆盖已选
                            languages = if (current.languages.isEmpty() && autoLanguage != null) {
                                listOf(autoLanguage)
                            } else {
                                current.languages
                            },
                        )
                    }
                }
                .onFailure { e ->
                    _state.update {
                        it.copy(validating = false, validateError = e.message ?: "校验失败")
                    }
                }
        }
    }

    fun toggleLanguage(code: String) {
        _state.update { current ->
            val exists = code in current.languages
            when {
                exists -> current.copy(
                    languages = current.languages - code,
                    // 取消「其他」时连带清掉自定义语言
                    otherLanguages = if (code == "others") emptyList() else current.otherLanguages,
                )
                current.languagesText.size >= MAX_LANGUAGES -> current
                else -> current.copy(languages = current.languages + code)
            }
        }
    }

    fun addOtherLanguage() {
        _state.update { current ->
            val value = current.otherLangInput.trim()
            when {
                value.isEmpty() -> current
                value in current.otherLanguages -> current.copy(otherLangInput = "")
                current.languagesText.size >= MAX_LANGUAGES -> current
                else -> current.copy(
                    otherLanguages = current.otherLanguages + value,
                    otherLangInput = "",
                )
            }
        }
    }

    fun removeOtherLanguage(value: String) {
        _state.update { it.copy(otherLanguages = it.otherLanguages - value) }
    }

    fun addTag() {
        _state.update { current ->
            val value = current.tagInput.trim()
            when {
                value.isEmpty() -> current
                value in current.tags -> current.copy(tagInput = "")
                else -> current.copy(tags = current.tags + value, tagInput = "")
            }
        }
    }

    fun removeTag(value: String) {
        _state.update { it.copy(tags = it.tags - value) }
    }

    fun addAudio(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val picked = uris.map { uri ->
            PickedFile(
                uri = uri,
                name = displayName(uri),
                size = fileSize(uri),
                mime = context.contentResolver.getType(uri).orEmpty(),
            )
        }
        _state.update { it.copy(audioFiles = it.audioFiles + picked, message = null) }
    }

    fun removeAudio(uri: Uri) {
        _state.update { it.copy(audioFiles = it.audioFiles.filterNot { item -> item.uri == uri }) }
    }

    fun resetFile() {
        ttmlUri = null
        _state.update {
            it.copy(
                fileName = "",
                validation = null,
                validateError = null,
                validating = false,
            )
        }
    }

    /** draft=true 存草稿，否则提交审核 */
    fun submit(draft: Boolean) {
        val current = _state.value
        if (current.submitting) return
        val uri = ttmlUri ?: return
        if (current.validation?.valid != true) return
        if (!draft && !current.agreed) return

        viewModelScope.launch {
            _state.update { it.copy(submitting = true, message = null, audioProgress = "") }
            val bytes = withContext(Dispatchers.IO) {
                runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }
                    .getOrNull()
            }
            if (bytes == null) {
                _state.update { it.copy(submitting = false, message = "读取文件失败", messageIsError = true) }
                return@launch
            }

            val upload = repo.uploadTtml(current.fileName, bytes)
            val uploadedName = upload.getOrElse { e ->
                val failure = e.message ?: "文件上传失败"
                _state.update {
                    it.copy(submitting = false, message = failure, messageIsError = true)
                }
                return@launch
            }

            val validation = current.validation
            val title = validation?.titles?.firstOrNull()?.takeIf { it.isNotBlank() }
                ?: current.fileName.removeSuffix(".ttml").ifBlank { "未命名稿件" }
            val languages = current.languagesText
            val request = CreateSubmissionRequest(
                title = title,
                metadata = validation?.metadata ?: JsonObject(emptyMap()),
                fileName = uploadedName,
                notes = current.notes.trim().takeIf { it.isNotEmpty() },
                tags = current.tags.takeIf { it.isNotEmpty() },
                language = languages.firstOrNull(),
                languages = languages.takeIf { it.isNotEmpty() },
                status = if (draft) "draft" else "pending",
            )
            val created = repo.createSubmission(request).getOrElse { e ->
                _state.update {
                    it.copy(submitting = false, message = e.message ?: "投稿失败", messageIsError = true)
                }
                return@launch
            }

            // 音源为可选附件：单个失败不影响投稿本身，与网页端一致
            val failures = mutableListOf<String>()
            current.audioFiles.forEachIndexed { index, audio ->
                _state.update {
                    it.copy(audioProgress = "正在上传音源 ${index + 1}/${current.audioFiles.size}")
                }
                val audioBytes = withContext(Dispatchers.IO) {
                    runCatching {
                        context.contentResolver.openInputStream(audio.uri)?.use { input -> input.readBytes() }
                    }.getOrNull()
                }
                val mime = audio.mime.takeIf { it.isNotBlank() } ?: "audio/mpeg"
                if (audioBytes == null ||
                    repo.uploadAudio(created, audio.name, audioBytes, mime).isFailure
                ) {
                    failures += audio.name
                }
            }

            val message = when {
                failures.isNotEmpty() ->
                    "${if (draft) "草稿已保存" else "投稿已创建"}，但 ${failures.size} 个音源上传失败" +
                        "（${failures.joinToString("、")}），可在详情页补传"
                draft -> "草稿已保存"
                else -> "投稿成功"
            }
            _state.update {
                it.copy(
                    submitting = false,
                    audioProgress = "",
                    message = message,
                    messageIsError = failures.isNotEmpty(),
                    successId = created,
                )
            }
        }
    }

    private fun displayName(uri: Uri): String {
        val fromResolver = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { cursor ->
                    if (cursor.moveToFirst()) cursor.getString(0) else null
                }
        }.getOrNull()
        return fromResolver?.takeIf { it.isNotBlank() }
            ?: uri.lastPathSegment?.substringAfterLast('/')?.takeIf { it.isNotBlank() }
            ?: "文件"
    }

    private fun fileSize(uri: Uri): Long = runCatching {
        context.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)
            ?.use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else 0L }
            ?: 0L
    }.getOrDefault(0L)

    companion object {
        /** 与后端 model.MaxLanguages 一致 */
        const val MAX_LANGUAGES = 10

        /** TTML 元数据语言码 → 后端枚举；识别不了就交给用户手选 */
        fun languageCode(raw: String): String? {
            val value = raw.trim().lowercase(Locale.ROOT)
            if (value.isEmpty()) return null
            return when {
                value.startsWith("zh") || value == "cn" || value == "chs" || value == "zh_cn" -> "zh"
                value.startsWith("en") -> "en"
                value.startsWith("ja") || value == "jp" -> "ja"
                value.startsWith("ko") || value == "kr" -> "ko"
                else -> null
            }
        }
    }
}
