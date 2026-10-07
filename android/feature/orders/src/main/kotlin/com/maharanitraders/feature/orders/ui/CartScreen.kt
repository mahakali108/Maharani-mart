package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.SubcomposeAsyncImage
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.SkeletonSurface
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.designsystem.theme.MaharaniThemeTokens
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.feature.orders.CartCheckoutUiState
import com.maharanitraders.feature.orders.CartCheckoutViewModel
import com.maharanitraders.feature.orders.CartLine
import com.maharanitraders.feature.orders.DeliveryAddress
import com.maharanitraders.feature.orders.OrderConfirmation
import com.maharanitraders.feature.orders.SavedCartsViewModel

object CommerceTags {
  const val CART_SCREEN = "commerce_cart_screen"
  const val CART_ITEM = "commerce_cart_item"
  const val CART_EMPTY = "commerce_cart_empty"
  const val CART_CHECKOUT = "commerce_cart_checkout"
  const val CART_ADD = "commerce_cart_add"
  const val CART_ITEM_IMAGE = "commerce_cart_item_image"
  const val CART_QUANTITY = "commerce_cart_quantity"
  const val SAVE_FOR_LATER = "commerce_save_for_later"
  const val CART_SAVE = "commerce_cart_save"
  const val CART_SAVE_NAME = "commerce_cart_save_name"
  const val CART_SAVE_CONFIRM = "commerce_cart_save_confirm"
  /** Cart 2.0: bulk selection, the server-change warnings and bulk actions. */
  const val CART_SELECT = "commerce_cart_select"
  const val CART_SELECTION_BAR = "commerce_cart_selection_bar"
  const val CART_NOTICES = "commerce_cart_notices"
  const val CART_REMOVE_SELECTED = "commerce_cart_remove_selected"
  const val CART_SAVE_SELECTED = "commerce_cart_save_selected"
  const val CART_CLEAR = "commerce_cart_clear"
  const val CHECKOUT_SCREEN = "commerce_checkout_screen"
  const val CHECKOUT_QUOTE = "commerce_checkout_quote"
  const val CHECKOUT_SUBMIT = "commerce_checkout_submit"
  const val CHECKOUT_ADD_ADDRESS = "commerce_checkout_add_address"
  const val ORDER_CONFIRMATION = "commerce_order_confirmation"
}

@Composable
fun CartScreen(
  onBrowseCatalog: () -> Unit,
  onViewOrders: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: CartCheckoutViewModel = hiltViewModel(),
  /**
   * Opens the address book from the checkout step — the entry point a
   * first-time buyer needs to create the address checkout requires.
   */
  onOpenAddressBook: () -> Unit = {},
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val savedCartsViewModel: SavedCartsViewModel = hiltViewModel()
  val savedCartsState by savedCartsViewModel.state.collectAsStateWithLifecycle()

  // Entering the cart (including coming back to the tab) asks the server for the
  // current basket: lines can have been added from the home/catalogue cards, an
  // order, or a restored saved cart while this screen was not on top. The call
  // is a no-op while a read or a mutation is already in flight.
  LaunchedEffect(Unit) {
    viewModel.refreshCartOnOpen()
  }
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
      onOpenAddressBook = onOpenAddressBook,
      modifier = modifier,
    )
    else -> CartContent(
      state = state,
      viewModel = viewModel,
      onBrowseCatalog = onBrowseCatalog,
      onSaveForLater = { lineId -> savedCartsViewModel.saveForLater(lineId, viewModel::refreshCart) },
      saveForLaterBusy = savedCartsState.savingKey?.startsWith("save-for-later:") == true,
      saveForLaterMessage = savedCartsState.message,
      saveForLaterError = savedCartsState.error,
      // Save the whole basket as a named list. The endpoint stores pack ids and
      // quantities only, and revalidates availability and minimums when the list
      // is restored — so a saved cart is a reorder shortcut, never a stored price.
      saveCartName = savedCartsState.createName,
      onSaveCartNameChange = savedCartsViewModel::onCreateName,
      onSaveCart = savedCartsViewModel::saveCurrentCart,
      saveCartBusy = savedCartsState.savingKey == "save",
      modifier = modifier,
    )
  }
}

