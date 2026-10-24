package dev.amll.hub.android.ui.screen

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import dev.amll.hub.android.data.remote.NcmSongDto
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.CoverImage
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.MarkupText
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

/* ============================ 每日推荐投稿 ============================ */

private val MARKUP_SHORTCUTS = listOf(
    "居中" to "[:-:]",
    "左对齐" to "[:-]",
    "右对齐" to "[-:]",
    "小字居中" to "[:_:]",
    "小字左" to "[:_]",
    "小字右" to "[_:]",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DailySubmitScreen(
    nav: AppNav,
    dailyVm: DailyViewModel,
    vm: DailySubmitViewModel = hiltViewModel(),
) {
    val ui by vm.state.collectAsStateWithLifecycle()
    var showDatePicker by remember { mutableStateOf(false) }

    val coverPicker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        uri?.let(vm::pickCover)
    }

    // 投稿成功后跳到每日推荐页对应日期（对齐网页端）
    LaunchedEffect(ui.successDate) {
        val date = ui.successDate ?: return@LaunchedEffect
        dailyVm.pendingSelectDate = date
        delay(700)
        nav.finishSubmitToDaily()
    }

    if (showDatePicker) {
        val initialMillis = runCatching {
            LocalDate.parse(ui.date).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
        }.getOrNull()
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        val date = Instant.ofEpochMilli(millis).atZone(ZoneOffset.UTC).toLocalDate()
                        vm.setDate(date.toString())
                    }
                    showDatePicker = false
                }) { Text("确定") }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text("取消") }
            },
        ) { DatePicker(state = pickerState) }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            AmllTopBar("每日推荐投稿", onBack = nav.back)

            // 网易云搜索
            SectionHeader("从网易云搜索填表")
            AmllCard(padding = 16.dp) {
                AmllTextField(
                    value = ui.ncmQuery,
                    onValueChange = vm::setNcmQuery,
                    placeholder = "输入歌名 / 歌手搜索",
                    imeAction = ImeAction.Search,
                    onImeAction = vm::searchNcm,
                )
                PrimaryButton(
                    text = if (ui.ncmSearching) "搜索中…" else "搜索",
                    onClick = vm::searchNcm,
                    modifier = Modifier.padding(top = 10.dp),
                    enabled = ui.ncmQuery.isNotBlank() && !ui.ncmSearching,
                )
                ui.ncmResults.forEach { song ->
                    NcmPickRow(song) { vm.pickNcmSong(song) }
                }
            }

            // 网易云 ID 解析
            SectionHeader("网易云 ID（可选）")
            AmllCard(padding = 16.dp) {
                AmllTextField(
                    value = ui.ncmId,
                    onValueChange = vm::setNcmId,
                    placeholder = "歌曲 ID 或歌曲链接",
                    imeAction = ImeAction.Done,
                    onImeAction = vm::parseNcmId,
                )
                PrimaryButton(
                    text = if (ui.parseSearching) "解析中…" else "解析并回填",
                    onClick = vm::parseNcmId,
                    modifier = Modifier.padding(top = 10.dp),
                    enabled = ui.ncmId.isNotBlank() && !ui.parseSearching,
                )
            }

            SectionHeader("歌曲信息")
            AmllCard(padding = 16.dp) {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    AmllTextField(
                        value = ui.songName,
                        onValueChange = vm::setSongName,
                        placeholder = "音乐名称（必填）",
                    )
                    AmllTextField(
                        value = ui.artist,
                        onValueChange = vm::setArtist,
                        placeholder = "歌手（必填）",
                    )
                }
            }

            SectionHeader("封面")
            AmllCard(padding = 16.dp) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                    Box(
                        Modifier
                            .size(104.dp)
                            .clip(RoundedCornerShape(Radius.field))
                            .background(Amll.colors.surface2)
                            .border(1.dp, Amll.colors.border, RoundedCornerShape(Radius.field)),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (ui.coverPreview.isNotBlank()) {
                            AsyncImage(
                                model = ui.coverPreview,
                                contentDescription = "封面预览",
                                contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                                modifier = Modifier.fillMaxSize(),
                            )
                        } else {
                            Icon(
                                Icons.Rounded.Image,
                                null,
                                tint = Amll.colors.ink3,
                                modifier = Modifier.size(28.dp),
                            )
                        }
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(
                            when {
                                ui.coverUploading -> "上传中…"
                                ui.coverTempKey.isNotBlank() -> "上传完成"
                                else -> "建议上传正方形封面"
                            },
                            style = Font.caption,
                            color = if (ui.coverTempKey.isNotBlank()) Amll.colors.success else Amll.colors.ink3,
                        )
                        if (ui.coverError.isNotBlank()) {
                            Text(ui.coverError, style = Font.micro, color = Amll.colors.error)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            SmallAction("从相册选择", Amll.colors.ink2) { coverPicker.launch("image/*") }
                            if (ui.coverPreview.isNotBlank()) {
                                SmallAction("删除", Amll.colors.warning, vm::removeCover)
                            }
                        }
                    }
                }
            }

            SectionHeader("推荐日期")
            AmllCard(padding = 16.dp) {
                FieldRow("日期", ui.date, onClick = { showDatePicker = true })
                Text(
                    when {
                        ui.dateChecking -> "正在检查日期可用性…"
                        !ui.dateAvailable -> "该日期已被占用，请选择其他日期"
                        else -> "该日期可用"
                    },
                    style = Font.micro,
                    color = when {
                        ui.dateChecking -> Amll.colors.ink3
                        !ui.dateAvailable -> Amll.colors.error
                        else -> Amll.colors.success
                    },
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            SectionHeader("推荐语")
            CommentField(
                comment = ui.comment,
                onCommentChange = vm::setComment,
            )
            if (ui.comment.trim().isNotEmpty()) {
                Text("实时预览：", style = Font.micro, color = Amll.colors.ink3)
                AmllCard(padding = 16.dp) { MarkupText(ui.comment, emptyText = "") }
            }

            ui.message?.let {
                Text(
                    it,
                    style = Font.caption,
                    color = if (ui.messageIsError) Amll.colors.error else Amll.colors.success,
                )
            }

            PrimaryButton(
                text = if (ui.submitting) "提交中…" else "立即投稿",
                onClick = vm::submit,
                enabled = ui.canSubmit,
            )
        }
    }
}

