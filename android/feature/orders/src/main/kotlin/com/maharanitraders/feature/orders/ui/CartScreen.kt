package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
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
import com.maharanitraders.feature.orders.CartCheckoutUiState
import com.maharanitraders.feature.orders.CartCheckoutViewModel
import com.maharanitraders.feature.orders.CartLine
import com.maharanitraders.feature.orders.DeliveryAddress
import com.maharanitraders.feature.orders.OrderConfirmation

object CommerceTags {
  const val CART_SCREEN = "commerce_cart_screen"
  const val CART_ITEM = "commerce_cart_item"
  const val CART_EMPTY = "commerce_cart_empty"
  const val CART_CHECKOUT = "commerce_cart_checkout"
  const val CART_ADD = "commerce_cart_add"
  const val CART_QUANTITY = "commerce_cart_quantity"
  const val CHECKOUT_SCREEN = "commerce_checkout_screen"
  const val CHECKOUT_QUOTE = "commerce_checkout_quote"
  const val CHECKOUT_SUBMIT = "commerce_checkout_submit"
  const val ORDER_CONFIRMATION = "commerce_order_confirmation"
}

@Composable
fun CartScreen(
  onBrowseCatalog: () -> Unit,
  onViewOrders: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: CartCheckoutViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  when {
    state.confirmation != null -> OrderConfirmationContent(
      order = state.confirmation!!,
      onContinueShopping = viewModel::continueShopping,
      onViewOrders = onViewOrders,
      modifier = modifier,
    )
    state.checkoutOpen -> CheckoutContent(
      state = state,
      viewModel = viewModel,
      modifier = modifier,
    )
    else -> CartContent(
      state = state,
      viewModel = viewModel,
      onBrowseCatalog = onBrowseCatalog,
      modifier = modifier,
    )
  }
}

@Composable
private fun CartContent(
  state: CartCheckoutUiState,
  viewModel: CartCheckoutViewModel,
  onBrowseCatalog: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (state.cartLoading && state.cart == null) {
    LoadingState("Loading your shared cart…", modifier)
    return
  }
  if (state.cart == null && state.cartError != null) {
    if (state.cartOffline) OfflineState(modifier, onRetry = viewModel::refreshCart)
    else ErrorState(state.cartError, modifier, retryable = true, onRetry = viewModel::refreshCart)
    return
  }

  val cart = state.cart
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(16.dp)
      .testTag(CommerceTags.CART_SCREEN),
    verticalArrangement = Arrangement.spacedBy(16.dp),
  ) {
    Text("Your cart", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Text(
      "This is your persistent shop cart. Current prices and availability come from the server.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    if (state.pendingOrderUncertain) {
      NoticeCard(
        title = "An earlier order still needs confirmation",
        message = "Do not create a new order with a different request. Check the server status or retry the same request safely.",
        isError = true,
      )
      OutlinedButton(onClick = viewModel::checkPendingOrder) { Text("Check order status") }
    }
    state.orderError?.let {
      InlineMessage(it, isError = true)
      if (state.pendingOrderUncertain) {
        OutlinedButton(onClick = viewModel::checkPendingOrder) { Text("Check order status") }
      }
    }
    state.cartError?.let { InlineMessage(it, isError = true) }
    if (state.cartNeedsRefresh) {
      NoticeCard(
        title = "Shared cart needs to be refreshed",
        message = "The last change may have reached the server even though its response was lost. Review the refreshed cart before changing it again.",
        isError = true,
      )
    }
    if (state.cartNeedsRefresh || state.cartError != null) {
      OutlinedButton(
        onClick = viewModel::refreshCart,
        enabled = !state.cartLoading && !state.isCartMutating,
        modifier = Modifier.fillMaxWidth(),
      ) { Text(if (state.cartLoading) "Refreshing cart…" else "Refresh shared cart") }
    }
    state.message?.let { InlineMessage(it, onDismiss = viewModel::clearMessage) }

    if (cart?.lines.isNullOrEmpty()) {
      EmptyState(
        title = "Your cart is empty",
        message = "Add products from the live catalogue. The cart is shared with your signed-in shop account.",
        actionLabel = "Browse catalogue",
        onAction = onBrowseCatalog,
        modifier = Modifier.fillMaxWidth().height(260.dp).testTag(CommerceTags.CART_EMPTY),
      )
    } else {
      cart?.lines?.forEach { line ->
        CartLineCard(
          line = line,
          busy = state.isCartMutating || state.cartNeedsRefresh || state.cartLoading,
          onIncrease = { viewModel.increment(line.id) },
          onDecrease = { viewModel.decrement(line.id) },
          onRemove = { viewModel.removeCartLine(line.id) },
        )
      }

      cart?.let { snapshot ->
        CouponPanel(
          couponCode = snapshot.couponCode,
          couponUnavailable = snapshot.couponUnavailable,
          input = state.couponInput,
          busy = state.couponBusy || state.isCartMutating || state.cartLoading || state.cartNeedsRefresh,
          error = state.couponError,
          onInput = viewModel::setCouponInput,
          onApply = viewModel::applyCoupon,
          onRemove = viewModel::removeCoupon,
        )
      }

      Text(
        "Final subtotal, GST, eligible coupon discount, Coins and stock are rechecked in checkout.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Button(
        onClick = viewModel::beginCheckout,
        enabled = !state.isCartMutating && !state.cartNeedsRefresh && !state.cartLoading &&
          !state.addressesLoading && !state.orderSubmitting && !state.pendingOrderUncertain,
        modifier = Modifier.fillMaxWidth().testTag(CommerceTags.CART_CHECKOUT),
      ) {
        Text(when {
          state.pendingOrderUncertain -> "Check earlier order first"
          state.addressesLoading -> "Loading delivery details…"
          else -> "Review order"
        })
      }
    }

    OutlinedButton(onClick = onBrowseCatalog, modifier = Modifier.fillMaxWidth()) {
      Text("Continue browsing")
    }
  }
}