@Composable
private fun CartContent(
  state: CartCheckoutUiState,
  viewModel: CartCheckoutViewModel,
  onBrowseCatalog: () -> Unit,
  onSaveForLater: (String) -> Unit,
  saveForLaterBusy: Boolean,
  saveForLaterMessage: String?,
  saveForLaterError: String?,
  saveCartName: String,
  onSaveCartNameChange: (String) -> Unit,
  onSaveCart: () -> Unit,
  saveCartBusy: Boolean,
  modifier: Modifier = Modifier,
) {
  // The dialog's own open/closed state. It is not in the ViewModel because it is
  // a property of this screen's composition, not of the cart.
  var saveDialogOpen by remember { mutableStateOf(false) }

  if (saveDialogOpen) {
    AlertDialog(
      onDismissRequest = { if (!saveCartBusy) saveDialogOpen = false },
      title = { Text("Save this cart") },
      text = {
        Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text(
            "Name this basket so you can restore it in one tap. Prices, stock and " +
              "minimums are checked again when you restore it.",
            style = MaterialTheme.typography.bodySmall,
          )
          OutlinedTextField(
            value = saveCartName,
            onValueChange = onSaveCartNameChange,
            singleLine = true,
            label = { Text("List name") },
            supportingText = { Text("Up to 60 characters") },
            modifier = Modifier
              .fillMaxWidth()
              .testTag(CommerceTags.CART_SAVE_NAME),
          )
        }
      },
      confirmButton = {
        TextButton(
          onClick = {
            onSaveCart()
            saveDialogOpen = false
          },
          enabled = saveCartName.isNotBlank() && !saveCartBusy,
          modifier = Modifier.testTag(CommerceTags.CART_SAVE_CONFIRM),
        ) {
          Text(if (saveCartBusy) "Saving…" else "Save cart")
        }
      },
      dismissButton = {
        TextButton(onClick = { saveDialogOpen = false }, enabled = !saveCartBusy) { Text("Cancel") }
      },
    )
  }
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
    // The outcome of a bulk action (remove selected, clear cart, save to
    // favourites): stated once, and dismissible, so a batch that partly failed
    // is never silently reported as a success.
    state.bulkMessage?.let { InlineMessage(it, onDismiss = viewModel::consumeBulkMessage) }
    saveForLaterError?.let { InlineMessage(it, isError = true) }
    saveForLaterMessage?.let { InlineMessage(it) }

    if (cart?.lines.isNullOrEmpty()) {
      EmptyState(
        title = "Your cart is empty",
        message = "Add products from the live catalogue. The cart is shared with your signed-in shop account.",
        actionLabel = "Browse Products",
        onAction = onBrowseCatalog,
        modifier = Modifier.fillMaxWidth().height(260.dp).testTag(CommerceTags.CART_EMPTY),
      )
    } else {
      // What the server changed since the last read. Each warning names the
      // line it belongs to and what moved — a silently re-priced basket is
      // exactly the failure this screen must not have.
      CartNoticeList(
        notices = state.cartNotices,
        onDismiss = viewModel::dismissNotices,
      )

      CartSelectionBar(
        state = state,
        onSelectAll = viewModel::selectAllOrderable,
        onClear = viewModel::clearSelection,
        onRemoveSelected = viewModel::removeSelected,
        onSaveSelected = viewModel::moveSelectedToFavourites,
        onClearCart = viewModel::clearCart,
        onSaveForLater = { onSaveForLater(it) },
        saveForLaterBusy = saveForLaterBusy,
      )

      cart?.lines?.forEach { line ->
        CartLineCard(
          line = line,
          selected = line.id in state.selectedLineIds,
          onToggleSelection = { viewModel.toggleLineSelection(line.id) },
          busy = state.isCartMutating || state.cartNeedsRefresh || state.cartLoading || state.bulkActionBusy,
          onIncrease = { viewModel.increment(line.id) },
          onDecrease = { viewModel.decrement(line.id) },
          onRemove = { viewModel.removeCartLine(line.id) },
          onSaveForLater = { onSaveForLater(line.id) },
          saveForLaterBusy = saveForLaterBusy,
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
      // Checkout is only offered when the SERVER considers every line
      // orderable (active pack, valid price for the current MOQ, positive
      // stock). A blocked line is explained above instead of letting the
      // shopper walk into a checkout the server will refuse.
      val blockedLine = cart?.lines?.firstOrNull { !it.orderable }
      Button(
        onClick = viewModel::beginCheckout,
        enabled = blockedLine == null && !state.isCartMutating && !state.cartNeedsRefresh &&
          !state.cartLoading && !state.addressesLoading && !state.orderSubmitting &&
          !state.pendingOrderUncertain,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)
          .testTag(CommerceTags.CART_CHECKOUT),
      ) {
        Text(when {
          state.pendingOrderUncertain -> "Check earlier order first"
          state.addressesLoading -> "Loading delivery details…"
          blockedLine != null -> "Fix unavailable items to check out"
          else -> "Proceed to Checkout"
        })
      }
      blockedLine?.let { line ->
        Text(
          text = "${line.productName ?: "An item"} cannot be ordered right now: " +
            (line.message ?: "it is out of stock or no longer priced for your shop.") +
            " Update or remove it to continue.",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
        )
      }
    }

    OutlinedButton(
      onClick = { saveDialogOpen = true },
      enabled = !state.isCartMutating && !state.cartNeedsRefresh && !state.cartLoading,
      modifier = Modifier
        .fillMaxWidth()
        .heightIn(min = MaharaniDimens.touchTarget)
        .testTag(CommerceTags.CART_SAVE),
    ) {
      Text("Save this cart")
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
  onSaveForLater: () -> Unit,
  saveForLaterBusy: Boolean,
  modifier: Modifier = Modifier,
  /** Whether this line is ticked for a bulk action. */
  selected: Boolean = false,
  onToggleSelection: () -> Unit = {},
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
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
      ) {
        // The checkbox is the row's bulk-action handle. It is a real checkbox
        // (not a coloured card) so TalkBack announces its state and the tick is
        // the state — colour is only reinforcement.
        Checkbox(
          checked = selected,
          onCheckedChange = { onToggleSelection() },
          modifier = Modifier
            .size(MaharaniDimens.touchTarget)
            .testTag("${CommerceTags.CART_SELECT}_${line.id}"),
        )
        CartLineImage(
          url = line.imageUrl,
          fallbackLabel = line.productName ?: line.packName ?: "Item",
          modifier = Modifier.size(72.dp).clip(RoundedCornerShape(14.dp)),
        )
        Column(
          modifier = Modifier.weight(1f),
          verticalArrangement = Arrangement.spacedBy(3.dp),
        ) {
          line.brandName?.let { brand ->
            Text(
              text = brand.uppercase(),
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
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
        }
      }
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
      TextButton(
        onClick = onSaveForLater,
        enabled = !busy && !saveForLaterBusy,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag("${CommerceTags.SAVE_FOR_LATER}_${line.id}"),
      ) { Text(if (saveForLaterBusy) "Saving for later…" else "Save for later") }
    }
  }
}

