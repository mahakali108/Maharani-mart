package com.maharanitraders.feature.orders

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.datastore.AppPreferences
import com.maharanitraders.core.model.ApiErrorCode
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** State for the server-owned cart, review quote and confirmed-order surface. */
data class CartCheckoutUiState(
  val cartLoading: Boolean = true,
  val cart: CartSnapshot? = null,
  val cartError: String? = null,
  val cartErrorCode: ApiErrorCode? = null,
  val cartOffline: Boolean = false,
  val isCartMutating: Boolean = false,
  val cartNeedsRefresh: Boolean = false,
  val message: String? = null,
  val checkoutOpen: Boolean = false,
  val addressesLoading: Boolean = false,
  val addresses: List<DeliveryAddress> = emptyList(),
  val selectedAddressId: String? = null,
  val hasAddressSelection: Boolean = false,
  val quoteLoading: Boolean = false,
  val quote: CheckoutQuote? = null,
  val quoteError: String? = null,
  val quoteErrorCode: ApiErrorCode? = null,
  val quoteOffline: Boolean = false,
  val notes: String = "",
  val couponInput: String = "",
  val couponBusy: Boolean = false,
  val couponError: String? = null,
  val orderSubmitting: Boolean = false,
  val orderChecking: Boolean = false,
  val pendingOrderUncertain: Boolean = false,
  val orderError: String? = null,
  val orderErrorCode: ApiErrorCode? = null,
  val confirmation: OrderConfirmation? = null,
)

/**
 * Orchestrates commerce screens without caching money or inventing local cart
 * state. Cart changes are persisted by the authenticated API; quote and order
 * totals are copied unchanged from the server's paise-denominated responses.
 */
