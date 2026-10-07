package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.feature.catalog.ui.CatalogTags

/** Stable Compose tags for quantity-selector regression coverage. */
object QuantitySelectorTags {
  const val SHEET = "catalog_quantity_sheet"
  const val MINIMUM = "catalog_quantity_minimum"
  const val VALUE = "catalog_quantity_value"
  const val DECREMENT = "catalog_quantity_decrement"
  const val INCREMENT = "catalog_quantity_increment"
  const val ADD = "catalog_quantity_add"
  const val VALIDATION = "catalog_quantity_validation"
}

/**
 * Server-backed quantity choice for a catalogue product card.
 *
 * The pack price, MRP, minimum and availability are copied from the current
 * retailer-priced catalogue response. A numeric on-hand stock figure is not in
 * that API contract; only its real availability status is shown. The cart
 * endpoint remains authoritative for the latest price, MOQ and stock when the
 * confirmation button is tapped.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QuantitySelectorSheet(
  product: CatalogProduct,
  submittingPackId: String? = null,
  onDismiss: () -> Unit,
  onConfirm: (packId: String, quantity: Int) -> Unit,
) {
  val pack = product.pack ?: return
  var quantity by rememberSaveable(product.id, pack.packId) {
    mutableIntStateOf(CartQuantityRules.initial(pack))
  }
  var validationMessage by remember { mutableStateOf<String?>(null) }
  val submitting = submittingPackId == pack.packId
  val blockedReason = CartQuantityRules.validationMessage(pack, quantity)
  val orderable = blockedReason == null

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    containerColor = MaterialTheme.colorScheme.surface,
    shape = RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp),
    modifier = Modifier.testTag(QuantitySelectorTags.SHEET),
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .navigationBarsPadding()
        .padding(horizontal = MaharaniDimens.pageGutter)
        .padding(bottom = MaharaniDimens.spaceMd),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
        Text(
          text = "SELECT QUANTITY",
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.primary,
          fontWeight = FontWeight.SemiBold,
        )
        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
        ) {
          ProductImage(
            url = product.imageUrl,
            fallbackLabel = product.name,
            modifier = Modifier.size(76.dp),
          )
          Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs),
          ) {
            product.brandName?.let { brand ->
              Text(
                text = brand,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
              )
            }
            Text(
              text = product.name,
              style = MaterialTheme.typography.titleMedium,
              fontWeight = FontWeight.SemiBold,
              maxLines = 2,
              overflow = TextOverflow.Ellipsis,
            )
            pack.packName?.let { name ->
              FactChip(text = name, accent = false)
            }
          }
        }
      }

      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
      ) {
        Column(modifier = Modifier.weight(1f)) {
          Text(
            text = "Price per piece",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          PriceBlock(
            unitPricePaise = pack.unitPricePaise,
            mrpPaise = pack.mrpPaise,
            emphasis = PriceEmphasis.Detail,
            modifier = Modifier.testTag("${CatalogTags.PRICE}_quantity"),
          )
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
          Text(
            text = "Availability",
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          StockBadge(availability = pack.availability, compact = true)
        }
      }

      pack.moq?.takeIf { it > 0 }?.let { moq ->
        FactChip(
          text = "MOQ $moq pcs",
          modifier = Modifier.testTag(QuantitySelectorTags.MINIMUM),
        )
      }

      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs)) {
        Text(
          text = "Quantity",
          style = MaterialTheme.typography.titleSmall,
          fontWeight = FontWeight.SemiBold,
        )
        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.Center,
        ) {
          QuantityStepButton(
            label = "Decrease quantity",
            symbol = "−",
            enabled = !submitting && CartQuantityRules.canDecrement(pack, quantity),
            testTag = QuantitySelectorTags.DECREMENT,
            onClick = {
              quantity = CartQuantityRules.decrement(pack, quantity)
              validationMessage = null
            },
          )
          Text(
            text = quantity.toString(),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier
              .padding(horizontal = MaharaniDimens.spaceXl)
              .testTag(QuantitySelectorTags.VALUE)
              .semantics { contentDescription = "$quantity pieces" },
          )
          QuantityStepButton(
            label = "Increase quantity",
            symbol = "+",
            enabled = !submitting && CartQuantityRules.canIncrement(quantity),
            testTag = QuantitySelectorTags.INCREMENT,
            onClick = {
              quantity = CartQuantityRules.increment(quantity)
              validationMessage = null
            },
          )
        }
      }

      (validationMessage ?: blockedReason)?.let { message ->
        Text(
          text = message,
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.error,
          modifier = Modifier.testTag(QuantitySelectorTags.VALIDATION),
        )
      }

      Text(
        text = "The cart confirms current pricing and stock before the order is placed.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      Button(
        onClick = {
          val invalidReason = CartQuantityRules.validationMessage(pack, quantity)
          if (invalidReason != null) {
            validationMessage = invalidReason
          } else {
            onConfirm(pack.packId, quantity)
            onDismiss()
          }
        },
        enabled = orderable && !submitting,
        modifier = Modifier
          .fillMaxWidth()
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(QuantitySelectorTags.ADD),
      ) {
        if (submitting) {
          CircularProgressIndicator(
            modifier = Modifier.size(18.dp),
            strokeWidth = 2.dp,
            color = MaterialTheme.colorScheme.onPrimary,
          )
        } else {
          Text("Add to Cart")
        }
      }
    }
  }
}

@Composable
private fun QuantityStepButton(
  label: String,
  symbol: String,
  enabled: Boolean,
  testTag: String,
  onClick: () -> Unit,
) {
  Surface(
    onClick = onClick,
    enabled = enabled,
    shape = CircleShape,
    color = if (enabled) MaterialTheme.colorScheme.surface else MaterialTheme.colorScheme.surfaceContainerLow,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    modifier = Modifier
      .size(MaharaniDimens.touchTarget)
      .testTag(testTag)
      .semantics { contentDescription = label },
  ) {
    androidx.compose.foundation.layout.Box(contentAlignment = Alignment.Center) {
      Text(
        text = symbol,
        style = MaterialTheme.typography.titleLarge,
        color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}