/**
 * Cart line artwork.
 *
 * Same rules as the catalogue's ProductImage: centred `Fit` on the shared
 * placeholder surface (never stretched, never cropped into an unreadable
 * label), the skeleton while the bytes arrive, and a monogram tile when there
 * is no image at all — a cart row must keep its shape in every state.
 */
@Composable
private fun CartLineImage(url: String?, fallbackLabel: String, modifier: Modifier = Modifier) {
  SubcomposeAsyncImage(
    model = url,
    contentDescription = fallbackLabel,
    contentScale = ContentScale.Fit,
    modifier = modifier
      .background(MaharaniThemeTokens.colors.imagePlaceholder)
      .testTag(CommerceTags.CART_ITEM_IMAGE),
    loading = { SkeletonSurface(modifier = Modifier.fillMaxSize()) },
    error = {
      Box(
        modifier = Modifier.fillMaxSize().background(MaharaniThemeTokens.colors.imagePlaceholder),
        contentAlignment = Alignment.Center,
      ) {
        Text(
          text = fallbackLabel.trim().take(1).uppercase(),
          style = MaterialTheme.typography.titleMedium,
          fontWeight = FontWeight.SemiBold,
          color = MaharaniThemeTokens.colors.onImagePlaceholder,
        )
      }
    },
  )
}

/**
 * What the server changed in this basket.
 *
 * These are WARNINGS, never silent edits: the app does not drop a line the
 * server re-priced, and does not adjust a quantity by itself. Each notice names
 * the line and states the change in the server's own figures, so the shopper
 * decides what to do about it.
 */
