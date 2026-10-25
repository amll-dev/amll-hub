package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.remote.NcmMusicDto
import dev.amll.hub.android.playback.NcmQuality
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 音源解析：按用户选择的音质请求，拿不到链接且请求不是 standard 时
 * 自动退到 standard 再试一次。实际拿到的音质交给 UI 判断是否已降级。
 */
@Singleton
class PlaybackRepository @Inject constructor(
    private val repo: ContentRepository,
) {

    data class Resolved(
        val music: NcmMusicDto?,
        val error: String?,
        val requested: NcmQuality,
        val actual: NcmQuality?,
    )

    suspend fun resolve(songId: String, level: String = "exhigh"): Resolved {
        val requested = NcmQuality.fromKey(level)
            ?: NcmQuality.normalizeLevel(level)
            ?: NcmQuality.EXHIGH
        var parseError: String? = null
        var music = repo.parseMusic(songId, level)
            .onFailure { parseError = it.message }
            .getOrNull()
        if (music?.displayUrl.isNullOrBlank() && requested != NcmQuality.STANDARD) {
            music = repo.parseMusic(songId, level = NcmQuality.STANDARD.key)
                .onFailure { parseError = it.message }
                .getOrNull()
        }
        return Resolved(
            music = music,
            error = parseError,
            requested = requested,
            actual = NcmQuality.normalizeLevel(music?.level),
        )
    }
}
