package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.IsoDateDisplay
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.engagement.AppNotification
import com.maharanitraders.feature.engagement.NotificationsViewModel

object NotificationTags {
  const val SCREEN = "notifications_screen"
  const val ITEM = "notification_item"
  const val MARK_READ = "notification_mark_read"
  const val LOAD_MORE = "notification_load_more"
}

@Composable
fun NotificationsScreen(
  modifier: Modifier = Modifier,
  viewModel: NotificationsViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  NotificationsContent(
    state = state,
    onRefresh = viewModel::load,
    onLoadMore = viewModel::loadMore,
    onMarkAllRead = viewModel::markAllRead,
    modifier = modifier,
  )
}

@Composable
fun NotificationsContent(
  state: com.maharanitraders.feature.engagement.NotificationsUiState,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  onMarkAllRead: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.loading && state.items.isEmpty()) {
    LoadingState("Loading updates…", modifier)
    return
  }
  if (state.items.isEmpty() && state.errorMessage != null) {
    if (state.offline) OfflineState(modifier, onRetry = onRefresh)
    else ErrorState(state.errorMessage.orEmpty(), modifier, retryable = true, onRetry = onRefresh)
    return
  }
  if (state.items.isEmpty()) {
    EmptyState(
      title = "You're all caught up",
      message = "Order updates, scheme alerts and coin messages will appear here.",
      actionLabel = "Refresh",
      onAction = onRefresh,
      modifier = modifier.fillMaxSize().testTag(NotificationTags.SCREEN),
    )
    return
  }

  val unreadCount = state.items.count { !it.isRead }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(NotificationTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
  ) {
    item {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Column {
          Text("Updates & alerts", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
          if (unreadCount > 0) {
            Text(
              "$unreadCount unread update${if (unreadCount == 1) "" else "s"}",
              style = MaterialTheme.typography.labelMedium,
              color = MaterialTheme.colorScheme.primary,
            )
          }
        }
        if (unreadCount > 0) {
          TextButton(
            onClick = onMarkAllRead,
            modifier = Modifier.testTag(NotificationTags.MARK_READ),
          ) { Text("Mark all read") }
        }
      }
    }
    items(state.items, key = { it.id }) { notification ->
      NotificationCard(notification = notification)
    }
    if (state.hasMore) {
      item {
        OutlinedButton(
          onClick = onLoadMore,
          enabled = !state.loadingMore,
          modifier = Modifier.fillMaxWidth().testTag(NotificationTags.LOAD_MORE),
        ) {
          if (state.loadingMore) CircularProgressIndicator(strokeWidth = 2.dp)
          else Text("Load more")
        }
      }
    }
  }
}

@Composable
private fun NotificationCard(
  notification: AppNotification,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier
      .fillMaxWidth()
      .testTag("${NotificationTags.ITEM}_${notification.id}"),
    shape = RoundedCornerShape(16.dp),
    color = if (notification.isRead) {
      MaterialTheme.colorScheme.surface
    } else {
      MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.3f)
    },
    border = androidx.compose.foundation.BorderStroke(
      1.dp,
      if (notification.isRead) MaterialTheme.colorScheme.outlineVariant
      else MaterialTheme.colorScheme.primary.copy(alpha = 0.3f),
    ),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          text = notification.title,
          style = MaterialTheme.typography.titleSmall,
          fontWeight = if (notification.isRead) FontWeight.Normal else FontWeight.SemiBold,
          modifier = Modifier.weight(1f),
        )
        if (!notification.isRead) {
          Surface(
            color = MaterialTheme.colorScheme.primary,
            shape = RoundedCornerShape(50),
          ) {
            Text(
              "New",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onPrimary,
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            )
          }
        }
      }
      Text(
        text = notification.body,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Text(
        text = IsoDateDisplay.formatDate(notification.createdAt) ?: notification.createdAt,
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}