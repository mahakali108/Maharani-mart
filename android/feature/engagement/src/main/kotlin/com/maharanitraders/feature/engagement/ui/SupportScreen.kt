package com.maharanitraders.feature.engagement.ui

import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.maharanitraders.core.designsystem.components.EmptyState
import com.maharanitraders.core.designsystem.components.ErrorState
import com.maharanitraders.core.designsystem.components.LoadingState
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.network.dto.MobileSupportMessageDto
import com.maharanitraders.core.network.dto.MobileSupportTicketDto
import com.maharanitraders.feature.engagement.SupportUiState
import com.maharanitraders.feature.engagement.SupportViewModel

object SupportTags {
  const val SCREEN = "support_screen"
  const val CREATE = "support_create"
  const val SUBJECT = "support_subject"
  const val DESCRIPTION = "support_description"
  const val ORDER = "support_order"
  const val SUBMIT = "support_submit"
  const val REPLY = "support_reply"
  const val SEND_REPLY = "support_send_reply"
}

private val topics = listOf(
  "order" to "Order issue",
  "payment" to "Payment / Coins",
  "product" to "Product issue",
  "delivery" to "Delivery issue",
  "credit" to "Coins",
  "other" to "Other",
)
private val priorities = listOf("low" to "Low", "normal" to "Normal", "high" to "High", "urgent" to "Urgent")
private val statuses = listOf(null to "All", "open" to "Open", "in_progress" to "In progress", "resolved" to "Resolved", "closed" to "Closed")

@Composable
fun SupportScreen(
  modifier: Modifier = Modifier,
  viewModel: SupportViewModel = hiltViewModel(),
) {
  val state by viewModel.state.collectAsStateWithLifecycle()
  when {
    state.isCreating -> SupportCreateContent(state, viewModel, modifier)
    state.selectedTicketId != null -> SupportDetailContent(state, viewModel, modifier)
    state.loading && state.tickets.isEmpty() -> LoadingState("Loading your support tickets…", modifier)
    state.tickets.isEmpty() && state.error != null -> ErrorState(state.error.orEmpty(), modifier, retryable = true, onRetry = viewModel::refresh)
    else -> SupportListContent(state, viewModel, modifier)
  }
}

@Composable
private fun SupportListContent(state: SupportUiState, viewModel: SupportViewModel, modifier: Modifier) {
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(SupportTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text("Support tickets", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
        Text("Private conversations about your shop and orders.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = viewModel::openCreate, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).padding(top = 8.dp).testTag(SupportTags.CREATE)) {
          Text("Raise a support ticket")
        }
      }
    }
    item {
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        statuses.forEach { (key, label) ->
          val selected = state.statusFilter == key
          Surface(
            onClick = { viewModel.setStatusFilter(key) },
            shape = RoundedCornerShape(50),
            color = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget),
          ) {
            Text(label, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp), color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
    }
    state.message?.let { item { Text(it, color = MaterialTheme.colorScheme.primary) } }
    state.error?.let { item { Text(it, color = MaterialTheme.colorScheme.error) } }
    if (state.tickets.isEmpty() && !state.loading) {
      item {
        EmptyState(
          title = "No tickets here",
          message = if (state.statusFilter == null) "You have not raised a support ticket yet." else "No tickets match this status filter.",
          actionLabel = if (state.statusFilter == null) "Raise a ticket" else "Show all",
          onAction = { if (state.statusFilter == null) viewModel.openCreate() else viewModel.setStatusFilter(null) },
        )
      }
    }
    items(state.tickets, key = { it.id }) { ticket -> TicketCard(ticket, onClick = { viewModel.openTicket(ticket.id) }) }
    if (state.hasMore) {
      item {
        Button(onClick = viewModel::loadMore, enabled = !state.loadingMore, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) {
          if (state.loadingMore) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
          Text(if (state.loadingMore) "Loading…" else "Load more tickets")
        }
      }
    }
  }
}

