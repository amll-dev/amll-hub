package dev.amll.hub.android.data.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** 词库统计 GET /api/v1/stats */
@Serializable
data class StatsDto(
    val totalSongs: Long = 0,
    val totalArtists: Long = 0,
    val totalAlbums: Long = 0,
    val totalWords: Long = 0,
    val totalLines: Long = 0,
    val lastSyncAt: String = "",
)

/** 最新收录 GET /api/v1/latest-songs */
@Serializable
data class LatestSongDto(
    val id: Long = 0,
    val songId: Long = 0,
    val ncmId: String = "",
    val title: String = "",
    val artist: String = "",
    val coverUrl: String = "",
)

/** 每日推荐 GET /api/v1/daily-recommendations */
@Serializable
data class DailyRecDto(
    val id: Long = 0,
    val date: String = "",
    val songName: String = "",
    val artist: String = "",
    val coverKey: String = "",
    val ncmId: String = "",
    val comment: String = "",
    val submitter: String = "",
    val likeCount: Int = 0,
    val status: String = "",
)

/** 无歌词排行 GET /api/v1/not-found-ranking */
@Serializable
data class RankingItemDto(
    val id: Long = 0,
    val platform: String = "",
    val platformId: String = "",
    val songName: String = "",
    val artists: List<String> = emptyList(),
    val cover: String = "",
    val album: String = "",
    val requestCount: Int = 0,
    val lastSeenAt: String = "",
)

@Serializable
data class RankingResultDto(
    val total: Int = 0,
    val days: Int = 7,
    val items: List<RankingItemDto> = emptyList(),
)

/** 站内消息 GET /api/v1/notifications */
@Serializable
data class MessageDto(
    val id: Long = 0,
    val type: String = "",
    val title: String = "",
    val content: String = "",
    val read: Boolean = false,
    val createdAt: String = "",
)

@Serializable
data class NotificationListDto(
    val items: List<MessageDto> = emptyList(),
    val total: Int = 0,
    val unread: Int = 0,
)

@Serializable
data class UnreadDto(val unread: Int = 0)

/** 投稿列表 GET /api/v1/submissions */
@Serializable
data class SubmissionDto(
    val id: Long = 0,
    val songName: String = "",
    @SerialName("song_name") val songNameSnake: String = "",
    val artist: String = "",
    val status: String = "",
    val type: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
) {
    val displayName: String get() = songName.ifBlank { songNameSnake }
}

@Serializable
data class SubmissionListDto(
    val items: List<SubmissionDto> = emptyList(),
    val total: Int = 0,
)

/** 词库搜索 GET /api/v1/search */
@Serializable
data class SearchHitDto(
    val id: String = "",
    val musicNames: List<String> = emptyList(),
    val artists: List<String> = emptyList(),
    val albums: List<String> = emptyList(),
    val platformIds: Map<String, List<String>> = emptyMap(),
    val rawLyricFile: String = "",
    val wordCount: Int = 0,
    val lineCount: Int = 0,
    val lyricSnippet: String = "",
)

@Serializable
data class SearchResultDto(
    val hits: List<SearchHitDto> = emptyList(),
    val totalHits: Int = 0,
)

/** 网易云搜索 GET /api/v1/ncm/search（字段名做兼容） */
@Serializable
data class NcmSongDto(
    val id: String = "",
    val songId: String = "",
    val name: String = "",
    val songName: String = "",
    val artist: String = "",
    val artists: String = "",
    val arName: String = "",
    val pic: String = "",
    val cover: String = "",
    val duration: Long = 0,
) {
    val displayName: String get() = name.ifBlank { songName }
    val displayArtist: String get() = artist.ifBlank { artists }.ifBlank { arName }
    val displayCover: String get() = pic.ifBlank { cover }
    val displayId: String get() = id.ifBlank { songId }
}

@Serializable
data class NcmSearchDto(
    val songs: List<NcmSongDto> = emptyList(),
    val items: List<NcmSongDto> = emptyList(),
    val result: List<NcmSongDto> = emptyList(),
) {
    val all: List<NcmSongDto> get() = songs.ifEmpty { items.ifEmpty { result } }
}

@Serializable
data class LikeStatusDto(val liked: Boolean = false, val likeCount: Int = 0)

@Serializable
data class UpdatedDto(val updated: Int = 0)

@Serializable
data class ProfileUpdateRequest(
    val displayName: String? = null,
    val email: String? = null,
    val avatar: String? = null,
)

/** ncm 解析结果（裸 JSON，非统一包装），字段名做兼容 */
@Serializable
data class NcmParseDto(
    val url: String = "",
    val songId: String = "",
    val name: String = "",
    val artist: String = "",
    val pic: String = "",
    val level: String = "",
)
