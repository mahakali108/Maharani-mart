package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.engagement.SecurityUiState
import com.maharanitraders.feature.engagement.SecurityViewModel

object SecurityTags {
  const val SCREEN = "security_screen"
  const val CHANGE_PASSWORD = "security_change_password"
  const val GLOBAL_SIGN_OUT = "security_sign_out_everywhere"
  const val DATA_REQUEST = "security_data_request"
  const val DELETE_REQUEST = "security_delete_request"
}

@Composable
fun SecurityScreen(
  onSignOut: () -> Unit,
  modifier: Modifier = Modifier,
  viewModel: SecurityViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  var confirmDeletion by remember { mutableStateOf(false) }
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(SecurityTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Security & privacy", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Manage your password, signed-in sessions and account requests.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    item { ChangePasswordCard(state, viewModel) }
    item { AccountRequestsCard(state, viewModel, onRequestDeletion = { confirmDeletion = true }) }
    item { SessionsCard(state, viewModel, onSignOut) }
    state.error?.let { error -> item { Text(error, color = MaterialTheme.colorScheme.error) } }
    state.message?.let { message -> item { Text(message, color = MaterialTheme.colorScheme.primary) } }
  }

  if (confirmDeletion) {
    AlertDialog(
      onDismissRequest = { confirmDeletion = false },
      title = { Text("Request account deletion?") },
      text = { Text("This submits a request for staff review. It does not delete your account immediately or change your access. The team will contact you before taking action.") },
      confirmButton = {
        TextButton(
          onClick = { confirmDeletion = false; viewModel.submitAccountRequest("account_deletion") },
          enabled = !state.requestSaving,
        ) { Text("Submit request") }
      },
      dismissButton = { TextButton(onClick = { confirmDeletion = false }) { Text("Cancel") } },
    )
  }
}

@Composable
private fun ChangePasswordCard(state: SecurityUiState, viewModel: SecurityViewModel) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      Text("Change password", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text("Your current password is checked before the change is saved.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(
        value = state.currentPassword,
        onValueChange = viewModel::onCurrentPassword,
        label = { Text("Current password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        value = state.newPassword,
        onValueChange = viewModel::onNewPassword,
        label = { Text("New password") },
        supportingText = { Text("At least 8 characters") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
        modifier = Modifier.fillMaxWidth(),
      )
      OutlinedTextField(
        value = state.confirmPassword,
        onValueChange = viewModel::onConfirmPassword,
        label = { Text("Confirm new password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        modifier = Modifier.fillMaxWidth(),
      )
      Button(
        onClick = viewModel::changePassword,
        enabled = !state.passwordSaving,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SecurityTags.CHANGE_PASSWORD),
      ) {
        if (state.passwordSaving) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
        Text(if (state.passwordSaving) "Changing…" else "Change password")
      }
    }
  }
}

@Composable
private fun AccountRequestsCard(state: SecurityUiState, viewModel: SecurityViewModel, onRequestDeletion: () -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      Text("Your data & account", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text("Requests are recorded for staff review. Export or deletion is not performed automatically.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(
        value = state.requestNote,
        onValueChange = viewModel::onRequestNote,
        label = { Text("Optional note") },
        supportingText = { Text("Up to 500 characters") },
        minLines = 2,
        maxLines = 4,
        modifier = Modifier.fillMaxWidth(),
      )
      Button(
        onClick = { viewModel.submitAccountRequest("data_export") },
        enabled = !state.requestSaving,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SecurityTags.DATA_REQUEST),
      ) { Text("Request a copy of my data") }
      Surface(
        onClick = onRequestDeletion,
        color = MaterialTheme.colorScheme.errorContainer,
        shape = RoundedCornerShape(MaharaniDimens.radiusTile),
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SecurityTags.DELETE_REQUEST),
      ) {
        Text("Request account deletion", modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp), color = MaterialTheme.colorScheme.onErrorContainer)
      }
      if (state.requestsLoading) LoadingState("Loading recent requests…", Modifier.fillMaxWidth().heightIn(min = 48.dp))
      else if (state.accountRequests.isEmpty()) Text("No recent requests.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      else state.accountRequests.forEach { request ->
        Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
          Text(request.requestType.toRequestLabel(), style = MaterialTheme.typography.labelLarge)
          Text("${request.status.replace('_', ' ').replaceFirstChar { it.uppercase() }} · ${request.createdAt.replace('T', ' ').take(16)}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
  }
}

@Composable
private fun SessionsCard(state: SecurityUiState, viewModel: SecurityViewModel, onSignOut: () -> Unit) {
  Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
    Column(Modifier.fillMaxWidth().padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm)) {
      Text("Signed-in sessions", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
      Text("Sign out all devices. You will need to sign in again here and elsewhere.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Button(
        onClick = { viewModel.signOutEverywhere(onSignOut) },
        enabled = !state.signingOutEverywhere,
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SecurityTags.GLOBAL_SIGN_OUT),
      ) {
        if (state.signingOutEverywhere) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
        Text(if (state.signingOutEverywhere) "Signing out…" else "Sign out everywhere")
      }
    }
  }
}

private fun String.toRequestLabel(): String = when (this) {
  "account_deletion" -> "Account deletion request"
  "data_export" -> "Data export request"
  else -> "Account request"
}
