package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.components.SectionHeader
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.orders.OrderDetailUiState
import com.maharanitraders.feature.orders.OrderDetailViewModel
import com.maharanitraders.feature.orders.OrderItem
import com.maharanitraders.feature.orders.RetailerOrder

/** Test tags for the order-detail surface. */
object OrderDetailTags {
  const val SCREEN = "order_detail_screen"
  const val REORDER = "order_detail_reorder"
  const val INVOICE = "order_detail_invoice"
  const val DELIVERY = "order_detail_delivery"
  const val ERROR = "order_detail_error"
}

@Composable
fun OrderDetailScreen(
  onBack: () -> Unit,
  onOpenInvoice: (String) -> Unit,
  onOpenDelivery: (String) -> Unit,
  onOpenCart: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: OrderDetailViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()

  // A successful reorder lands on the cart, where the server's re-priced lines
  // are the only thing shown. The completion flag is consumed exactly once.
  LaunchedEffect(state.reorderCompleted) {
    if (state.reorderCompleted) {
      viewModel.consumeReorderCompletion()
      onOpenCart()
    }
  }

  OrderDetailContent(
    state = state,
    onRetry = viewModel::load,
    onBack = onBack,
    onReorder = viewModel::reorder,
    onOpenInvoice = onOpenInvoice,
    onOpenDelivery = onOpenDelivery,
    modifier = modifier,
  )
}

@Composable
fun OrderDetailContent(
  state: OrderDetailUiState,
  onRetry: () -> Unit,
  onBack: () -> Unit,
  onReorder: () -> Unit,
  onOpenInvoice: (String) -> Unit,
  onOpenDelivery: (String) -> Unit,
  modifier: Modifier = Modifier,
) {
  val order = state.order
  if (state.loading && order == null) {
    LoadingState("Loading this order…", modifier)
    return
  }
  if (order == null) {
    if (state.offline) {
      OfflineState(modifier, onRetry = onRetry)
    } else {
      ErrorState(state.error ?: "This order could not be loaded.", modifier, retryable = true, onRetry = onRetry)
    }
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(OrderDetailTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Order details", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(order.orderNumber, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(orderStatusHeading(order.status), style = MaterialTheme.typography.titleSmall)
        Text("Placed ${order.placedAt} (UTC)", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }

    item {
      Row(horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
        Button(
          onClick = { onOpenInvoice(order.id) },
          modifier = Modifier.weight(1f).testTag(OrderDetailTags.INVOICE),
        ) { Text("Invoice") }
        OutlinedButton(
          onClick = { onOpenDelivery(order.id) },
          modifier = Modifier.weight(1f).testTag(OrderDetailTags.DELIVERY),
        ) { Text("Delivery") }
      }
    }

    item {
      OrderDetailCard(title = "Payment summary") {
        DetailAmountRow("Subtotal", order.subtotalPaise)
        DetailAmountRow("GST (included)", order.gstTotalPaise)
        if (order.discountTotalPaise > 0) DetailAmountRow("Discount", -order.discountTotalPaise)
        HorizontalDivider()
        DetailAmountRow("Grand total", order.grandTotalPaise, emphasized = true)
        // Coins movement is the ledger's own fact for THIS order; it is absent
        // (not zero) when the server could not read the ledger.
        order.coinsSpentPaise?.let { spent ->
          val label = if (order.coinsRefunded) "Coins refunded for this order" else "Coins used on this order"
          val value = if (order.coinsRefunded) order.coinsRefundedPaise ?: 0L else spent
          DetailAmountRow(label, value)
        }
        order.coinsRefundedPaise?.takeIf { it > 0 && !order.coinsRefunded }?.let { refunded ->
          DetailAmountRow("Coins refunded", refunded)
        }
      }
    }

    order.shippingAddressLine?.let { address ->
      item {
        OrderDetailCard(title = "Delivery address") {
          Text(address, style = MaterialTheme.typography.bodyMedium)
          Text(
            "The address frozen when the order was placed — later profile changes do not affect it.",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
    }

    order.notes?.takeIf { it.isNotBlank() }?.let { notes ->
      item {
        OrderDetailCard(title = "Delivery notes") {
          Text(notes, style = MaterialTheme.typography.bodyMedium)
        }
      }
    }

    if (order.statusHistory.isNotEmpty()) {
      item { SectionHeader(title = "Status history") }
      items(order.statusHistory, key = { entry -> entry.id }) { entry ->
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(orderStatusHeading(entry.status), style = MaterialTheme.typography.titleSmall)
            entry.note?.takeIf { it.isNotBlank() }?.let { note ->
              Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
          Text(entry.createdAt, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }

    item { SectionHeader(title = "Items in this order", subtitle = "Prices captured when the order was placed") }
    items(order.items, key = { item -> item.id }) { item -> OrderDetailItemRow(item) }

    item {
      state.reorderError?.let { message ->
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(12.dp),
          modifier = Modifier.fillMaxWidth().testTag(OrderDetailTags.ERROR),
        ) { Text(message, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall) }
      }
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
        Button(
          onClick = onReorder,
          enabled = state.canReorder,
          modifier = Modifier.fillMaxWidth().testTag(OrderDetailTags.REORDER),
        ) {
          if (state.reorderInProgress) CircularProgressIndicator(strokeWidth = 2.dp)
          else Text("Reorder these items")
        }
        Text(
          "Reorder adds the same piece counts to your cart; the server re-checks stock, pack rules and today's prices.",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back to orders") }
      }
    }
  }
}

@Composable
private fun OrderDetailCard(title: String, content: @Composable () -> Unit) {
  Surface(
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      content()
    }
  }
}

@Composable
private fun DetailAmountRow(label: String, paise: Long, emphasized: Boolean = false) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
    Text(MoneyFormat.formatPaise(paise), style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun OrderDetailItemRow(item: OrderItem) {
  Column(
    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    verticalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    Text(item.productName ?: "Product", style = MaterialTheme.typography.titleSmall)
    Text(
      "${item.packName ?: "Pack"} · ${item.quantity} ${item.quantityUnit}" +
        (item.quantityPieces?.let { " ($it pieces)" } ?: ""),
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Text(
      "${MoneyFormat.formatPaise(item.unitPricePaise)} / unit · GST ${formatPercent(item.gstPercent)} · line ${MoneyFormat.formatPaise(item.lineTotalPaise)}",
      style = MaterialTheme.typography.bodySmall,
    )
    if (!item.isReorderable) {
      Text(
        "This line can no longer be reordered (its pack is no longer sold).",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
