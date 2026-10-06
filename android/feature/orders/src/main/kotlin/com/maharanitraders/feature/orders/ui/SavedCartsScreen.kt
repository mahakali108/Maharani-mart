package com.maharanitraders.feature.orders.ui

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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.orders.SavedCart
import com.maharanitraders.feature.orders.SavedCartsUiState
import com.maharanitraders.feature.orders.SavedCartsViewModel

private const val SAVE_FOR_LATER_NAME = "Saved for later"

object SavedCartsTags {
  const val SCREEN = "saved_carts_screen"
  const val SAVE = "saved_carts_save"
}

@Composable
fun SavedCartsScreen(
  onOpenCart: () -> Unit = {},
  modifier: Modifier = Modifier,
  viewModel: SavedCartsViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  var deleteTarget by remember { mutableStateOf<String?>(null) }

  if (state.loading && state.savedCarts.isEmpty()) {
    LoadingState("Loading your saved carts…", modifier)
    return
  }
  if (state.savedCarts.isEmpty() && state.error != null) {
    ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::load)
    return
  }

  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(SavedCartsTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Saved carts", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Saved lists keep product and pack identifiers only. Current price, stock and minimums are checked when you restore.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item {
      Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
          Text("Save the current cart", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
          OutlinedTextField(
            value = state.createName,
            onValueChange = viewModel::onCreateName,
            label = { Text("List name") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
          )
          Button(
            onClick = viewModel::saveCurrentCart,
            enabled = state.savingKey == null,
            modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SavedCartsTags.SAVE),
          ) {
            if (state.savingKey == "save") CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
            Text(if (state.savingKey == "save") "Saving…" else "Save current cart")
          }
        }
      }
    }
    state.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
    state.message?.let { item {
      Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(it, color = MaterialTheme.colorScheme.primary)
        if (it.contains("restored")) OutlinedButton(onClick = onOpenCart, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) { Text("View live cart") }
      }
    } }
    if (state.savedCarts.isEmpty()) {
      item {
        EmptyState(
          title = "No saved carts yet",
          message = "Save a live cart to keep a restock list. Saving does not lock in prices or availability.",
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
    items(state.savedCarts, key = { it.id }) { cart -> SavedCartCard(cart, state, viewModel, onDelete = { deleteTarget = cart.id }) }
  }

  deleteTarget?.let { id ->
    AlertDialog(
      onDismissRequest = { if (state.savingKey == null) deleteTarget = null },
      title = { Text("Delete saved cart?") },
      text = { Text("This removes the saved list. It does not change your live cart or any order.") },
      confirmButton = {
        TextButton(onClick = { viewModel.deleteCart(id); deleteTarget = null }, enabled = state.savingKey == null) { Text("Delete") }
      },
      dismissButton = { TextButton(onClick = { deleteTarget = null }, enabled = state.savingKey == null) { Text("Keep it") } },
    )
  }
}

@Composable
private fun SavedCartCard(
  cart: SavedCart,
  state: SavedCartsUiState,
  viewModel: SavedCartsViewModel,
  onDelete: () -> Unit,
) {
  val reserved = cart.name.trim().replace(Regex("\\s+"), " ").equals(SAVE_FOR_LATER_NAME, ignoreCase = true)
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      if (state.renameId == cart.id) {
        OutlinedTextField(value = state.renameName, onValueChange = viewModel::onRenameName, label = { Text("List name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Button(onClick = { viewModel.renameCart(cart.id) }, enabled = state.savingKey == null, modifier = Modifier.weight(1f).heightIn(min = MaharaniDimens.touchTarget)) { Text("Save name") }
          OutlinedButton(onClick = viewModel::cancelRename, enabled = state.savingKey == null, modifier = Modifier.weight(1f).heightIn(min = MaharaniDimens.touchTarget)) { Text("Cancel") }
        }
      } else {
        Text(cart.name, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        Text("${cart.items.size} item(s) · updated ${cart.updatedAt.replace('T', ' ').take(16)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (reserved) Text("Items you moved out of the live cart to save for later.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
          Button(
            onClick = { viewModel.restoreCart(cart.id) },
            enabled = state.savingKey == null,
            modifier = Modifier.weight(1f).heightIn(min = MaharaniDimens.touchTarget),
          ) {
            if (state.savingKey == "restore:${cart.id}") CircularProgressIndicator(Modifier.padding(end = 6.dp), strokeWidth = 2.dp)
            Text(if (state.savingKey == "restore:${cart.id}") "Restoring…" else "Restore")
          }
          if (!reserved) {
            OutlinedButton(onClick = { viewModel.beginRename(cart) }, enabled = state.savingKey == null, modifier = Modifier.weight(1f).heightIn(min = MaharaniDimens.touchTarget)) { Text("Rename") }
            TextButton(onClick = onDelete, enabled = state.savingKey == null, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) { Text("Delete") }
          }
        }
      }
      if (cart.items.isEmpty()) Text("This list is empty.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      cart.items.forEach { item ->
        Surface(color = MaterialTheme.colorScheme.surfaceContainerLow, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth()) {
          Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(item.productName ?: "Product unavailable", style = MaterialTheme.typography.titleSmall)
            Text("${item.packName ?: "Pack unavailable"} · ${item.quantity} pieces", style = MaterialTheme.typography.bodySmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
              TextButton(onClick = { viewModel.restoreItem(item.id) }, enabled = state.savingKey == null, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) { Text("Restore item") }
              TextButton(onClick = { viewModel.deleteItem(item.id) }, enabled = state.savingKey == null, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) { Text("Remove") }
            }
          }
        }
      }
    }
  }
}