@HiltViewModel
class CartCheckoutViewModel @Inject constructor(
  private val repository: CommerceRepository,
  private val preferences: AppPreferences,
  /**
   * Receives the counts from every cart response this ViewModel gets, so the
   * shell badge counts the same server rows the cart screen renders. The badge
   * state is not duplicated here — the store owns it.
   */
  private val cartCounts: CartCountStore,
) : ViewModel() {

  private val _state = MutableStateFlow(CartCheckoutUiState())
  val state: StateFlow<CartCheckoutUiState> = _state.asStateFlow()

  init {
    viewModelScope.launch {
      restorePendingOrderThenCart()
    }
  }

  fun refreshCart() {
    viewModelScope.launch {
      if (!loadCartInternal()) return@launch
      val current = _state.value
      if (!current.checkoutOpen) return@launch
      if (current.cart?.lines.isNullOrEmpty()) {
        _state.update {
          it.copy(
            checkoutOpen = false,
            quote = null,
            quoteLoading = false,
            message = "The shared cart is now empty.",
          )
        }
      } else if (current.hasAddressSelection) {
        refreshQuote()
      }
    }
  }

  /** Retry address setup or refresh the shared basket and its server quote. */
  fun refreshCheckout() {
    if (!_state.value.hasAddressSelection) beginCheckout() else refreshCart()
  }

  /** Add the selected server pack using its server-reported MOQ as the intent. */
  fun addCartLine(packId: String, quantity: Int) {
    mutateCart { repository.addCartLine(packId, quantity) }
  }

  fun setQuantity(lineId: String, quantity: Int) {
    val line = _state.value.cart?.lines?.firstOrNull { it.id == lineId } ?: return
    val minimum = line.moq ?: 1
    if (quantity < minimum) {
      _state.update { it.copy(message = "Minimum order for this pack is $minimum pieces.") }
      return
    }
    if (quantity > 100_000) {
      _state.update { it.copy(message = "That quantity is above the allowed limit.") }
      return
    }
    mutateCart { repository.updateCartLine(lineId, quantity) }
  }

  fun increment(lineId: String) {
    val line = _state.value.cart?.lines?.firstOrNull { it.id == lineId } ?: return
    val minimum = line.moq ?: 1
    val target = if (line.quantity < minimum) minimum else line.quantity + line.quantityIncrement
    setQuantity(lineId, target)
  }

  fun decrement(lineId: String) {
    val line = _state.value.cart?.lines?.firstOrNull { it.id == lineId } ?: return
    val minimum = line.moq ?: 1
    val target = line.quantity - line.quantityIncrement
    if (target < minimum) {
      _state.update { it.copy(message = "Remove this line to go below its $minimum-piece minimum.") }
      return
    }
    setQuantity(lineId, target)
  }

  fun removeCartLine(lineId: String) {
    mutateCart { repository.removeCartLine(lineId) }
  }

  fun setCouponInput(value: String) {
    _state.update { it.copy(couponInput = value.take(40), couponError = null) }
  }

  fun applyCoupon() {
    val code = _state.value.couponInput.trim()
    if (code.isEmpty()) {
      _state.update { it.copy(couponError = "Enter a coupon code first.") }
      return
    }
    val current = _state.value
    if (current.couponBusy || current.isCartMutating || current.cartLoading || current.cartNeedsRefresh) return
    _state.update { it.copy(couponBusy = true, couponError = null, message = null) }
    viewModelScope.launch {
      when (val result = repository.applyCoupon(code)) {
        is AppResult.Success -> {
          _state.update { it.copy(couponInput = result.value.code, couponBusy = false, couponError = null) }
          if (loadCartInternal()) refreshQuoteIfOpen()
        }
        is AppResult.Failure -> _state.update {
          it.copy(couponBusy = false, couponError = result.error.message)
        }
      }
    }
  }

  fun removeCoupon() {
    val current = _state.value
    if (current.couponBusy || current.isCartMutating || current.cartLoading || current.cartNeedsRefresh) return
    _state.update { it.copy(couponBusy = true, couponError = null) }
    viewModelScope.launch {
      when (val result = repository.removeCoupon()) {
        is AppResult.Success -> {
          _state.update { it.copy(couponInput = "", couponBusy = false) }
          if (loadCartInternal()) refreshQuoteIfOpen()
        }
        is AppResult.Failure -> _state.update {
          it.copy(couponBusy = false, couponError = result.error.message)
        }
      }
    }
  }

  fun beginCheckout() {
    val cart = _state.value.cart ?: return
    if (cart.lines.isEmpty()) return
    if (_state.value.addressesLoading) return
    _state.update {
      it.copy(
        checkoutOpen = true,
        addressesLoading = true,
        addresses = emptyList(),
        hasAddressSelection = false,
        quote = null,
        quoteError = null,
        orderError = null,
      )
    }
    viewModelScope.launch {
      when (val result = repository.loadAddresses()) {
        is AppResult.Success -> {
          val addresses = result.value
          val selected = addresses.firstOrNull { it.isDefault } ?: addresses.firstOrNull()
          _state.update {
            it.copy(
              addressesLoading = false,
              addresses = addresses,
              selectedAddressId = selected?.id,
              hasAddressSelection = selected != null,
            )
          }
          if (selected != null) refreshQuote()
          else _state.update { it.copy(quoteError = NO_ADDRESSES_MESSAGE) }
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            addressesLoading = false,
            quoteError = result.error.message,
            quoteErrorCode = errorCode(result.error),
            quoteOffline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  fun returnToCart() {
    _state.update {
      it.copy(
        checkoutOpen = false,
        quote = null,
        quoteError = null,
        orderError = null,
      )
    }
  }

  fun selectAddress(address: DeliveryAddress) {
    if (_state.value.addresses.none { it.id == address.id && it.line == address.line }) return
    _state.update {
      it.copy(
        selectedAddressId = address.id,
        hasAddressSelection = true,
        quote = null,
        quoteError = null,
      )
    }
    refreshQuote()
  }

  /**
   * Re-reads the retailer's saved addresses from the server when checkout
   * becomes visible again — the case that matters is the shopper returning
   * from the address book, where they added the address checkout was missing.
   *
   * Deliberately narrow:
   *  - it only runs while checkout is open and nothing else is in flight, so
   *    it cannot race `beginCheckout`, a quote request or an order submit;
   *  - a selection that still exists is kept, otherwise the default (or
   *    first) address becomes selected — the same rule `beginCheckout` uses;
   *  - the quote is only re-requested when the selection actually changed or
   *    none exists yet, so coming back without changes costs nothing extra;
   *  - the addresses are the server's own rows from `GET /addresses`, never a
   *    local cache, and RLS scopes them to the caller's retailer.
   */
  fun reloadAddressesIfStale() {
    val current = _state.value
    if (!current.checkoutOpen || current.addressesLoading) return
    if (current.quoteLoading || current.orderSubmitting || current.orderChecking) return
    _state.update { it.copy(addressesLoading = true) }
    viewModelScope.launch {
      when (val result = repository.loadAddresses()) {
        is AppResult.Success -> {
          val addresses = result.value
          val previousId = _state.value.selectedAddressId
          val selected = addresses.firstOrNull { it.id == previousId }
            ?: addresses.firstOrNull { it.isDefault }
            ?: addresses.firstOrNull()
          val selectionChanged = selected?.id != previousId
          _state.update {
            it.copy(
              addressesLoading = false,
              addresses = addresses,
              selectedAddressId = selected?.id,
              hasAddressSelection = selected != null,
              quote = if (selected == null || selectionChanged) null else it.quote,
              quoteError = when {
                selected == null -> NO_ADDRESSES_MESSAGE
                selectionChanged -> null
                else -> it.quoteError
              },
            )
          }
          if (selected != null && (selectionChanged || _state.value.quote == null)) {
            refreshQuote()
          }
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            addressesLoading = false,
            quoteError = result.error.message,
            quoteErrorCode = errorCode(result.error),
            quoteOffline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  fun updateNotes(value: String) {
    _state.update { it.copy(notes = value.take(1000), quoteError = null) }
  }

  fun refreshQuote() {
    val current = _state.value
    val cart = current.cart
    if (cart == null || cart.lines.isEmpty() || !current.hasAddressSelection) return
    val intent = cart.lines.map { CartLineIntent(it.packId, it.quantity) }
    _state.update { it.copy(quoteLoading = true, quote = null, quoteError = null, orderError = null) }
    viewModelScope.launch {
      when (val result = repository.quote(intent, current.selectedAddressId)) {
        is AppResult.Success -> _state.update {
          it.copy(
            quoteLoading = false,
            quote = result.value,
            quoteError = null,
            quoteErrorCode = null,
            quoteOffline = false,
          )
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            quoteLoading = false,
            quote = null,
            quoteError = result.error.message,
            quoteErrorCode = errorCode(result.error),
            quoteOffline = result.error is AppError.Network,
          )
        }
      }
    }
  }

  fun setCouponInputInCheckout(value: String) = setCouponInput(value)

  /**
   * Place only after a fresh server quote. The idempotency key is saved before
   * the network call and retained for every ambiguous outcome. A retry first
   * asks the server to recover a completed order, then can safely reuse the
   * same key; the backend serializes duplicate keys in one transaction.
   */
  fun submitOrder() {
    val before = _state.value
    val quote = before.quote ?: return
    if (before.orderSubmitting || before.orderChecking || before.quoteLoading) return
    if (!before.hasAddressSelection || quote.lines.isEmpty() || quote.lines.any { !it.orderable }) return

    val intent = quote.lines.map { CartLineIntent(it.packId, it.quantity) }
    val addressId = before.selectedAddressId
    val notes = before.notes.trim()
    _state.update {
      it.copy(
        orderSubmitting = true,
        orderError = null,
        orderErrorCode = null,
        pendingOrderUncertain = false,
      )
    }
    viewModelScope.launch {
      val existingKey = try {
        preferences.pendingOrderRequestKey()
      } catch (cancellation: CancellationException) {
        throw cancellation
      } catch (_: Exception) {
        failOrder("The pending order could not be checked on this device. No order was sent.", uncertain = true)
        return@launch
      }

      if (existingKey != null) {
        when (val recovery = repository.recoverOrder(existingKey)) {
          is AppResult.Success -> {
            acceptRecoveredOrder(recovery.value)
            return@launch
          }
          is AppResult.Failure -> if (!isNotFound(recovery.error)) {
            failOrder(
              "We could not verify the previous order yet. Do not start another order; check again when connected.",
              errorCode(recovery.error),
              uncertain = true,
            )
            return@launch
          }
        }
      }

      val requestKey = try {
        existingKey ?: preferences.getOrCreatePendingOrderRequestKey()
      } catch (cancellation: CancellationException) {
        throw cancellation
      } catch (_: Exception) {
        failOrder("The order retry key could not be saved. No order was sent.", uncertain = true)
        return@launch
      }

      when (val result = repository.placeOrder(requestKey, intent, addressId, notes)) {
        is AppResult.Success -> acceptConfirmedOrder(result.value)
        is AppResult.Failure -> {
          val uncertain = isUncertain(result.error)
          failOrder(
            if (uncertain) {
              "We could not confirm whether the order was placed. Check its status before trying again."
            } else {
              result.error.message
            },
            errorCode(result.error),
            uncertain,
          )
        }
      }
    }
  }

  /** Explicit recovery affordance used after timeout, process restart or 5xx. */
  fun checkPendingOrder() {
    if (_state.value.orderChecking || _state.value.orderSubmitting) return
    _state.update { it.copy(orderChecking = true, orderError = null, orderErrorCode = null) }
    viewModelScope.launch {
      val requestKey = try {
        preferences.pendingOrderRequestKey()
      } catch (cancellation: CancellationException) {
        throw cancellation
      } catch (_: Exception) {
        failOrder("The order status could not be checked on this device.", uncertain = true)
        return@launch
      }
      if (requestKey == null) {
        _state.update { it.copy(orderChecking = false, pendingOrderUncertain = false) }
        return@launch
      }
      when (val result = repository.recoverOrder(requestKey)) {
        is AppResult.Success -> acceptRecoveredOrder(result.value)
        is AppResult.Failure -> {
          val notFound = isNotFound(result.error)
          _state.update {
            it.copy(
              orderChecking = false,
              pendingOrderUncertain = !notFound,
              orderError = if (notFound) {
                "No completed order is visible yet. The same request key will be reused safely on retry."
              } else {
                "We could not verify the previous order. Keep this request pending and check again."
              },
              orderErrorCode = errorCode(result.error),
            )
          }
        }
      }
    }
  }

  fun continueShopping() {
    _state.update {
      it.copy(
        confirmation = null,
        checkoutOpen = false,
        quote = null,
        notes = "",
        orderError = null,
        pendingOrderUncertain = false,
      )
    }
    refreshCart()
  }

  fun clearMessage() {
    _state.update { it.copy(message = null) }
  }

  private fun mutateCart(operation: suspend () -> AppResult<CartSnapshot>) {
    val current = _state.value
    // A lost add response may have committed. Never issue another cart write
    // against a snapshot whose server outcome is unknown; reconcile first.
    if (current.isCartMutating || current.cartLoading || current.cartNeedsRefresh) return
    _state.update { it.copy(isCartMutating = true, cartError = null, message = null, quote = null) }
    viewModelScope.launch {
      when (val result = operation()) {
        is AppResult.Success -> {
          cartCounts.record(result.value)
          _state.update {
            it.copy(
              isCartMutating = false,
              cart = result.value,
              cartError = null,
              cartErrorCode = null,
              cartOffline = false,
              cartNeedsRefresh = false,
              quote = null,
              message = "Your shared cart has been updated.",
            )
          }
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            isCartMutating = false,
            cartError = result.error.message,
            cartErrorCode = errorCode(result.error),
            cartOffline = result.error is AppError.Network,
            cartNeedsRefresh = it.cartNeedsRefresh || requiresCartRefresh(result.error),
          )
        }
      }
    }
  }

  private suspend fun loadCartInternal(): Boolean {
    val needsReconciliationReview = _state.value.cartNeedsRefresh
    _state.update { it.copy(cartLoading = true, cartError = null, cartErrorCode = null) }
    return when (val result = repository.loadCart()) {
      is AppResult.Success -> {
        cartCounts.record(result.value)
        _state.update {
          it.copy(
            cartLoading = false,
            cart = result.value,
            cartError = null,
            cartErrorCode = null,
            cartOffline = false,
            cartNeedsRefresh = false,
            message = if (needsReconciliationReview) {
              "The shared cart was refreshed from the server. Review its current contents before making another change."
            } else it.message,
          )
        }
        true
      }
      is AppResult.Failure -> {
        _state.update {
          it.copy(
            cartLoading = false,
            cartError = result.error.message,
            cartErrorCode = errorCode(result.error),
            cartOffline = result.error is AppError.Network,
          )
        }
        false
      }
    }
  }

  private suspend fun restorePendingOrderThenCart() {
    val requestKey = try {
      preferences.pendingOrderRequestKey()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      _state.update {
        it.copy(
          cartLoading = false,
          cartError = "Saved order recovery could not be checked. Refresh after reconnecting.",
          pendingOrderUncertain = true,
        )
      }
      return
    }

    if (requestKey != null) {
      _state.update { it.copy(orderChecking = true, pendingOrderUncertain = true) }
      when (val recovery = repository.recoverOrder(requestKey)) {
        is AppResult.Success -> {
          acceptRecoveredOrder(recovery.value)
          return
        }
        is AppResult.Failure -> _state.update {
          it.copy(
            orderChecking = false,
            pendingOrderUncertain = !isNotFound(recovery.error),
            orderError = if (isNotFound(recovery.error)) {
              "A previous order response was not received. Review the cart and retry with the same safe request key."
            } else {
              "A previous order may still need confirmation. Check its status before starting another order."
            },
            orderErrorCode = errorCode(recovery.error),
          )
        }
      }
    }
    loadCartInternal()
  }

  private suspend fun refreshQuoteIfOpen() {
    if (!_state.value.checkoutOpen) return
    refreshQuote()
  }

  private suspend fun acceptConfirmedOrder(order: OrderConfirmation) {
    clearPendingKeyQuietly()
    // The order consumed the cart; the badge must not keep counting it, so the
    // store is told immediately rather than waiting for the reload below.
    cartCounts.record(CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false))
    _state.update {
      it.copy(
        orderSubmitting = false,
        orderChecking = false,
        pendingOrderUncertain = false,
        orderError = null,
        orderErrorCode = null,
        confirmation = order,
        checkoutOpen = false,
        quote = null,
        cart = CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false),
      )
    }
    loadCartInternal()
  }

  private suspend fun acceptRecoveredOrder(order: RetailerOrder) {
    clearPendingKeyQuietly()
    cartCounts.record(CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false))
    _state.update {
      it.copy(
        orderSubmitting = false,
        orderChecking = false,
        pendingOrderUncertain = false,
        orderError = null,
        orderErrorCode = null,
        confirmation = OrderConfirmation(
          id = order.id,
          orderNumber = order.orderNumber,
          status = order.status,
          placedAt = order.placedAt,
          grandTotalPaise = order.grandTotalPaise,
          coinsUsedPaise = order.coinsUsedPaise,
          balanceAfterCoinsPaise = order.balanceAfterCoinsPaise,
          idempotentReplay = true,
        ),
        checkoutOpen = false,
        quote = null,
        cart = CartSnapshot(emptyList(), couponCode = null, couponUnavailable = false),
      )
    }
    loadCartInternal()
  }

  private suspend fun clearPendingKeyQuietly() {
    try {
      preferences.clearPendingOrderRequestKey()
    } catch (cancellation: CancellationException) {
      throw cancellation
    } catch (_: Exception) {
      // If local clearing fails, the next launch safely recovers the same order.
    }
  }

  private fun failOrder(message: String, code: ApiErrorCode? = null, uncertain: Boolean) {
    _state.update {
      it.copy(
        orderSubmitting = false,
        orderChecking = false,
        orderError = message,
        orderErrorCode = code,
        pendingOrderUncertain = uncertain,
        // A definitive server rejection did not create an order. Require a
        // fresh server cart/quote before another attempt so repricing, stock,
        // coupon and MOQ changes are visible before the user confirms again.
        quote = if (uncertain) it.quote else null,
        quoteError = if (uncertain) it.quoteError else "Refresh the shared cart and quote before trying again.",
        quoteErrorCode = if (uncertain) it.quoteErrorCode else code,
        quoteOffline = false,
      )
    }
  }

  private fun requiresCartRefresh(error: AppError): Boolean =
    error.retryable || (error as? AppError.Api)?.code == ApiErrorCode.CONFLICT

  private fun errorCode(error: AppError): ApiErrorCode? = (error as? AppError.Api)?.code

  private fun isNotFound(error: AppError): Boolean =
    (error as? AppError.Api)?.code == ApiErrorCode.NOT_FOUND

  private fun isUncertain(error: AppError): Boolean = when (error) {
    is AppError.Network, is AppError.Unexpected -> true
    is AppError.Api -> error.retryable || error.code == ApiErrorCode.CONFLICT ||
      error.code == ApiErrorCode.IDEMPOTENCY_CONFLICT
  }

  companion object {
    /**
     * Shown when checkout has no saved address to offer — both on first entry
     * and when a reload still finds none. The address book (one navigation
     * away from checkout) is where the address gets created.
     */
    const val NO_ADDRESSES_MESSAGE =
      "Add a saved delivery address or registered shop address before placing an order."
  }
}
