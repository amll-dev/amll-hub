package dev.amll.hub.android.ui.screen

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CloudUpload
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.GhostButton
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.component.SectionHeader
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.ChipShape
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius
import kotlinx.coroutines.delay

/* ============================ 歌词投稿 ============================ */

private val LANG_OPTIONS = listOf(
    "zh" to "汉语",
    "en" to "英语",
    "ja" to "日语",
    "ko" to "韩语",
    "others" to "其他",
)

@Composable
fun LyricSubmitScreen(
    nav: AppNav,
    vm: LyricSubmitViewModel = hiltViewModel(),
) {
    val ui by vm.state.collectAsStateWithLifecycle()

    val ttmlPicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(vm::pickTtml)
    }
    val audioPicker =
        rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris ->
            vm.addAudio(uris)
        }

    // 投稿成功后返回创作中心列表（音源失败时多停留一会儿让用户看到提示）
    LaunchedEffect(ui.successId) {
        if (ui.successId == null) return@LaunchedEffect
        delay(if (ui.messageIsError) 3000 else 800)
        nav.back()
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
            AmllTopBar("歌词投稿", onBack = nav.back)

            // 文件选择
            SectionHeader("歌词文件 (TTML)")
            AmllCard(
                padding = 16.dp,
                modifier = Modifier.clickable { ttmlPicker.launch(arrayOf("*/*")) },
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(
                        Icons.Rounded.CloudUpload,
                        null,
                        tint = Amll.colors.ink3,
                        modifier = Modifier.width(26.dp),
                    )
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text(
                            ui.fileName.ifBlank { "点击选择 .ttml 文件" },
                            style = Font.bodyMedium,
                            color = Amll.colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            when {
                                ui.validating -> "正在校验文件…"
                                ui.fileName.isNotBlank() -> "点击可重新选择"
                                else -> "文件会先经过后端校验，再自动重排"
                            },
                            style = Font.micro,
                            color = Amll.colors.ink3,
                        )
                    }
                    if (ui.fileName.isNotBlank() && !ui.validating) {
                        Text(
                            "移除",
                            style = Font.micro,
                            color = Amll.colors.warning,
                            modifier = Modifier.clickable { vm.resetFile() },
                        )
                    }
                }
            }

            val validation = ui.validation
            when {
                ui.validateError != null -> Text(
                    ui.validateError.orEmpty(),
                    style = Font.caption,
                    color = Amll.colors.error,
                )
                validation != null && !validation.valid -> {
                    AmllCard(padding = 16.dp) {
                        Text("校验未通过", style = Font.cardTitle, color = Amll.colors.error)
                        if (validation.parseError.isNotBlank()) {
                            Text(validation.parseError, style = Font.caption, color = Amll.colors.ink2)
                        }
                        validation.errors.take(6).forEach {
                            Text("· $it", style = Font.caption, color = Amll.colors.ink2)
                        }
                    }
                }
            }

            if (validation != null) {
                SectionHeader("文件信息")
                AmllCard(padding = 16.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        FieldRow("标题", validation.titles.joinToString("、").ifBlank { "—" })
                        FieldRow("语言", validation.language.ifBlank { "—" })
                        FieldRow("校验结果", if (validation.valid) "通过" else "未通过")
                    }
                }
            }

            // 语言
            SectionHeader("语言")
            AmllCard(padding = 16.dp) {
                Row(
                    Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    LANG_OPTIONS.forEach { (code, label) ->
                        FilterChip(
                            selected = code in ui.languages,
                            onClick = { vm.toggleLanguage(code) },
                            label = {
                                Text(label, style = Font.micro.copy(fontWeight = FontWeight.Medium))
                            },
                            shape = ChipShape,
                            colors = FilterChipDefaults.filterChipColors(
                                containerColor = Amll.colors.surface2,
                                labelColor = Amll.colors.ink2,
                                selectedContainerColor = Amll.colors.primary,
                                selectedLabelColor = Amll.colors.onPrimary,
                            ),
                            border = null,
                        )
                    }
                }
                if ("others" in ui.languages) {
                    AmllTextField(
                        value = ui.otherLangInput,
                        onValueChange = vm::setOtherLangInput,
                        placeholder = "输入语言名后点添加",
                        imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                        onImeAction = vm::addOtherLanguage,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                    ui.otherLanguages.forEach { value ->
                        TagPill(value, onRemove = { vm.removeOtherLanguage(value) })
                    }
                }
                val count = ui.languagesText.size
                Text(
                    "已选 $count / ${LyricSubmitViewModel.MAX_LANGUAGES}",
                    style = Font.micro,
                    color = Amll.colors.ink3,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }

            // 标签
            SectionHeader("标签")
            AmllCard(padding = 16.dp) {
                AmllTextField(
                    value = ui.tagInput,
                    onValueChange = vm::setTagInput,
                    placeholder = "输入标签后回车添加",
                    imeAction = androidx.compose.ui.text.input.ImeAction.Done,
                    onImeAction = vm::addTag,
                )
                ui.tags.forEach { value ->
                    TagPill(value, onRemove = { vm.removeTag(value) })
                }
            }

            // 备注
            SectionHeader("备注")
            MultilineField(
                value = ui.notes,
                onValueChange = vm::setNotes,
                placeholder = "给审核员的补充说明（可选）",
                minLines = 3,
            )

            // 音源附件
            SectionHeader("音源附件（可选）")
            AmllCard(padding = 16.dp) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(Radius.field))
                        .background(Amll.colors.surface2)
                        .clickable { audioPicker.launch(arrayOf("audio/*")) }
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Icon(
                        Icons.Rounded.MusicNote,
                        null,
                        tint = Amll.colors.ink3,
                        modifier = Modifier.width(18.dp),
                    )
                    Text(
                        if (ui.audioFiles.isEmpty()) "添加音源文件（可多选）" else "继续添加",
                        style = Font.bodySmall,
                        color = Amll.colors.ink2,
                        modifier = Modifier.weight(1f),
                    )
                }
                ui.audioFiles.forEachIndexed { index, audio ->
                    Row(
                        Modifier.fillMaxWidth().padding(top = if (index == 0) 10.dp else 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            audio.name,
                            style = Font.caption,
                            color = Amll.colors.ink,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        Text(
                            "移除",
                            style = Font.micro,
                            color = Amll.colors.warning,
                            modifier = Modifier.clickable { vm.removeAudio(audio.uri) },
                        )
                    }
                }
            }

            // 原创声明（提交审核必选，存草稿不受限）
            Row(
                Modifier.fillMaxWidth().clickable { vm.setAgreed(!ui.agreed) },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Checkbox(
                    checked = ui.agreed,
                    onCheckedChange = vm::setAgreed,
                    colors = CheckboxDefaults.colors(checkedColor = Amll.colors.primary),
                )
                Text(
                    "我确认该歌词为原创或已获授权，并遵守投稿规范",
                    style = Font.caption,
                    color = Amll.colors.ink2,
                )
            }

            ui.message?.let {
                Text(
                    it,
                    style = Font.caption,
                    color = if (ui.messageIsError) Amll.colors.error else Amll.colors.success,
                )
            }
            if (ui.audioProgress.isNotBlank()) {
                Text(ui.audioProgress, style = Font.micro, color = Amll.colors.ink3)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                GhostButton(
                    text = if (ui.submitting) "处理中…" else "存草稿",
                    onClick = { vm.submit(draft = true) },
                    modifier = Modifier.weight(1f),
                )
                PrimaryButton(
                    text = if (ui.submitting) "提交中…" else "立即投稿",
                    onClick = { vm.submit(draft = false) },
                    modifier = Modifier.weight(1f),
                    enabled = ui.canSubmit && ui.agreed,
                )
            }

            Text(
                "上传即表示同意《AMLL Hub 使用协议》与《社区公约》",
                style = Font.micro,
                color = Amll.colors.ink3,
            )
        }
    }
}

@Composable
private fun TagPill(label: String, onRemove: () -> Unit) {
    Box(
        Modifier
            .padding(top = 8.dp, end = 8.dp)
            .clip(RoundedCornerShape(999.dp))
            .border(1.dp, Amll.colors.border, RoundedCornerShape(999.dp))
            .clickable(onClick = onRemove)
            .padding(horizontal = 10.dp, vertical = 5.dp),
    ) {
        Text("$label ×", style = Font.micro, color = Amll.colors.ink2)
    }
}

@Composable
fun MultilineField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    minLines: Int = 4,
    maxLength: Int? = null,
) {
    OutlinedTextField(
        value = value,
        onValueChange = { next ->
            onValueChange(if (maxLength != null) next.take(maxLength) else next)
        },
        placeholder = { Text(placeholder, style = Font.bodySmall, color = Amll.colors.ink3) },
        minLines = minLines,
        textStyle = Font.body,
        shape = RoundedCornerShape(Radius.field),
        modifier = Modifier.fillMaxWidth(),
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
}
