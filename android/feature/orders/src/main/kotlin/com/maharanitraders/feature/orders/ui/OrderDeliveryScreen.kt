package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.maharanitraders.core.designsystem.MoneyFormat
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.orders.DeliveryItem
import com.maharanitraders.feature.orders.DeliveryUiState
import com.maharanitraders.feature.orders.DeliveryViewModel
import com.maharanitraders.feature.orders.OrderDelivery

/** Test tags for the delivery-record surface. */
object DeliveryTags {
  const val SCREEN = "delivery_screen"
  const val ITEM = "delivery_item"
  const val SIGNATURE = "delivery_signature"
  const val PHOTO = "delivery_photo"
}

/**
 * The delivery record: who delivered, when, what actually changed hands, the
 * proof the delivery captured and the server-decided return window.
 *
 * Read-only by design — retailers can never edit delivery data (RLS grants them
 * the read only). Every timestamp and quantity is the server's own record; the
 * return window is the server's inclusive-deadline decision, never a local
 * date comparison.
 */
@Composable
fun OrderDeliveryScreen(
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: DeliveryViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  OrderDeliveryContent(state = state, onRetry = viewModel::load, onBack = onBack, modifier = modifier)
}

@Composable
fun OrderDeliveryContent(
  state: DeliveryUiState,
  onRetry: () -> Unit,
  onBack: () -> Unit,
  modifier: Modifier = Modifier,
) {
  val delivery = state.delivery
  if (state.loading && delivery == null) {
    LoadingState("Loading the delivery record…", modifier)
    return
  }
  if (delivery == null) {
    if (state.offline) {
      OfflineState(modifier, onRetry = onRetry)
    } else {
      ErrorState(
        state.error ?: "This delivery record could not be loaded.",
        modifier,
        retryable = true,
        onRetry = onRetry,
      )
    }
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(DeliveryTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Delivery record", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(delivery.orderNumber, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(deliveryStatusLabel(delivery.status), style = MaterialTheme.typography.titleSmall)
        Text("Order total ${MoneyFormat.formatPaise(delivery.grandTotalPaise)}", style = MaterialTheme.typography.bodySmall)
      }
    }

    delivery.failureReason?.takeIf { it.isNotBlank() }?.let { reason ->
      item {
        Surface(
          color = MaterialTheme.colorScheme.errorContainer,
          contentColor = MaterialTheme.colorScheme.onErrorContainer,
          shape = RoundedCornerShape(12.dp),
          modifier = Modifier.fillMaxWidth(),
        ) {
          Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Last attempt could not be completed", style = MaterialTheme.typography.titleSmall)
            Text(reason, style = MaterialTheme.typography.bodySmall)
            Text(
              "Your order is being prepared for another delivery attempt.",
              style = MaterialTheme.typography.labelSmall,
            )
          }
        }
      }
    }

    item {
      DeliveryCard(title = "Delivery summary") {
        DeliveryFact("Delivery person", delivery.assignedName ?: "Being assigned")
        DeliveryFact("Dispatched", delivery.dispatchedAt ?: "—")
        DeliveryFact("Delivered", delivery.deliveredAt ?: "—")
        DeliveryFact("Received by", delivery.receiverName ?: "—")
        DeliveryFact("OTP verification", if (delivery.otpVerified) "Verified at handover" else "Not yet verified")
      }
    }

    delivery.shippingAddressLine?.let { address ->
      item {
        DeliveryCard(title = "Address") { Text(address, style = MaterialTheme.typography.bodyMedium) }
      }
    }

    item {
      DeliveryCard(title = "Return window") {
        val deadline = delivery.returnDeadline
        val open = delivery.returnWindowOpen
        when {
          deadline == null -> Text(
            "A return window is set when the delivery is completed.",
            style = MaterialTheme.typography.bodyMedium,
          )
          open == true -> Text(
            "You can request a return until $deadline (inclusive).",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary,
          )
          else -> Text(
            "The return window closed on $deadline.",
            style = MaterialTheme.typography.bodyMedium,
          )
        }
      }
    }

    if (delivery.proof.signatureCaptured || delivery.proof.photoCaptured) {
      item {
        DeliveryCard(title = "Proof of delivery") {
          if (delivery.proof.signatureUrl != null) {
            AsyncImage(
              model = delivery.proof.signatureUrl,
              contentDescription = "Signature captured at handover",
              contentScale = ContentScale.Fit,
              modifier = Modifier
                .fillMaxWidth()
                .height(160.dp)
                .testTag(DeliveryTags.SIGNATURE),
            )
            Text("Signature at handover", style = MaterialTheme.typography.labelSmall)
          }
          if (delivery.proof.photoUrl != null) {
            AsyncImage(
              model = delivery.proof.photoUrl,
              contentDescription = "Photograph captured at delivery",
              contentScale = ContentScale.Fit,
              modifier = Modifier
                .fillMaxWidth()
                .height(200.dp)
                .testTag(DeliveryTags.PHOTO),
            )
            Text("Delivery photograph", style = MaterialTheme.typography.labelSmall)
          }
        }
      }
    }

    item {
      DeliveryCard(title = "What was delivered") {
        if (delivery.items.isEmpty()) {
          Text("The server returned no delivery lines for this order.", style = MaterialTheme.typography.bodySmall)
        }
      }
    }

    items(delivery.items, key = { item -> item.id }) { item -> DeliveryItemRow(item) }

    if (delivery.hasShortfall) {
      item {
        Text(
          "Missing or damaged items refund coins to your balance — you never pay for goods you did not receive. " +
            "The refund appears in your coin history.",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }

    delivery.deliveryNotes?.takeIf { it.isNotBlank() }?.let { notes ->
      item { DeliveryCard(title = "Delivery notes") { Text(notes, style = MaterialTheme.typography.bodyMedium) } }
    }

    item { OutlinedButton(onClick = onBack, modifier = Modifier.fillMaxWidth()) { Text("Back") } }
  }
}

@Composable
private fun DeliveryCard(title: String, content: @Composable () -> Unit) {
  Surface(
    shape = RoundedCornerShape(18.dp),
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(
      modifier = Modifier.padding(16.dp),
      verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
      Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
      content()
    }
  }
}

@Composable
private fun DeliveryFact(label: String, value: String) {
  Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Text(value, style = MaterialTheme.typography.bodySmall)
  }
}

@Composable
private fun DeliveryItemRow(item: DeliveryItem) {
  Column(
    modifier = Modifier.fillMaxWidth().testTag(DeliveryTags.ITEM),
    verticalArrangement = Arrangement.spacedBy(2.dp),
  ) {
    Text(item.productName ?: "Product", style = MaterialTheme.typography.titleSmall)
    Text(
      "${item.packName ?: "Pack"} · ordered ${item.quantityOrdered} · delivered ${item.quantityDelivered}",
      style = MaterialTheme.typography.bodySmall,
    )
    if (item.quantityMissing > 0 || item.quantityDamaged > 0) {
      Text(
        "Missing ${item.quantityMissing} · damaged ${item.quantityDamaged}",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
      )
    }
  }
}

/** Delivery statuses as the delivery workflows name them. */
internal fun deliveryStatusLabel(status: String): String = when (status.trim().lowercase()) {
  "assigned" -> "Assigned to a delivery person"
  "in_progress" -> "Out for delivery"
  "delivered" -> "Delivered"
  "partially_delivered" -> "Partially delivered"
  "failed" -> "Delivery attempt failed"
  "returned_to_warehouse" -> "Returned to warehouse"
  else -> status.replace('_', ' ').replaceFirstChar { it.uppercase() }
}
