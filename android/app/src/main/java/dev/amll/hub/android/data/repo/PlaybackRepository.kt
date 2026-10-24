package dev.amll.hub.android.data.repo

import dev.amll.hub.android.data.remote.NcmMusicDto
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 音源解析：exhigh 要 VIP，VIP 歌解析不到就退到 standard 再试一次。
 * 解析失败的原因留着，给播放条显示「为什么没声音」。
 */
@Singleton
class PlaybackRepository @Inject constructor(
    private val repo: ContentRepository,
) {

    data class Resolved(
        val music: NcmMusicDto?,
        val error: String?,
    )

    suspend fun resolve(songId: String): Resolved {
        var parseError: String? = null
        var music = repo.parseMusic(songId)
            .onFailure { parseError = it.message }
            .getOrNull()
        if (music?.displayUrl.isNullOrBlank()) {
            music = repo.parseMusic(songId, level = "standard")
                .onFailure { parseError = it.message }
                .getOrNull()
        }
        return Resolved(music, parseError)
    }
}
