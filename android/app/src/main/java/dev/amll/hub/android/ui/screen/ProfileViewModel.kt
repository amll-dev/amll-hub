package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.AuthRepository
import dev.amll.hub.android.data.remote.UserActivityDto
import dev.amll.hub.android.data.remote.UserProfile
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

/** 资料 / 活动记录：首页头像、我的、资料编辑共用同一份缓存 */
@HiltViewModel
class ProfileViewModel @Inject constructor(
    private val repo: ContentRepository,
    private val authRepo: AuthRepository,
) : ViewModel() {

    val profile = MutableStateFlow<UserProfile?>(null)

    /** 活动记录（真实数据，来自 /users/me/activity） */
    val activity = MutableStateFlow<UserActivityDto?>(null)
    val activityLoading = MutableStateFlow(false)

    fun loadProfile() {
        if (profile.value != null) return
        viewModelScope.launch { profile.value = runCatching { authRepo.profile() }.getOrNull() }
    }

    fun loadActivity(year: Int? = null) {
        if (activityLoading.value) return
        // 已有当年数据就不再重复请求；显式传 year 时才刷新
        if (year == null && activity.value != null) return
        viewModelScope.launch {
            activityLoading.value = true
            val data = repo.activity(year).getOrNull()
            activity.value = data
            activityLoading.value = false
        }
    }

    fun saveDisplayName(name: String, onDone: (Boolean) -> Unit = {}) {
        viewModelScope.launch {
            val updated = repo.updateDisplayName(name).getOrNull()
            if (updated != null) profile.value = updated
            onDone(updated != null)
        }
    }
}
