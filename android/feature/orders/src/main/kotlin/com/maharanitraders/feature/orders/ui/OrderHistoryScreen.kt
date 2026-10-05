package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.feature.orders.OrderHistoryUiState
import com.maharanitraders.feature.orders.OrderHistoryViewModel
import com.maharanitraders.feature.orders.RetailerOrder

object OrderHistoryTags {
  const val SCREEN = "order_history_screen"
  const val ITEM = "order_history_item"
  const val LOAD_MORE = "order_history_load_more"
}

@Composable
fun OrderHistoryScreen(
  onOpenOrder: (String) -> Unit,
  modifier: Modifier = Modifier,
  viewModel: OrderHistoryViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  OrderHistoryContent(
    state = state,
    onRefresh = viewModel::refresh,
    onLoadMore = viewModel::loadMore,
    onOpenOrder = onOpenOrder,
    modifier = modifier,
  )
}

@Composable
fun OrderHistoryContent(
  state: OrderHistoryUiState,
  onRefresh: () -> Unit,
  onLoadMore: () -> Unit,
  onOpenOrder: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.loading && state.orders.isEmpty()) {
    LoadingState("Loading your order history…", modifier)
    return
  }
  if (state.error != null && state.orders.isEmpty()) {
    if (state.offline) OfflineState(modifier, onRetry = onRefresh)
    else ErrorState(state.error, modifier, retryable = true, onRetry = onRefresh)
    return
  }
  if (state.orders.isEmpty()) {
    EmptyState(
      title = "No orders yet",
      message = "Orders confirmed by the server will appear here with their actual status, totals and items.",
      actionLabel = "Refresh",
      onAction = onRefresh,
      modifier = modifier.fillMaxSize().testTag(OrderHistoryTags.SCREEN),
    )
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(OrderHistoryTags.SCREEN),
    contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
  ) {
    item {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text("My orders", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
          Text("Status and values are the latest server records.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        TextButton(onClick = onRefresh, enabled = !state.refreshing) {
          Text(if (state.refreshing) "Refreshing…" else "Refresh")
        }
      }
    }
    state.error?.let { message ->
      item {
        Surface(color = MaterialTheme.colorScheme.errorContainer, contentColor = MaterialTheme.colorScheme.onErrorContainer, shape = RoundedCornerShape(12.dp)) {
          Text(message, Modifier.fillMaxWidth().padding(12.dp), style = MaterialTheme.typography.bodySmall)
        }
      }
    }
    items(state.orders, key = { it.id }) { order ->
      OrderCard(order = order, onOpen = { onOpenOrder(order.id) })
    }
    if (state.hasMore) {
      item {
        OutlinedButton(
          onClick = onLoadMore,
          enabled = !state.loadingMore,
          modifier = Modifier.fillMaxWidth().testTag(OrderHistoryTags.LOAD_MORE),
        ) {
          if (state.loadingMore) CircularProgressIndicator(strokeWidth = 2.dp)
          else Text("Load more orders")
        }
      }
    }
  }
}

@Composable
private fun OrderCard(order: RetailerOrder, onOpen: () -> Unit) {
  Surface(
    modifier = Modifier
      .fillMaxWidth()
      .clickable(onClick = onOpen)
      .testTag("${OrderHistoryTags.ITEM}_${order.id}"),
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(order.orderNumber, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text(orderStatusHeading(order.status), style = MaterialTheme.typography.bodyMedium)
        }
        Text(MoneyFormat.formatPaise(order.grandTotalPaise), style = MaterialTheme.typography.titleMedium)
      }
      Text("Placed (UTC): ${order.placedAt}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(
        "${order.items.size} item(s) · Tap for the full record, invoice and reorder",
        style = MaterialTheme.typography.labelMedium,
      )
    }
  }
}
