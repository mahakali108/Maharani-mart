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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
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
import com.maharanitraders.feature.orders.OrderActionsUiState
import com.maharanitraders.feature.orders.OrderActionsViewModel
import com.maharanitraders.feature.orders.OrderItem
import com.maharanitraders.feature.orders.RetailerOrder

/** Test tags for the order-detail surface. */
object OrderDetailTags {
  const val SCREEN = "order_detail_screen"
  const val REORDER = "order_detail_reorder"
  const val INVOICE = "order_detail_invoice"
  const val DELIVERY = "order_detail_delivery"
  const val ERROR = "order_detail_error"
  const val CANCEL = "order_detail_cancel"
  /** The list of lines a reorder could not add, each with the server's reason. */
  const val REORDER_SKIPPED = "order_detail_reorder_skipped"
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
  val actionsViewModel: OrderActionsViewModel = hiltViewModel()
  val actions by actionsViewModel.state.collectAsStateWithLifecycle()
  var showCancelDialog by remember { mutableStateOf(false) }
  var cancelReason by remember { mutableStateOf("") }

  LaunchedEffect(actions.completedAction) {
    if (actions.completedAction == "cancel") {
      showCancelDialog = false
      cancelReason = ""
      viewModel.load()
    }
  }

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
    actions = actions,
    onOpenCancel = { showCancelDialog = true },
    modifier = modifier,
  )
  if (showCancelDialog) {
    AlertDialog(
      onDismissRequest = { if (!actions.busy) showCancelDialog = false },
      title = { Text("Cancel this order?") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text("Only a pending order can be cancelled. The server handles the Coins reversal; coupon use stays recorded pending retention review.")
          OutlinedTextField(
            value = cancelReason,
            onValueChange = { cancelReason = it.take(500) },
            label = { Text("Reason (optional)") },
            minLines = 2,
            maxLines = 4,
            modifier = Modifier.fillMaxWidth(),
          )
          actions.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
      },
      confirmButton = {
        TextButton(onClick = { actionsViewModel.cancelOrder(cancelReason) }, enabled = !actions.busy) {
          if (actions.busy) CircularProgressIndicator(Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
          Text("Cancel order")
        }
      },
      dismissButton = { TextButton(onClick = { showCancelDialog = false }, enabled = !actions.busy) { Text("Keep order") } },
    )
  }
}

@Composable
fun OrderDetailContent(
  state: OrderDetailUiState,
  onRetry: () -> Unit,
  onBack: () -> Unit,
  onReorder: () -> Unit,
  onOpenInvoice: (String) -> Unit,
  onOpenDelivery: (String) -> Unit,
  actions: OrderActionsUiState = OrderActionsUiState(),
  onOpenCancel: () -> Unit = {},
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
        ) { Text("Order summary") }
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

    if (order.status == "pending") {
      item {
        OrderDetailCard(title = "Order actions") {
          Text("This order is still pending. Cancellation is available only until processing begins.", style = MaterialTheme.typography.bodySmall)
          OutlinedButton(
            onClick = onOpenCancel,
            enabled = !actions.busy,
            modifier = Modifier.fillMaxWidth().testTag(OrderDetailTags.CANCEL),
          ) { Text(if (actions.busy) "Cancelling…" else "Cancel order") }
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

    // The status timeline: the rows the server has for THIS order, in the
    // order it recorded them. No stage is drawn that the backend did not
    // record, and no courier position is invented.
    run {
      val steps = orderTimeline(order.statusHistory, order.status)
      item {
        SectionHeader(
          title = "Order progress",
          subtitle = if (order.statusHistory.isEmpty()) {
            "The server has not recorded status steps for this order yet"
          } else {
            "${steps.size} step${if (steps.size == 1) "" else "s"} recorded by the server"
          },
        )
      }
      item {
        Surface(
          shape = RoundedCornerShape(18.dp),
          color = MaterialTheme.colorScheme.surfaceContainerLow,
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
          modifier = Modifier.fillMaxWidth(),
        ) {
          OrderTimeline(
            steps = steps,
            modifier = Modifier.padding(MaharaniDimens.spaceLg),
          )
        }
      }
    }

    item { SectionHeader(title = "Items in this order", subtitle = "Prices captured when the order was placed") }
    items(order.items, key = { item -> item.id }) { item -> OrderDetailItemRow(item) }

    if (actions.error != null || actions.message != null) {
      item {
        actions.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        actions.message?.let { Text(it, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium) }
      }
    }

    item {
      state.reorderError?.let { message ->
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(12.dp),
          modifier = Modifier.fillMaxWidth().testTag(OrderDetailTags.ERROR),
        ) { Text(message, Modifier.padding(12.dp), style = MaterialTheme.typography.bodySmall) }
      }

      // A partial reorder is reported line by line. One generic "something
      // failed" would leave the shopkeeper guessing which of eight products
      // the warehouse could not fill.
      if (state.reorderFailures.isNotEmpty()) {
        Surface(
          color = MaterialTheme.colorScheme.surfaceContainerLow,
          shape = RoundedCornerShape(12.dp),
          border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
          modifier = Modifier.fillMaxWidth().testTag(OrderDetailTags.REORDER_SKIPPED),
        ) {
          Column(
            modifier = Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
          ) {
            Text(
              text = "${state.reorderAddedCount} of ${state.reorderRequestedCount} lines added to your cart",
              style = MaterialTheme.typography.titleSmall,
              fontWeight = FontWeight.SemiBold,
            )
            state.reorderFailures.forEach { failure ->
              val name = order.items.firstOrNull { item -> item.packId == failure.packId }?.productName
              Text(
                text = "${name ?: "One line"}: ${failure.message}",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
              )
            }
            Text(
              text = "The lines that were added are priced at today's rates — the price on this order is history.",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
        }
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
          "Reorder adds the same piece counts to your cart. The server re-checks stock, packs and " +
            "today's prices line by line, and tells you about any line it cannot add.",
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