@Composable
private fun CartNoticeList(
  notices: List<CartLineNotice>,
  onDismiss: () -> Unit,
  modifier: Modifier = Modifier,
) {
  if (notices.isEmpty()) return
  val tokens = MaharaniThemeTokens.colors
  Surface(
    color = tokens.warningSurface,
    contentColor = tokens.warning,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier
      .fillMaxWidth()
      .testTag(CommerceTags.CART_NOTICES),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
      ) {
        Text(
          text = "Your cart changed",
          style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onDismiss, modifier = Modifier.heightIn(min = 40.dp)) { Text("Dismiss") }
      }
      notices.forEach { notice ->
        Text(
          text = "${notice.productName}: ${notice.detail}",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurface,
        )
      }
      Text(
        text = "Prices, stock and minimums are always the server's. Nothing has been changed for you.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

/**
 * The bulk-action bar.
 *
 * Every control here writes through the real cart endpoints — remove, save for
 * later — or the shared favourites store, so there is no local deletion that
 * could disagree with the server. The count is stated in words as well as
 * numbers, and "Clear cart" is a plain button because an accidental tap is
 * recoverable by re-adding, not by a support ticket.
 */
@Composable
private fun CartSelectionBar(
  state: CartCheckoutUiState,
  onSelectAll: () -> Unit,
  onClear: () -> Unit,
  onRemoveSelected: () -> Unit,
  onSaveSelected: () -> Unit,
  onClearCart: () -> Unit,
  onSaveForLater: (String) -> Unit,
  saveForLaterBusy: Boolean,
  modifier: Modifier = Modifier,
) {
  val selected = state.selectedLineIds
  Surface(
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    modifier = modifier
      .fillMaxWidth()
      .testTag(CommerceTags.CART_SELECTION_BAR),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Text(
          text = if (selected.isEmpty()) {
            "Select lines to act on them in bulk"
          } else {
            "${selected.size} line${if (selected.size == 1) "" else "s"} selected"
          },
          style = MaterialTheme.typography.titleSmall,
          modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onSelectAll, enabled = !state.bulkActionBusy) { Text("Select all") }
        if (selected.isNotEmpty()) {
          TextButton(onClick = onClear, enabled = !state.bulkActionBusy) { Text("Clear") }
        }
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        OutlinedButton(
          onClick = onSaveSelected,
          enabled = selected.isNotEmpty() && !state.bulkActionBusy,
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(CommerceTags.CART_SAVE_SELECTED),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) { Text("Save to favourites") }

        OutlinedButton(
          onClick = {
            if (selected.size == 1) onSaveForLater(selected.first())
          },
          enabled = selected.size == 1 && !state.bulkActionBusy && !saveForLaterBusy,
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) { Text("Save for later") }
      }

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        OutlinedButton(
          onClick = onRemoveSelected,
          enabled = selected.isNotEmpty() && !state.bulkActionBusy,
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(CommerceTags.CART_REMOVE_SELECTED),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) { Text(if (state.bulkActionBusy) "Working…" else "Remove selected") }

        OutlinedButton(
          onClick = onClearCart,
          enabled = state.cart?.lines?.isNotEmpty() == true && !state.bulkActionBusy,
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(CommerceTags.CART_CLEAR),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) { Text("Clear cart") }
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
  onOpenAddressBook: () -> Unit,
  modifier: Modifier = Modifier,
) {
  // Returning here from the address book re-reads the saved addresses from
  // the server, so an address created there is immediately selectable. The
  // call is a no-op while the initial load, a quote or a submit is in flight.
  LaunchedEffect(Unit) {
    viewModel.reloadAddressesIfStale()
  }

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
        OutlinedButton(
          onClick = onOpenAddressBook,
          enabled = !state.orderSubmitting,
          modifier = Modifier
            .fillMaxWidth()
            .padding(top = 4.dp)
            .testTag(CommerceTags.CHECKOUT_ADD_ADDRESS),
        ) {
          Text("Add a new address")
        }
      }
    } else {
      // No saved address yet: a first-time buyer must not hit a dead end
      // here — the address book is one tap away and checkout re-reads the
      // list when it comes back.
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Delivery address", style = MaterialTheme.typography.titleMedium)
        Text(
          "You have no saved delivery address yet. Add one to continue — checkout " +
            "re-reads your addresses when you return.",
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
          onClick = onOpenAddressBook,
          enabled = !state.orderSubmitting,
          modifier = Modifier
            .fillMaxWidth()
            .testTag(CommerceTags.CHECKOUT_ADD_ADDRESS),
        ) {
          Text("Add delivery address")
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
