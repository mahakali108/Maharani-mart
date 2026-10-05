package com.maharanitraders.feature.orders.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.components.OfflineState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.orders.AddressBookViewModel
import com.maharanitraders.feature.orders.AddressDraft
import com.maharanitraders.feature.orders.DeliveryAddress

object AddressBookTags {
  const val SCREEN = "address_book_screen"
  const val ITEM = "address_book_item"
  const val ADD = "address_book_add"
  const val DEFAULT_BADGE = "address_book_default_badge"
  const val DELETE = "address_book_delete"
  const val CONFIRM_DELETE = "address_book_confirm_delete"
  const val EDITOR = "address_book_editor"
  const val SAVE = "address_book_save"
}

/**
 * The retailer's delivery address book.
 *
 * Every row is the server's own saved address; every action is a real API call
 * whose response replaces the list, so the default flag and the ordering are
 * whatever the database decided. The registered shop address appears as a
 * non-editable row because checkout can still deliver there — the app does not
 * pretend it is a saved address, and it cannot be deleted.
 */
@Composable
fun AddressBookScreen(
  modifier: Modifier = Modifier,
  viewModel: AddressBookViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  val snackbarHostState = remember { SnackbarHostState() }

  LaunchedEffect(state.actionMessage) {
    val message = state.actionMessage ?: return@LaunchedEffect
    snackbarHostState.showSnackbar(message)
    viewModel.consumeActionMessage()
  }

  if (state.loading && state.addresses.isEmpty()) {
    LoadingState("Loading your delivery addresses…", modifier)
    return
  }
  if (state.errorMessage != null && state.addresses.isEmpty()) {
    if (state.offline) {
      OfflineState(modifier, onRetry = viewModel::retry)
    } else {
      ErrorState(state.errorMessage.orEmpty(), modifier, retryable = state.retryable, onRetry = viewModel::retry)
    }
    return
  }
  if (state.isEmpty) {
    EmptyState(
      title = "No delivery addresses yet",
      message = "Save the shop, godown or a delivery point so checkout has somewhere to send the order.",
      actionLabel = "Add address",
      onAction = viewModel::openCreate,
      modifier = modifier.fillMaxSize().testTag(AddressBookTags.SCREEN),
    )
    return
  }

  Column(modifier = modifier.fillMaxSize().testTag(AddressBookTags.SCREEN)) {
    LazyColumn(
      contentPadding = PaddingValues(MaharaniDimens.pageGutter),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      modifier = Modifier.weight(1f),
    ) {
      item {
        Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
          Text(
            text = "Delivery addresses",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.SemiBold,
          )
          Text(
            text = "Choose where each order goes. The default address is preselected at checkout.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        }
      }
      items(state.addresses, key = { it.id ?: "shop-address" }) { address ->
        AddressCard(
          address = address,
          busy = state.busyId == address.id,
          onEdit = { address.id?.let(viewModel::openEdit) },
          onSetDefault = { address.id?.let(viewModel::setDefault) },
          onDelete = { address.id?.let(viewModel::requestDelete) },
        )
      }
      item {
        Button(
          onClick = viewModel::openCreate,
          modifier = Modifier.fillMaxWidth().testTag(AddressBookTags.ADD),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        ) {
          Text("Add a new address")
        }
      }
    }
    SnackbarHost(hostState = snackbarHostState)
  }

  if (state.editorOpen) {
    AddressEditorDialog(
      draft = state.draft,
      fieldErrors = state.fieldErrors,
      saving = state.saving,
      editingExisting = state.editingExisting,
      onDraftChange = viewModel::updateDraft,
      onDismiss = viewModel::closeEditor,
      onSave = viewModel::save,
    )
  }

  state.confirmDeleteId?.let { addressId ->
    val address = state.addresses.firstOrNull { it.id == addressId }
    AlertDialog(
      onDismissRequest = viewModel::cancelDelete,
      title = { Text("Delete this address?") },
      text = { Text(address?.label?.let { "“$it” will be removed from your saved addresses." } ?: "This address will be removed.") },
      confirmButton = {
        TextButton(onClick = viewModel::confirmDelete, modifier = Modifier.testTag(AddressBookTags.CONFIRM_DELETE)) {
          Text("Delete")
        }
      },
      dismissButton = { TextButton(onClick = viewModel::cancelDelete) { Text("Cancel") } },
    )
  }
}

@Composable
private fun AddressCard(
  address: DeliveryAddress,
  busy: Boolean,
  onEdit: () -> Unit,
  onSetDefault: () -> Unit,
  onDelete: () -> Unit,
) {
  Surface(
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    tonalElevation = 1.dp,
    modifier = Modifier.fillMaxWidth().testTag(AddressBookTags.ITEM),
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
          text = address.label,
          style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.SemiBold,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
          modifier = Modifier.weight(1f, fill = false),
        )
        if (address.isDefault) {
          Surface(
            shape = RoundedCornerShape(50),
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.testTag(AddressBookTags.DEFAULT_BADGE),
          ) {
            Text(
              text = "Default",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onPrimaryContainer,
              modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            )
          }
        }
      }
      Text(
        text = address.line,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
      address.receiverName?.let { receiver ->
        Text(
          text = listOfNotNull(receiver, address.phone).joinToString(" · "),
          style = MaterialTheme.typography.labelMedium,
        )
      }
      HorizontalDivider(modifier = Modifier.padding(vertical = MaharaniDimens.spaceXxs))
      if (busy) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        }
      } else if (address.isEditable) {
        Row(horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
          if (!address.isDefault) {
            OutlinedButton(onClick = onSetDefault) { Text("Set as default") }
          }
          OutlinedButton(onClick = onEdit) { Text("Edit") }
          TextButton(onClick = onDelete, modifier = Modifier.testTag(AddressBookTags.DELETE)) {
            Text("Delete", color = MaterialTheme.colorScheme.error)
          }
        }
      } else {
        Text(
          text = "Registered shop address — update it in the shop profile.",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
    }
  }
}