@Composable
private fun CartLineCard(
  line: CartLine,
  busy: Boolean,
  onIncrease: () -> Unit,
  onDecrease: () -> Unit,
  onRemove: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier.fillMaxWidth().testTag(CommerceTags.CART_ITEM),
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text(
        text = line.productName ?: "Unavailable product",
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
      )
      Text(
        text = line.packName ?: "Pack no longer available",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      Text(
        text = when (line.availability) {
          "in_stock" -> "In stock · final quantity is checked at order time"
          "out_of_stock" -> "Out of stock"
          else -> "Availability could not be confirmed"
        },
        style = MaterialTheme.typography.labelMedium,
        color = if (line.availability == "in_stock") MaterialTheme.colorScheme.primary
        else MaterialTheme.colorScheme.error,
      )
      line.message?.let {
        Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
      }
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
          Text(
            text = line.unitPricePaise?.let { "${MoneyFormat.formatPaise(it)} / piece" }
              ?: "Current price unavailable",
            style = MaterialTheme.typography.bodyMedium,
          )
          Text(
            text = line.lineTotalPaise?.let { "Current line amount ${MoneyFormat.formatPaise(it)}" }
              ?: "Line amount unavailable until repriced",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          line.gstPercent?.let { Text("GST rate ${formatPercent(it)}", style = MaterialTheme.typography.labelSmall) }
        }
        TextButton(onClick = onRemove, enabled = !busy) { Text("Remove") }
      }
      Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedButton(
          onClick = onDecrease,
          enabled = !busy && line.quantity - line.quantityIncrement >= (line.moq ?: 1),
          modifier = Modifier.testTag("${CommerceTags.CART_QUANTITY}_minus_${line.id}"),
        ) { Text("−") }
        Text(
          text = "${line.quantity} ${line.quantityUnit}",
          modifier = Modifier.width(116.dp).testTag("${CommerceTags.CART_QUANTITY}_${line.id}"),
          style = MaterialTheme.typography.titleSmall,
          textAlign = androidx.compose.ui.text.style.TextAlign.Center,
        )
        OutlinedButton(
          onClick = onIncrease,
          enabled = !busy && line.quantity < 100_000,
          modifier = Modifier.testTag("${CommerceTags.CART_QUANTITY}_plus_${line.id}"),
        ) { Text("+") }
        Spacer(Modifier.width(8.dp))
        line.moq?.let {
          Text("MOQ $it pcs · increment ${line.quantityIncrement}", style = MaterialTheme.typography.labelSmall)
        }
      }
    }
  }
}

