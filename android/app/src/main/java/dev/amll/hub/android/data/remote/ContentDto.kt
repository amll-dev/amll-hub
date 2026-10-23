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

/** 投稿列表 GET /api/v1/submissions — 后端字段是 title/artist，不是 songName */
@Serializable
data class SubmissionDto(
    val id: Long = 0,
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val status: String = "",
    val language: String = "",
    val notes: String = "",
    val fileName: String = "",
    val ncmId: String = "",
    val submitter: String = "",
    val reviewComment: String = "",
    val hasRevision: Boolean = false,
    val revisionFileName: String = "",
    val createdAt: String = "",
    val updatedAt: String = "",
    val closedAt: String? = null,
) {
    val displayName: String get() = title.ifBlank { fileName }.ifBlank { "未命名稿件" }
}

@Serializable
data class SubmissionListDto(
    val items: List<SubmissionDto> = emptyList(),
    val total: Int = 0,
)

/** 投稿统计 GET /api/v1/submissions/stats */
@Serializable
data class SubmissionStatsDto(
    val pending: Int = 0,
    val reviewing: Int = 0,
    val approved: Int = 0,
    val rejected: Int = 0,
    val needRevision: Int = 0,
    val missingAudio: Int = 0,
    val closed: Int = 0,
    val draft: Int = 0,
    val revised: Int = 0,
) {
    /** 进行中：待审 + 审核中 + 需修改 + 缺音频 */
    val processing: Int get() = pending + reviewing + needRevision + missingAudio
    val total: Int get() = pending + reviewing + approved + rejected + draft + closed + revised
}

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

/** 网易云歌手 / 专辑，搜索结果里的嵌套结构 */
@Serializable
data class NcmArtistDto(val name: String = "")

@Serializable
data class NcmAlbumDto(
    val name: String = "",
    val picUrl: String = "",
)

/**
 * 网易云单曲 GET /api/v1/ncm/search
 *
 * 后端是 { code, message, data: { code, data: [song] } } 双层结构，
 * 字段名沿用上游（id 是数字、artists 是对象数组），不要按中文歌名猜。
 */
@Serializable
data class NcmSongDto(
    val id: Long = 0,
    val name: String = "",
    val songName: String = "",
    val picUrl: String = "",
    val artists: List<NcmArtistDto> = emptyList(),
    val album: NcmAlbumDto? = null,
    val fee: Int = 0,
    val alias: List<String> = emptyList(),
) {
    val displayName: String get() = name.ifBlank { songName }.ifBlank { "未知歌曲" }
    val displayArtist: String
        get() = artists.joinToString(" / ") { it.name }.ifBlank { "未知歌手" }
    val displayCover: String get() = picUrl.ifBlank { album?.picUrl.orEmpty() }
    val displayId: String get() = if (id > 0) id.toString() else ""
}

@Serializable
data class NcmSearchDto(
    val code: Int = 0,
    val data: List<NcmSongDto> = emptyList(),
) {
    val songs: List<NcmSongDto> get() = data
}

/** 歌单曲目（字段名与上游 models.Track 一致：ar / al / dt） */
@Serializable
data class NcmTrackDto(
    val id: Long = 0,
    val name: String = "",
    val ar: List<NcmArtistDto> = emptyList(),
    val al: NcmAlbumDto? = null,
    val dt: Long = 0,
) {
    val displayArtist: String get() = ar.joinToString(" / ") { it.name }.ifBlank { "未知歌手" }
    val displayCover: String get() = al?.picUrl.orEmpty()
    val displayId: String get() = if (id > 0) id.toString() else ""
}

@Serializable
data class NcmPlaylistDto(
    val id: Long = 0,
    val name: String = "",
    val coverImgUrl: String = "",
    val trackCount: Int = 0,
    val creator: NcmCreatorDto? = null,
    val tracks: List<NcmTrackDto> = emptyList(),
)

@Serializable
data class NcmCreatorDto(val nickname: String = "")

/** parse-playlist 的外层：{ code, playlist } */
@Serializable
data class NcmPlaylistWrapperDto(val playlist: NcmPlaylistDto? = null)

/**
 * parse-music 结果 GET /api/v1/ncm/parse-music
 *
 * 上游字段名不统一（url / name / ar_name / pic 各有别名），
 * 这里把所有别名都接住，取值走 displayXxx。
 */
@Serializable
data class NcmMusicDto(
    val url: String = "",
    val name: String = "",
    val songName: String = "",
    @SerialName("ar_name") val arName: String = "",
    val artistName: String = "",
    val pic: String = "",
    val cover: String = "",
    val coverUrl: String = "",
    val albumPic: String = "",
    val albumName: String = "",
    val duration: Long = 0,
    val dt: Long = 0,
    val level: String = "",
    val size: Long = 0,
    val lyric: String = "",
    val tlyric: String = "",
) {
    val displayUrl: String get() = url
    val displayName: String get() = name.ifBlank { songName }
    val displayArtist: String get() = arName.ifBlank { artistName }
    val displayCover: String
        get() = cover.ifBlank { coverUrl }.ifBlank { pic }.ifBlank { albumPic }
    val displayDuration: Long get() = if (dt > 0) dt else duration
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

/** 每日推荐投稿列表（创作中心） */
@Serializable
data class DailySubmissionListDto(
    val items: List<DailyRecDto> = emptyList(),
    val total: Int = 0,
)

/** 搜索 IP 投稿条目 */
@Serializable
data class SearchIpSubmissionDto(
    val id: Long = 0,
    val title: String = "",
    val status: String = "",
    val createdAt: String = "",
)

@Serializable
data class SearchIpListDto(
    val items: List<SearchIpSubmissionDto> = emptyList(),
    val total: Int = 0,
)

/** 单日活动 GET /api/v1/users/me/activity */
@Serializable
data class ActivityDayDto(
    val date: String = "",
    val count: Int = 0,
    val byType: Map<String, Int> = emptyMap(),
)

/** 年度活动聚合 GET /api/v1/users/me/activity?year= */
@Serializable
data class UserActivityDto(
    val year: Int = 0,
    val years: List<Int> = emptyList(),
    val days: List<ActivityDayDto> = emptyList(),
    val total: Int = 0,
    val byType: Map<String, Int> = emptyMap(),
)