@Composable
private fun AddressEditorDialog(
  draft: AddressDraft,
  fieldErrors: Map<String, String>,
  saving: Boolean,
  editingExisting: Boolean,
  onDraftChange: (AddressDraft) -> Unit,
  onDismiss: () -> Unit,
  onSave: () -> Unit,
) {
  AlertDialog(
    onDismissRequest = onDismiss,
    modifier = Modifier.testTag(AddressBookTags.EDITOR),
    title = { Text(if (editingExisting) "Edit address" else "New delivery address") },
    text = {
      Column(
        modifier = Modifier
          .heightIn(max = 460.dp)
          .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        AddressField(
          value = draft.label,
          label = "Label (Shop, Godown…)",
          error = fieldErrors["label"],
          onChange = { onDraftChange(draft.copy(label = it)) },
        )
        AddressField(
          value = draft.receiverName,
          label = "Receiver name",
          error = fieldErrors["receiverName"],
          onChange = { onDraftChange(draft.copy(receiverName = it)) },
        )
        AddressField(
          value = draft.phone,
          label = "Contact phone",
          error = fieldErrors["phone"],
          onChange = { onDraftChange(draft.copy(phone = it)) },
        )
        AddressField(
          value = draft.line1,
          label = "Building / street",
          error = fieldErrors["line1"],
          onChange = { onDraftChange(draft.copy(line1 = it)) },
        )
        AddressField(
          value = draft.line2,
          label = "Area (optional)",
          error = fieldErrors["line2"],
          onChange = { onDraftChange(draft.copy(line2 = it)) },
        )
        AddressField(
          value = draft.landmark,
          label = "Landmark (optional)",
          error = fieldErrors["landmark"],
          onChange = { onDraftChange(draft.copy(landmark = it)) },
        )
        AddressField(
          value = draft.city,
          label = "City / town",
          error = fieldErrors["city"],
          onChange = { onDraftChange(draft.copy(city = it)) },
        )
        AddressField(
          value = draft.district,
          label = "District (optional)",
          error = fieldErrors["district"],
          onChange = { onDraftChange(draft.copy(district = it)) },
        )
        AddressField(
          value = draft.state,
          label = "State",
          error = fieldErrors["state"],
          onChange = { onDraftChange(draft.copy(state = it)) },
        )
        AddressField(
          value = draft.pincode,
          label = "PIN code",
          error = fieldErrors["pincode"],
          onChange = { onDraftChange(draft.copy(pincode = it.filter(Char::isDigit).take(6))) },
        )
        Row(
          modifier = Modifier.fillMaxWidth(),
          horizontalArrangement = Arrangement.SpaceBetween,
          verticalAlignment = Alignment.CenterVertically,
        ) {
          Column(modifier = Modifier.weight(1f)) {
            Text("Use as default", style = MaterialTheme.typography.bodyMedium)
            Text(
              text = "Preselected at checkout",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
          }
          Switch(
            checked = draft.isDefault,
            onCheckedChange = { onDraftChange(draft.copy(isDefault = it)) },
          )
        }
      }
    },
    confirmButton = {
      Button(
        onClick = onSave,
        enabled = !saving,
        modifier = Modifier.testTag(AddressBookTags.SAVE),
      ) {
        if (saving) {
          CircularProgressIndicator(strokeWidth = 2.dp, modifier = Modifier.size(16.dp))
        } else {
          Text(if (editingExisting) "Save changes" else "Save address")
        }
      }
    },
    dismissButton = { TextButton(onClick = onDismiss, enabled = !saving) { Text("Cancel") } },
  )
}

@Composable
private fun AddressField(
  value: String,
  label: String,
  error: String?,
  onChange: (String) -> Unit,
) {
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    label = { Text(label) },
    isError = error != null,
    singleLine = true,
    supportingText = error?.let { { Text(it) } },
    modifier = Modifier.fillMaxWidth(),
  )
}
