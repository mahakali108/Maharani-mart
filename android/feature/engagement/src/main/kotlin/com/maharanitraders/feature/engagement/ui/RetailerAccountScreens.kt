package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.network.dto.MobileNotificationPreferencesDto
import com.maharanitraders.feature.engagement.HelpViewModel
import com.maharanitraders.feature.engagement.NotificationPreferencesViewModel
import com.maharanitraders.feature.engagement.RetailerProfileViewModel
import com.maharanitraders.feature.engagement.SchemesViewModel

object RetailerAccountTags {
  const val PROFILE = "retailer_profile_screen"
  const val SHOP_SAVE = "profile_shop_save"
  const val CONTACT_SAVE = "profile_contact_save"
  const val PREFERENCES = "notification_preferences_screen"
  const val SCHEMES = "schemes_screen"
  const val HELP = "help_screen"
}

@Composable
fun RetailerProfileScreen(
  modifier: Modifier = Modifier,
  viewModel: RetailerProfileViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  if (state.loading && state.profile == null) {
    LoadingState("Loading your profile…", modifier)
    return
  }
  if (state.profile == null && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(RetailerAccountTags.PROFILE),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Shop profile", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Update the contact and shop details available for your account.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    state.profile?.let { profile ->
      item {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
          Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text("Account status", style = MaterialTheme.typography.labelLarge)
            Text(profile.status.replace('_', ' ').replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.bodyLarge)
            profile.gstin?.takeIf(String::isNotBlank)?.let { Text("GSTIN: $it", style = MaterialTheme.typography.bodySmall) }
            Text("GST registration and approval status are managed by Maharani Traders.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Shop details", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          OutlinedTextField(
            value = state.shopName,
            onValueChange = viewModel::onShopName,
            label = { Text("Shop name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
          )
          OutlinedTextField(
            value = state.address,
            onValueChange = viewModel::onAddress,
            label = { Text("Shop address") },
            minLines = 2,
            maxLines = 4,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
            modifier = Modifier.fillMaxWidth(),
          )
          Button(
            onClick = viewModel::saveShop,
            enabled = state.saving == null,
            modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(RetailerAccountTags.SHOP_SAVE),
          ) {
            if (state.saving == "shop") CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
            Text(if (state.saving == "shop") "Saving…" else "Save shop details")
          }
        }
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Contact details", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          OutlinedTextField(
            value = state.fullName,
            onValueChange = viewModel::onFullName,
            label = { Text("Full name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
          )
          OutlinedTextField(
            value = state.phone,
            onValueChange = viewModel::onPhone,
            label = { Text("Mobile number") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
          )
          Button(
            onClick = viewModel::saveContact,
            enabled = state.saving == null,
            modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(RetailerAccountTags.CONTACT_SAVE),
          ) {
            if (state.saving == "contact") CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
            Text(if (state.saving == "contact") "Saving…" else "Save contact details")
          }
        }
      }
    }
    state.error?.let { error -> item { InlineError(error) } }
    state.message?.let { message -> item { InlineMessage(message) } }
    item {
      Text(
        "Your shop area, GST registration, Coins limit, approval and account status cannot be edited here.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

@Composable
fun NotificationPreferencesScreen(
  modifier: Modifier = Modifier,
  viewModel: NotificationPreferencesViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  if (state.loading && state.preferences == null) {
    LoadingState("Loading notification settings…", modifier)
    return
  }
  if (state.preferences == null && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }
  val preferences = state.preferences ?: MobileNotificationPreferencesDto()
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(RetailerAccountTags.PREFERENCES),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Notification preferences", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Choose which in-app update categories you want to receive.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item { PreferenceRow("Order updates", "Order status and delivery progress", preferences.orderUpdates, !state.saving, viewModel::setOrderUpdates) }
    item { PreferenceRow("Payment updates", "Payments and payment confirmations", preferences.paymentUpdates, !state.saving, viewModel::setPaymentUpdates) }
    item { PreferenceRow("Coins updates", "Coins wallet activity and adjustments", preferences.walletUpdates, !state.saving, viewModel::setWalletUpdates) }
    item { PreferenceRow("Optional offers", "Saving your choice does not enable messages until approved", preferences.offerUpdates, !state.saving, viewModel::setOfferUpdates) }
    item {
      Button(onClick = viewModel::save, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) {
        if (state.saving) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
        Text(if (state.saving) "Saving…" else "Save preferences")
      }
    }
    state.error?.let { item { InlineError(it) } }
    state.message?.let { item { InlineMessage(it) } }
  }
}

@Composable
private fun PreferenceRow(title: String, subtitle: String, checked: Boolean, enabled: Boolean, onCheckedChange: (Boolean) -> Unit) {
  Surface(
    onClick = { onCheckedChange(!checked) },
    enabled = enabled,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
  ) {
    Row(
      modifier = Modifier.fillMaxWidth().padding(horizontal = MaharaniDimens.spaceMd, vertical = MaharaniDimens.spaceSm),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Column(Modifier.weight(1f)) {
        Text(title, style = MaterialTheme.typography.titleSmall)
        Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Switch(checked = checked, onCheckedChange = onCheckedChange, enabled = enabled)
    }
  }
}

@Composable
fun SchemesScreen(
  modifier: Modifier = Modifier,
  viewModel: SchemesViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  if (state.loading && state.schemes.isEmpty()) {
    LoadingState("Checking active schemes…", modifier)
    return
  }
  if (state.schemes.isEmpty() && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }
  if (state.schemes.isEmpty()) {
    EmptyState(
      title = "No active schemes",
      message = "There are no live schemes for retailers right now. Check again later.",
      actionLabel = "Refresh",
      onAction = viewModel::load,
      modifier = modifier.fillMaxSize().testTag(RetailerAccountTags.SCHEMES),
    )
    return
  }
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(RetailerAccountTags.SCHEMES),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item { Text("Active schemes", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold) }
    items(state.schemes, key = { it.id }) { scheme ->
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(6.dp)) {
          Text(scheme.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          if (scheme.isFestival) Text("Festival scheme", color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.labelMedium)
          scheme.description?.takeIf(String::isNotBlank)?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
          Text("Valid ${scheme.startsAt.take(10)} – ${scheme.endsAt.take(10)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

private val retailerHelpFaqs = listOf(
  "How are wholesale prices calculated?" to "Maharani Traders applies your retailer or area price on the server. The price you see is a preview — checkout recalculates it and does not trust a device-submitted amount.",
  "Why can’t I add less than the MOQ?" to "Each pack has a minimum order quantity. The cart and checkout both re-check the current minimum before an order is created.",
  "How do Coins work?" to "Coins are your shop balance — 1 Coin = ₹1. Your distributor funds the balance, and the server applies available Coins at checkout. Any remaining amount is payable on delivery; the quote is re-checked before you place the order.",
  "Can I cancel or return an order?" to "Pending orders can be cancelled. Delivered orders can request a return. Both actions are checked against the real order status and return window on the server.",
  "Where do invoices come from?" to "Open a confirmed or later order and choose Invoice. Invoice totals come from the amounts stored when that order was placed.",
)

@Composable
fun HelpScreen(
  onOpenSupport: () -> Unit,
  onOpenOrders: () -> Unit = {},
  onOpenCoins: () -> Unit = {},
  onOpenCatalog: () -> Unit = {},
  modifier: Modifier = Modifier,
  viewModel: HelpViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  if (state.loading && state.details == null) {
    LoadingState("Loading help details…", modifier)
    return
  }
  if (state.details == null && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }
  val details = state.details
  val uriHandler = LocalUriHandler.current
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(RetailerAccountTags.HELP),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Help centre", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text(details?.companyName ?: "Maharani Traders", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(8.dp)) {
          Text("Need help with an order?", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Text("Raise a private support ticket. The team can reply in the same conversation.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          Button(onClick = onOpenSupport, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("Open support tickets") }
        }
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Quick links", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          Button(onClick = onOpenOrders, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("Order issue · open my orders") }
          Button(onClick = onOpenCoins, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("Coins issue · view my balance") }
          Button(onClick = onOpenCatalog, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("Product issue · browse catalogue") }
          Button(onClick = onOpenOrders, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("Delivery issue · track an order") }
        }
      }
    }
    details?.supportPhone?.let { phone ->
      item {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
          Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Call retailer support", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Text(phone, style = MaterialTheme.typography.bodyLarge)
            Button(
              onClick = { runCatching { uriHandler.openUri("tel:${phone.filter { it.isDigit() || it == '+' }}") } },
              modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
            ) { Text("Call ${details.companyName}") }
          }
        }
      }
    }
    item {
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
        Text("Frequently asked questions", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        retailerHelpFaqs.forEach { (question, answer) ->
          Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
            Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
              Text(question, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
              Text(answer, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
          }
        }
      }
    }
  }
}

@Composable
private fun InlineError(text: String) {
  Text(text, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
}

@Composable
private fun InlineMessage(text: String) {
  Text(text, color = MaterialTheme.colorScheme.primary, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp))
}
