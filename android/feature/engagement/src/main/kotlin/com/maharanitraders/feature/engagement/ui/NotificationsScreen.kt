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
import androidx.compose.material3.FilterChip
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
  const val UNREAD_FILTER = "notifications_unread_filter"
  const val ALL_FILTER = "notifications_all_filter"
  const val REFRESH = "notifications_refresh"
}

/**
 * The retailer's alert feed.
 *
 * Tapping an alert is the same pair of actions the web list performs: it marks
 * that one row read, and — when the alert carries a link the app can actually
 * open — it goes there. A link this build has no screen for is deliberately not
 * turned into a browser hop: the row still marks read, and nothing pretends.
 */
@Composable
fun NotificationsScreen(
  modifier: Modifier = Modifier,
  onOpenLink: (String) -> Unit = {},
  viewModel: NotificationsViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  NotificationsContent(
    state = state,
    onRefresh = viewModel::load,
    onLoadMore = viewModel::loadMore,
    onMarkAllRead = viewModel::markAllRead,
    onMarkRead = viewModel::markRead,
    onSetUnreadOnly = viewModel::setUnreadOnly,
    onOpenLink = onOpenLink,
    modifier = modifier,
  )
}

@Composable
fun NotificationsContent(
  state: com.maharanitraders.feature.engagement.NotificationsUiState,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  onMarkAllRead: () -> Unit,
  onMarkRead: (String) -> Unit = {},
  onSetUnreadOnly: (Boolean) -> Unit = {},
  onOpenLink: (String) -> Unit = {},
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
    // With the unread filter on, "nothing here" means "nothing unread" — so the
    // way out is the filter, not another reload of the same empty query.
    EmptyState(
      title = if (state.unreadOnly) "Nothing unread" else "You're all caught up",
      message = if (state.unreadOnly) {
        "Every alert you have is read. Show all updates to see the full feed."
      } else {
        "Order updates, scheme alerts and coin messages will appear here."
      },
      actionLabel = if (state.unreadOnly) "Show all updates" else "Refresh",
      onAction = { if (state.unreadOnly) onSetUnreadOnly(false) else onRefresh() },
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

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        FilterChip(
          selected = !state.unreadOnly,
          onClick = { onSetUnreadOnly(false) },
          label = { Text("All") },
          modifier = Modifier.testTag(NotificationTags.ALL_FILTER),
        )
        FilterChip(
          selected = state.unreadOnly,
          onClick = { onSetUnreadOnly(true) },
          label = { Text(if (state.unreadOnly && unreadCount > 0) "Unread · $unreadCount" else "Unread") },
          modifier = Modifier.testTag(NotificationTags.UNREAD_FILTER),
        )
        TextButton(
          onClick = onRefresh,
          enabled = !state.refreshing,
          modifier = Modifier.testTag(NotificationTags.REFRESH),
        ) { Text(if (state.refreshing) "Refreshing…" else "Refresh") }
      }

      state.actionMessage?.let { message ->
        Text(
          message,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
        )
      }
    }
    items(state.items, key = { it.id }) { notification ->
      NotificationCard(
        notification = notification,
        onTap = {
          if (!notification.isRead) onMarkRead(notification.id)
          notification.linkUrl?.let(onOpenLink)
        },
      )
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
  onTap: () -> Unit = {},
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
    onClick = onTap,
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