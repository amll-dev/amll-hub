package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font
import dev.amll.hub.android.ui.theme.Radius

/* ============================ 12 资料编辑 ============================ */

@Composable
fun ProfileEditScreen(vm: ProfileViewModel, nav: AppNav) {
    LaunchedEffect(Unit) { vm.loadProfile() }
    val profile by vm.profile.collectAsStateWithLifecycle()
    var name by remember(profile) { mutableStateOf(profile?.displayName.orEmpty()) }
    var saving by remember { mutableStateOf(false) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Amll.colors.canvas)
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        AmllTopBar("编辑资料", onBack = nav.back)
        Avatar(profile?.avatar, 82.dp)
        Text("更换头像", style = Font.caption.copy(fontWeight = FontWeight.Medium), color = Amll.colors.primary)
        AmllCard(padding = 16.dp) {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .height(44.dp)
                        .clip(RoundedCornerShape(Radius.field))
                        .background(Amll.colors.surface2)
                        .padding(horizontal = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("昵称", style = Font.bodySmall, color = Amll.colors.ink3)
                    Spacer(Modifier.width(12.dp))
                    Box(Modifier.weight(1f)) {
                        if (name.isBlank()) {
                            Text("输入昵称", style = Font.bodyMedium, color = Amll.colors.ink3)
                        }
                        BasicTextField(
                            value = name,
                            onValueChange = { name = it },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(
                                fontSize = 13.5.sp,
                                color = Amll.colors.ink,
                            ),
                            cursorBrush = SolidColor(Amll.colors.primary),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }
                FieldRow("用户名", profile?.name.orEmpty().ifBlank { "—" })
            }
        }
        Text(
            "用户名注册后不可修改；昵称会显示在评论与投稿记录里。",
            style = Font.micro,
            color = Amll.colors.ink3,
            modifier = Modifier.fillMaxWidth(),
        )
        PrimaryButton(
            text = if (saving) "保存中…" else "保存修改",
            enabled = name.isNotBlank() && !saving,
            onClick = {
                saving = true
                vm.saveDisplayName(name) { ok ->
                    saving = false
                    if (ok) nav.back()
                }
            },
        )
    }
}
