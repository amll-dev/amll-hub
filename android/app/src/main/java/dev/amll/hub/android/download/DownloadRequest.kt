package dev.amll.hub.android.download

import kotlinx.serialization.Serializable

/** 一次下载需要的曲目元信息，作为 JSON 随 Intent 传给 [DownloadService]。 */
@Serializable
data class DownloadRequest(
    val songId: String,
    val name: String,
    val artists: String,
    val coverUrl: String? = null,
    val albumName: String = "",
    val level: String = "exhigh",
)
