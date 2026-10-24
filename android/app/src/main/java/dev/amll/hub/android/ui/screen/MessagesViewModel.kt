package dev.amll.hub.android.ui.screen

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dev.amll.hub.android.data.remote.MessageDto
import dev.amll.hub.android.data.repo.ContentRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MessagesViewModel @Inject constructor(
    private val repo: ContentRepository,
) : ViewModel() {

    val messages = MutableStateFlow(ListUi<MessageDto>())

    fun loadMessages() {
        viewModelScope.launch {
            messages.update { it.copy(loading = true, error = null) }
            val result = repo.notifications()
            val items = result.getOrDefault(emptyList())
            messages.update {
                it.copy(
                    loading = false,
                    items = items,
                    error = result.exceptionOrNull()?.message
                        ?: if (items.isEmpty()) "暂无消息" else null,
                )
            }
        }
    }

    fun markRead(id: Long) {
        viewModelScope.launch {
            repo.markRead(id)
            messages.update { ui ->
                ui.copy(items = ui.items.map { if (it.id == id) it.copy(read = true) else it })
            }
        }
    }

    fun markAllRead() {
        viewModelScope.launch {
            repo.markAllRead()
            messages.update { ui -> ui.copy(items = ui.items.map { it.copy(read = true) }) }
        }
    }
}