@Composable
private fun TicketCard(ticket: MobileSupportTicketDto, onClick: () -> Unit) {
  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget),
  ) {
    Column(Modifier.padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(ticket.subject, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        Text(statusLabel(ticket.status), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
      }
      Text("${ticket.ticketNumber} · ${topicLabel(ticket.topic)} · ${ticket.priority.replaceFirstChar { it.uppercase() }}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      ticket.orderNumber?.let { Text("Order $it", style = MaterialTheme.typography.bodySmall) }
    }
  }
}

@Composable
private fun SupportCreateContent(state: SupportUiState, viewModel: SupportViewModel, modifier: Modifier) {
  var topicMenu by remember { mutableStateOf(false) }
  var priorityMenu by remember { mutableStateOf(false) }
  var orderMenu by remember { mutableStateOf(false) }
  Column(
    modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(MaharaniDimens.pageGutter).testTag(SupportTags.SCREEN),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    Button(onClick = viewModel::closeCreate, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) { Text("Back to tickets") }
    Text("Raise a support ticket", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold)
    Text("Your ticket and messages are private to your retailer account and support staff.", color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
      value = state.subject,
      onValueChange = viewModel::onSubject,
      label = { Text("Subject") },
      supportingText = { Text("10–120 characters") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
      modifier = Modifier.fillMaxWidth().testTag(SupportTags.SUBJECT),
    )
    Column {
      Text("Category", style = MaterialTheme.typography.labelLarge)
      Surface(onClick = { topicMenu = true }, color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) {
        Text(topicLabel(state.topic), modifier = Modifier.padding(16.dp))
      }
      DropdownMenu(expanded = topicMenu, onDismissRequest = { topicMenu = false }) {
        topics.forEach { (value, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { viewModel.onTopic(value); topicMenu = false }) }
      }
    }
    Column {
      Text("Priority", style = MaterialTheme.typography.labelLarge)
      Surface(onClick = { priorityMenu = true }, color = MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget)) {
        Text(priorityLabel(state.priority), modifier = Modifier.padding(16.dp))
      }
      DropdownMenu(expanded = priorityMenu, onDismissRequest = { priorityMenu = false }) {
        priorities.forEach { (value, label) -> DropdownMenuItem(text = { Text(label) }, onClick = { viewModel.onPriority(value); priorityMenu = false }) }
      }
    }
    Column {
      Text("Link an order (optional)", style = MaterialTheme.typography.labelLarge)
      Surface(
        onClick = { if (!state.orderOptionsLoading && state.supportOrders.isNotEmpty()) orderMenu = true },
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(12.dp),
        modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SupportTags.ORDER),
      ) {
        val selectedOrder = state.supportOrders.firstOrNull { it.id == state.selectedOrderId }
        val orderLabel = when {
          state.orderOptionsLoading -> "Loading recent orders…"
          selectedOrder != null -> "Order ${selectedOrder.orderNumber}"
          state.supportOrders.isEmpty() -> "No recent orders available"
          else -> "Choose an order (or leave unlinked)"
        }
        Text(text = orderLabel, modifier = Modifier.padding(16.dp))
      }
      DropdownMenu(expanded = orderMenu, onDismissRequest = { orderMenu = false }) {
        DropdownMenuItem(
          text = { Text("No linked order") },
          onClick = { viewModel.onSelectedOrder(null); orderMenu = false },
        )
        state.supportOrders.forEach { order ->
          DropdownMenuItem(
            text = { Text("Order ${order.orderNumber}") },
            onClick = { viewModel.onSelectedOrder(order.id); orderMenu = false },
          )
        }
      }
      state.orderOptionsError?.let {
        Text("Recent orders could not be loaded. You can still submit this ticket without linking an order.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
    }
    OutlinedTextField(
      value = state.description,
      onValueChange = viewModel::onDescription,
      label = { Text("Describe the issue") },
      supportingText = { Text("10–3,000 characters") },
      minLines = 4,
      maxLines = 8,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Default),
      modifier = Modifier.fillMaxWidth().testTag(SupportTags.DESCRIPTION),
    )
    state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
    Button(onClick = viewModel::createTicket, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).testTag(SupportTags.SUBMIT)) {
      if (state.saving) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
      Text(if (state.saving) "Submitting…" else "Submit ticket")
    }
  }
}

@Composable
private fun SupportDetailContent(state: SupportUiState, viewModel: SupportViewModel, modifier: Modifier) {
  val ticket = state.detail
  if (state.detailLoading && ticket == null) {
    LoadingState("Loading ticket…", modifier)
    return
  }
  if (ticket == null) {
    ErrorState(state.error ?: "The ticket could not be loaded.", modifier, retryable = true, onRetry = { state.selectedTicketId?.let(viewModel::openTicket) })
    return
  }
  LazyColumn(
    modifier = modifier.fillMaxSize().testTag(SupportTags.SCREEN),
    contentPadding = PaddingValues(MaharaniDimens.pageGutter),
    verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
  ) {
    item {
      Button(onClick = viewModel::closeDetail, modifier = Modifier.heightIn(min = MaharaniDimens.touchTarget)) { Text("Back to tickets") }
      Text(ticket.subject, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 8.dp))
      Text("${ticket.ticketNumber} · ${statusLabel(ticket.status)} · ${topicLabel(ticket.topic)}", color = MaterialTheme.colorScheme.onSurfaceVariant)
      ticket.orderNumber?.let { Text("Order $it · ${ticket.orderStatus.orEmpty()}", style = MaterialTheme.typography.bodySmall) }
    }
    items(ticket.messages, key = { it.id }) { message -> MessageCard(message) }
    if (ticket.canReply) {
      item {
        OutlinedTextField(
          value = state.reply,
          onValueChange = viewModel::onReply,
          label = { Text("Write a reply") },
          supportingText = { Text("5–3,000 characters") },
          minLines = 3,
          maxLines = 7,
          modifier = Modifier.fillMaxWidth().testTag(SupportTags.REPLY),
        )
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp)) }
        state.message?.let { Text(it, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp)) }
        Button(onClick = viewModel::sendReply, enabled = !state.saving, modifier = Modifier.fillMaxWidth().heightIn(min = MaharaniDimens.touchTarget).padding(top = 8.dp).testTag(SupportTags.SEND_REPLY)) {
          if (state.saving) CircularProgressIndicator(Modifier.padding(end = 8.dp), strokeWidth = 2.dp)
          Text(if (state.saving) "Sending…" else "Send reply")
        }
      }
    } else {
      item { Text("This ticket is closed for replies. Raise a new ticket if you need more help.", color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  }
}

@Composable
private fun MessageCard(message: MobileSupportMessageDto) {
  Card(
    colors = CardDefaults.cardColors(
      containerColor = if (message.isOwn) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerLow,
    ),
    modifier = Modifier.fillMaxWidth(),
  ) {
    Column(Modifier.padding(MaharaniDimens.spaceMd), verticalArrangement = Arrangement.spacedBy(4.dp)) {
      Text(if (message.isOwn) "You" else "Maharani Traders support", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
      Text(message.body, style = MaterialTheme.typography.bodyMedium)
      Text(message.createdAt.replace('T', ' ').take(16), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

private fun topicLabel(topic: String): String = topics.firstOrNull { it.first == topic }?.second ?: "Other"
private fun priorityLabel(priority: String): String = priorities.firstOrNull { it.first == priority }?.second ?: "Normal"
private fun statusLabel(status: String): String = when (status) {
  "in_progress" -> "In progress"
  "resolved" -> "Resolved"
  "closed" -> "Closed"
  else -> "Open"
}
