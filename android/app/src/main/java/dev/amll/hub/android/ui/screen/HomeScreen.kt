package dev.amll.hub.android.ui.screen

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import dev.amll.hub.android.data.remote.UserProfile

/**
 * 登录后的落地页（当前阶段用于展示登录态与入口，后续接入个人中心）。
 */
@Composable
fun HomeScreen(
    profile: UserProfile?,
    onScanQr: () -> Unit,
    onLoggedOut: () -> Unit,
    onRefreshProfile: () -> Unit,
) {
    // 登录态已恢复但资料缺失（如离线启动）时补拉一次
    LaunchedEffect(profile) {
        if (profile == null) onRefreshProfile()
    }

    Surface(color = MaterialTheme.colorScheme.background) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
        ) {
            Spacer(Modifier.height(16.dp))
            Text(
                text = "AMLl Hub",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(Modifier.height(24.dp))

            profile?.let { ProfileCard(it) }

            Spacer(Modifier.height(24.dp))

            Button(
                onClick = onScanQr,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.Filled.QrCodeScanner,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text("扫码登录网页端")
            }

            Spacer(Modifier.height(8.dp))

            OutlinedButton(
                onClick = onLoggedOut,
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.size(8.dp))
                Text("退出登录")
            }
        }
    }
}

@Composable
private fun ProfileCard(profile: UserProfile) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(16.dp),
        ) {
            if (profile.avatar.isNotBlank()) {
                AsyncImage(
                    model = profile.avatar,
                    contentDescription = "头像",
                    contentScale = ContentScale.Crop,
                    modifier = Modifier.size(56.dp),
                )
                Spacer(Modifier.size(8.dp))
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(
                    text = profile.displayName.ifBlank { profile.name },
                    style = MaterialTheme.typography.titleMedium,
                )
                if (profile.email.isNotBlank()) {
                    Text(
                        text = profile.email,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (profile.isAdmin || profile.isReviewer) {
                    Text(
                        text = if (profile.isAdmin) "超级管理员" else "审核员",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
