package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.amll.hub.android.ui.AppNav
import dev.amll.hub.android.ui.component.AmllCard
import dev.amll.hub.android.ui.component.AmllTextField
import dev.amll.hub.android.ui.component.AmllTopBar
import dev.amll.hub.android.ui.component.FieldRow
import dev.amll.hub.android.ui.component.PrimaryButton
import dev.amll.hub.android.ui.theme.Amll
import dev.amll.hub.android.ui.theme.Font

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
                AmllTextField(
                    value = name,
                    onValueChange = { name = it },
                    placeholder = "输入昵称",
                    label = "昵称",
                    imeAction = ImeAction.Done,
                )
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