@Composable
private fun NcmPickRow(song: NcmSongDto, onClick: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(top = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        CoverImage(song.displayCover.ifBlank { null }, song.displayName, 40.dp)
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                song.displayName,
                style = Font.bodySmall,
                color = Amll.colors.ink,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                song.displayArtist,
                style = Font.micro,
                color = Amll.colors.ink3,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun SmallAction(label: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(999.dp))
            .border(1.dp, Amll.colors.border, RoundedCornerShape(999.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Text(label, style = Font.micro, color = color)
    }
}

/** 推荐语输入：保留 TextFieldValue 以便标记按钮在光标处插入 */
@Composable
private fun CommentField(
    comment: String,
    onCommentChange: (String) -> Unit,
) {
    var value by remember { mutableStateOf(TextFieldValue(comment, TextRange(comment.length))) }
    // 外部（清空/提交后）变化时同步回来
    LaunchedEffect(comment) {
        if (comment != value.text) value = TextFieldValue(comment, TextRange(comment.length))
    }

    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MARKUP_SHORTCUTS.take(3).forEach { (label, markup) ->
            SmallAction(label, Amll.colors.ink2) {
                val next = insertMarkup(value, markup)
                value = next
                onCommentChange(next.text)
            }
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(top = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        MARKUP_SHORTCUTS.drop(3).forEach { (label, markup) ->
            SmallAction(label, Amll.colors.ink2) {
                val next = insertMarkup(value, markup)
                value = next
                onCommentChange(next.text)
            }
        }
    }

    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            val capped = if (next.text.length > MAX_COMMENT) {
                val end = next.selection.max.coerceAtMost(MAX_COMMENT)
                TextFieldValue(next.text.take(MAX_COMMENT), TextRange(end))
            } else {
                next
            }
            value = capped
            onCommentChange(capped.text)
        },
        placeholder = { Text("输入推荐语，可使用上方标记按钮排版", style = Font.bodySmall, color = Amll.colors.ink3) },
        minLines = 6,
        maxLines = 12,
        textStyle = Font.body,
        shape = RoundedCornerShape(Radius.field),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedContainerColor = Amll.colors.surface2,
            unfocusedContainerColor = Amll.colors.surface2,
            focusedTextColor = Amll.colors.ink,
            unfocusedTextColor = Amll.colors.ink,
            cursorColor = Amll.colors.primary,
            focusedBorderColor = Amll.colors.primary,
            unfocusedBorderColor = Amll.colors.border,
        ),
    )
    Text(
        "${value.text.length} / 7000",
        style = Font.micro,
        color = Amll.colors.ink3,
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
    )
}

private const val MAX_COMMENT = 7000

private fun insertMarkup(value: TextFieldValue, markup: String): TextFieldValue {
    val start = value.selection.min
    val end = value.selection.max
    val text = value.text
    val next = text.substring(0, start) + markup + text.substring(start)
    val cursor = (start + markup.length + (end - start)).coerceAtMost(next.length)
    return TextFieldValue(next, TextRange(cursor))
}