@Composable
private fun CouponPanel(
  couponCode: String?,
  couponUnavailable: Boolean,
  input: String,
  busy: Boolean,
  error: String?,
  onInput: (String) -> Unit,
  onApply: () -> Unit,
  onRemove: () -> Unit,
) {
  Surface(
    color = MaterialTheme.colorScheme.surface,
    shape = RoundedCornerShape(16.dp),
    border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text("Coupon", style = MaterialTheme.typography.titleMedium)
      when {
        couponCode != null -> Row(verticalAlignment = Alignment.CenterVertically) {
          Text("Applied: $couponCode", modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
          TextButton(onClick = onRemove, enabled = !busy) { Text("Remove") }
        }
        couponUnavailable -> Text(
          "The applied coupon could not be checked. Refresh the cart before checkout.",
          color = MaterialTheme.colorScheme.error,
          style = MaterialTheme.typography.bodySmall,
        )
        else -> Row(verticalAlignment = Alignment.CenterVertically) {
          OutlinedTextField(
            value = input,
            onValueChange = onInput,
            label = { Text("Coupon code") },
            singleLine = true,
            enabled = !busy,
            modifier = Modifier.weight(1f),
          )
          Spacer(Modifier.width(8.dp))
          Button(onClick = onApply, enabled = !busy && input.isNotBlank()) {
            if (busy) CircularProgressIndicator(strokeWidth = 2.dp) else Text("Apply")
          }
        }
      }
      error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
private fun CheckoutContent(
  state: CartCheckoutUiState,
  viewModel: CartCheckoutViewModel,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(16.dp)
      .testTag(CommerceTags.CHECKOUT_SCREEN),
    verticalArrangement = Arrangement.spacedBy(14.dp),
  ) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = viewModel::returnToCart) { Text("← Cart") }
      Text("Checkout review", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    }
    Text(
      "Review the current server quote. Prices, GST, coupon eligibility, Coins and stock are checked again when the order is committed.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    if (state.addressesLoading) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(modifier = Modifier.padding(end = 12.dp))
        Text("Loading saved delivery addresses…")
      }
    } else if (state.addresses.isNotEmpty()) {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Delivery address", style = MaterialTheme.typography.titleMedium)
        state.addresses.forEach { address ->
          AddressChoice(
            address = address,
            selected = state.hasAddressSelection && address.id == state.selectedAddressId,
            onSelect = { viewModel.selectAddress(address) },
          )
        }
      }
    }

    state.cartError?.let { InlineMessage(it, isError = true) }

    state.quoteError?.let {
      if (state.quoteOffline) OfflineState(modifier = Modifier.fillMaxWidth().height(220.dp))
      else InlineMessage(it, isError = true)
      OutlinedButton(
        onClick = viewModel::refreshCheckout,
        enabled = !state.quoteLoading && !state.addressesLoading && !state.cartLoading,
      ) {
        Text("Refresh shared cart and quote")
      }
    }

    state.quote?.let { quote ->
      Column(
        modifier = Modifier.fillMaxWidth().testTag(CommerceTags.CHECKOUT_QUOTE),
        verticalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        Text("Server quote", style = MaterialTheme.typography.titleLarge)
        quote.lines.forEach { line ->
          Surface(
            shape = RoundedCornerShape(14.dp),
            color = MaterialTheme.colorScheme.surfaceContainerLow,
            border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
          ) {
            Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Text(line.productName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
              Text("${line.packName} · ${line.quantity} ${line.quantityUnit}", style = MaterialTheme.typography.bodySmall)
              Text("${MoneyFormat.formatPaise(line.unitPricePaise)} / piece", style = MaterialTheme.typography.bodySmall)
              Text("Line amount ${MoneyFormat.formatPaise(line.lineTotalPaise)} · GST ${formatPercent(line.gstPercent)}", style = MaterialTheme.typography.bodySmall)
              Text(
                when (line.availability) {
                  "in_stock" -> "In stock"
                  "out_of_stock" -> "Out of stock"
                  else -> "Stock could not be confirmed"
                },
                color = if (line.orderable) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.labelMedium,
              )
            }
          }
        }
        QuoteTotals(quote)
      }
    }

    OutlinedTextField(
      value = state.notes,
      onValueChange = viewModel::updateNotes,
      label = { Text("Order notes (optional)") },
      supportingText = { Text("Up to 1,000 characters") },
      minLines = 2,
      maxLines = 4,
      modifier = Modifier.fillMaxWidth(),
      enabled = !state.orderSubmitting,
    )

    state.orderError?.let { message ->
      NoticeCard(title = "Order status", message = message, isError = state.pendingOrderUncertain)
      if (state.pendingOrderUncertain) {
        OutlinedButton(
          onClick = viewModel::checkPendingOrder,
          enabled = !state.orderChecking && !state.orderSubmitting,
          modifier = Modifier.fillMaxWidth(),
        ) { Text(if (state.orderChecking) "Checking…" else "Check order status") }
        OutlinedButton(
          onClick = viewModel::submitOrder,
          enabled = state.quote != null && state.quote.lines.all { it.orderable } &&
            !state.orderChecking && !state.orderSubmitting,
          modifier = Modifier.fillMaxWidth(),
        ) { Text("Retry same request safely") }
      }
    }

    val quoteCanPlace = state.quote?.let { quote -> quote.lines.isNotEmpty() && quote.lines.all { it.orderable } } == true
    Button(
      onClick = viewModel::submitOrder,
      enabled = quoteCanPlace && state.hasAddressSelection && !state.quoteLoading &&
        !state.orderSubmitting && !state.orderChecking && !state.pendingOrderUncertain,
      modifier = Modifier.fillMaxWidth().testTag(CommerceTags.CHECKOUT_SUBMIT),
    ) {
      if (state.orderSubmitting) CircularProgressIndicator(strokeWidth = 2.dp)
      else Text("Place order")
    }
    if (state.quote == null && !state.quoteLoading && state.quoteError == null && state.hasAddressSelection) {
      OutlinedButton(onClick = viewModel::refreshCheckout, modifier = Modifier.fillMaxWidth()) {
        Text("Refresh cart and get current server quote")
      }
    }
    Text(
      "No payment is collected in this screen. The server confirms the order and applies the existing Coins rules.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

@Composable
private fun AddressChoice(
  address: DeliveryAddress,
  selected: Boolean,
  onSelect: () -> Unit,
) {
  Row(
    modifier = Modifier
      .fillMaxWidth()
      .clickable(onClick = onSelect)
      .padding(vertical = 6.dp),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    RadioButton(selected = selected, onClick = onSelect)
    Column(modifier = Modifier.weight(1f).padding(start = 8.dp)) {
      Text(address.label + if (address.isDefault) " · default" else "", style = MaterialTheme.typography.titleSmall)
      Text(address.line, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      val contact = listOfNotNull(address.receiverName, address.phone).joinToString(" · ")
      if (contact.isNotBlank()) Text(contact, style = MaterialTheme.typography.labelSmall)
    }
  }
}

@Composable
private fun QuoteTotals(quote: com.maharanitraders.feature.orders.CheckoutQuote) {
  Surface(
    shape = RoundedCornerShape(16.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
  ) {
    Column(
      modifier = Modifier.fillMaxWidth().padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
      Text("Order totals", style = MaterialTheme.typography.titleMedium)
      MoneyRow("Subtotal", quote.subtotalPaise)
      MoneyRow("GST", quote.gstTotalPaise)
      MoneyRow("Coupon discount", quote.discountTotalPaise, negative = true)
      HorizontalDivider()
      MoneyRow("Grand total", quote.grandTotalPaise, emphasized = true)
      MoneyRow("Coins available", quote.coinsBalancePaise)
      MoneyRow("Coins applied", quote.coinsUsedPaise, emphasized = quote.coinsUsedPaise > 0)
      MoneyRow("Coins balance after applying", quote.balanceAfterCoinsPaise, emphasized = true)
      quote.couponCode?.let { Text("Coupon verified: $it", style = MaterialTheme.typography.labelMedium) }
    }
  }
}

@Composable
private fun MoneyRow(
  label: String,
  paise: Long,
  negative: Boolean = false,
  emphasized: Boolean = false,
) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium)
    Text(
      text = (if (negative && paise > 0) "−" else "") + MoneyFormat.formatPaise(paise),
      style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
      fontWeight = if (emphasized) FontWeight.SemiBold else FontWeight.Normal,
    )
  }
}

