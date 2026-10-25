package dev.amll.hub.android.data.remote

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

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
    @Serializable(with = FlexibleDuration::class) val duration: Long = 0,
    @Serializable(with = FlexibleDuration::class) val dt: Long = 0,
) {
    val displayName: String get() = name.ifBlank { songName }.ifBlank { "未知歌曲" }
    val displayArtist: String
        get() = artists.joinToString(" / ") { it.name }.ifBlank { "未知歌手" }
    val displayCover: String
        get() = httpsCover(picUrl.ifBlank { album?.picUrl.orEmpty() })
    val displayId: String get() = if (id > 0) id.toString() else ""
    val displayDuration: Long get() = if (dt > 0) dt else duration
    val displayAlbum: String get() = album?.name.orEmpty()
}

/**
 * 网易云上游的数字字段不稳定：同一个字段有时是数字、有时是字符串
 * （实测 parse-music 的 size 是 "7.23MB"，search 的 alias 可能是 ""）。
 * 这个序列化器两种都接：字符串取前导数字，非数字给 0。
 */
object FlexibleLong : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleLong", PrimitiveKind.LONG)

    override fun deserialize(decoder: Decoder): Long {
        val primitive = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive
            ?: return decoder.decodeLong()
        val raw = primitive.content.trim()
        if (primitive.isString) {
            val leading = Regex("^[0-9]+").find(raw) ?: return 0L
            return leading.value.toLongOrNull() ?: 0L
        }
        return raw.toLongOrNull() ?: raw.toDoubleOrNull()?.toLong() ?: 0L
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }
}

/**
 * 时长字段有两种形态：搜索接口返回 "04:12" 这种字符串，
 * 其它接口返回毫秒数字。统一归一成毫秒，避免 FlexibleLong
 * 把 "04:12" 取成 4 毫秒。
 */
object FlexibleDuration : KSerializer<Long> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("FlexibleDuration", PrimitiveKind.LONG)

    private val COLON = Regex("^(\\d{1,3}):(\\d{1,2})(?::(\\d{1,2}))?$")

    override fun deserialize(decoder: Decoder): Long {
        val primitive = (decoder as? JsonDecoder)?.decodeJsonElement() as? JsonPrimitive
            ?: return decoder.decodeLong()
        val raw = primitive.content.trim()
        COLON.matchEntire(raw)?.let { match ->
            val first = match.groupValues[1].toLongOrNull() ?: return 0L
            val second = match.groupValues[2].toLongOrNull() ?: return 0L
            val third = match.groupValues[3].takeIf { it.isNotEmpty() }?.toLongOrNull()
            return if (third == null) {
                first * 60_000 + second * 1_000
            } else {
                first * 3_600_000 + second * 60_000 + third * 1_000
            }
        }
        return raw.toLongOrNull() ?: raw.toDoubleOrNull()?.toLong() ?: 0L
    }

    override fun serialize(encoder: Encoder, value: Long) {
        encoder.encodeLong(value)
    }
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
    @Serializable(with = FlexibleLong::class) val dt: Long = 0,
) {
    val displayArtist: String get() = ar.joinToString(" / ") { it.name }.ifBlank { "未知歌手" }
    val displayCover: String get() = httpsCover(al?.picUrl.orEmpty())
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
    @Serializable(with = FlexibleLong::class) val duration: Long = 0,
    @Serializable(with = FlexibleLong::class) val dt: Long = 0,
    val level: String = "",
    /** 上游实测返回的是 "7.23MB" 这种字符串，不能声明成 Long */
    val size: String = "",
    val lyric: String = "",
    val tlyric: String = "",
) {
    val displayUrl: String get() = url
    val displayName: String get() = name.ifBlank { songName }
    val displayArtist: String get() = arName.ifBlank { artistName }
    val displayCover: String
        get() = httpsCover(cover.ifBlank { coverUrl }.ifBlank { pic }.ifBlank { albumPic })
    val displayDuration: Long get() = if (dt > 0) dt else duration
}

/**
 * 网易云图片地址统一升级到 HTTPS。
 * 上游搜索接口常返回 http://p1.music.126.net/…，生产包禁止明文请求，
 * 不升级会导致封面 URL 存在但图片加载失败（列表只剩灰块）。
 */
internal fun httpsCover(url: String): String =
    if (url.startsWith("http://")) "https://" + url.removePrefix("http://") else url

@Serializable
data class LikeStatusDto(val liked: Boolean = false, val likeCount: Int = 0)

/* ===== 投稿相关 ===== */

/** POST /api/v1/submissions/validate 返回（字段名与后端 TtmlValidateResult 一致） */
@Serializable
data class TtmlValidationDto(
    val valid: Boolean = false,
    val errors: List<String> = emptyList(),
    val parseError: String = "",
    val regeneratedTtml: String = "",
    val metadata: JsonObject = JsonObject(emptyMap()),
) {
    /** TTML 元数据里的标题列表，用于创建投稿时的 title */
    val titles: List<String> get() = metadata.stringValues("title")
    val language: String get() = metadata["language"]?.jsonString().orEmpty()
}

/** POST /api/v1/submissions 入参，metadata 直接沿用校验结果的 snake_case 结构 */
@Serializable
data class CreateSubmissionRequest(
    val title: String,
    val metadata: JsonObject,
    val fileName: String,
    val notes: String? = null,
    val tags: List<String>? = null,
    val language: String? = null,
    val languages: List<String>? = null,
    val status: String = "pending",
)

/** 通用 { id } / { tempKey } / { fileName } / { available } 返回 */
@Serializable
data class IdDto(val id: Long = 0)

@Serializable
data class TempKeyDto(val tempKey: String = "")

@Serializable
data class UploadedFileDto(val fileName: String = "")

@Serializable
data class DateAvailabilityDto(val available: Boolean = true)

@Serializable
data class UrlRequest(val url: String)

/** POST /api/v1/daily-recommendations 入参（后端用 PostForm 读取） */
data class CreateDailyRecRequest(
    val songName: String,
    val artist: String,
    val coverTempKey: String,
    val date: String,
    val comment: String,
    val ncmId: String? = null,
)

private fun JsonObject.stringValues(key: String): List<String> =
    (this[key] as? JsonArray)
        ?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
        ?.filter { it.isNotBlank() }
        .orEmpty()

private fun kotlinx.serialization.json.JsonElement.jsonString(): String? =
    (this as? JsonPrimitive)?.contentOrNull

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