@Composable
private fun OrderConfirmationContent(
  order: OrderConfirmation,
  onContinueShopping: () -> Unit,
  onViewOrders: () -> Unit,
  modifier: Modifier = Modifier,
) {
  Column(
    modifier = modifier
      .fillMaxSize()
      .verticalScroll(rememberScrollState())
      .padding(24.dp)
      .testTag(CommerceTags.ORDER_CONFIRMATION),
    verticalArrangement = Arrangement.spacedBy(16.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    Text(orderStatusHeading(order.status), style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
    Text(order.orderNumber, style = MaterialTheme.typography.titleLarge)
    Text("Server status: ${order.status}", style = MaterialTheme.typography.bodyLarge)
    Text("Placed (UTC): ${order.placedAt}", style = MaterialTheme.typography.bodyMedium)
    Text("Server-confirmed total: ${MoneyFormat.formatPaise(order.grandTotalPaise)}", style = MaterialTheme.typography.titleMedium)
    order.coinsUsedPaise?.let { Text("Coins used: ${MoneyFormat.formatPaise(it)}", style = MaterialTheme.typography.bodyMedium) }
    order.balanceAfterCoinsPaise?.let { Text("Coins balance after order: ${MoneyFormat.formatPaise(it)}", style = MaterialTheme.typography.bodyMedium) }
    if (order.idempotentReplay) {
      Text(
        "This is the original order recovered from the server after an uncertain response.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    Button(onClick = onViewOrders, modifier = Modifier.fillMaxWidth()) { Text("View my orders") }
    OutlinedButton(onClick = onContinueShopping, modifier = Modifier.fillMaxWidth()) { Text("Continue shopping") }
  }
}

@Composable
private fun NoticeCard(title: String, message: String, isError: Boolean) {
  val container = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer
  val content = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer
  Surface(color = container, contentColor = content, shape = RoundedCornerShape(14.dp)) {
    Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      Text(message, style = MaterialTheme.typography.bodySmall)
    }
  }
}

@Composable
private fun InlineMessage(
  message: String,
  isError: Boolean = false,
  onDismiss: (() -> Unit)? = null,
) {
  val container = if (isError) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.secondaryContainer
  val content = if (isError) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onSecondaryContainer
  Surface(color = container, contentColor = content, shape = RoundedCornerShape(12.dp)) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp),
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(message, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
      onDismiss?.let { TextButton(onClick = it) { Text("Dismiss") } }
    }
  }
}

internal fun orderStatusHeading(status: String): String = when (status.trim().lowercase()) {
  "pending" -> "Order received"
  "confirmed" -> "Order confirmed"
  "processing" -> "Order processing"
  "packed" -> "Order packed"
  "dispatched" -> "Order dispatched"
  "delivered" -> "Order delivered"
  "cancelled", "canceled" -> "Order cancelled"
  "returned" -> "Order returned"
  else -> "Order status"
}

private fun formatPercent(value: Double): String =
  if (value % 1.0 == 0.0) "${value.toInt()}%" else "$value%"
