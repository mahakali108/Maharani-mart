package com.maharanitraders.feature.catalog.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.FilterGlyph
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.feature.catalog.CatalogFilterDraft

/** Test tags for the filter sheet and its entry point. */
object CatalogFilterTags {
  const val SHEET = "catalog_filter_sheet"
  const val OPEN = "catalog_filter_open"
  const val MIN_PRICE = "catalog_filter_min_price"
  const val MAX_PRICE = "catalog_filter_max_price"
  const val DISCOUNT_CHIP = "catalog_filter_discount_chip"
  const val MOQ_CHIP = "catalog_filter_moq_chip"
  const val OFFERS_SWITCH = "catalog_filter_offers"
  const val NEW_SWITCH = "catalog_filter_new"
  const val IN_STOCK_SWITCH = "catalog_filter_in_stock"
  const val CLEAR_ALL = "catalog_filter_clear_all"
  const val APPLY = "catalog_filter_apply"
  const val ERROR = "catalog_filter_error"
}

/**
 * The catalogue's filter sheet.
 *
 * Every control here maps to a parameter the SERVER reads and resolves
 * (`offers`, `new`, `minPrice`, `maxPrice`, `discount`, `maxMoq`, `inStock` —
 * `lib/mobile/catalog.ts` → `parseCatalogQuery`, applied in
 * `lib/retailer/catalog-batches.ts`). Nothing narrows a page the app already
 * loaded: a price band, a discount floor or an MOQ ceiling is compared against
 * the rate the pricing engine resolved for THIS retailer, which does not exist
 * on the device, so the sheet collects a bound and the list is re-read.
 *
 * The two buttons mean what they say. **Clear all** removes the filters and keeps
 * the shopper's search, category, brand and sort — losing those too would cost
 * them their navigation — while **Apply** folds the draft into the query as ONE
 * change and ONE catalogue read, so six filters cannot fire six requests.
 *
 * A draft the server could not act on is REFUSED with the reason shown here, and
 * the list is deliberately NOT reloaded: an unfiltered list behind a control that
 * looks applied is the exact failure this sheet exists to avoid.
 *
 * There is no pack-size control. The catalogue lists one priced pack per product
 * (the server's own default pack), so a pack filter would have nothing to filter;
 * pack choice lives on the product page, where every active pack is priced.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogFilterSheet(
  initialDraft: CatalogFilterDraft,
  error: String?,
  onDismiss: () -> Unit,
  onClearAll: () -> Unit,
  onApply: (CatalogFilterDraft) -> Unit,
  modifier: Modifier = Modifier,
) {
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  // Saveable so a rotation keeps the half-entered bounds instead of silently
  // resetting a panel the shopper was in the middle of filling in.
  var draft by rememberSaveable(stateSaver = CatalogFilterDraftSaver) {
    mutableStateOf(initialDraft)
  }

  ModalBottomSheet(
    onDismissRequest = onDismiss,
    sheetState = sheetState,
    modifier = modifier.testTag(CatalogFilterTags.SHEET),
    containerColor = MaterialTheme.colorScheme.surface,
  ) {
    Column(
      modifier = Modifier
        .fillMaxWidth()
        .verticalScroll(rememberScrollState())
        .navigationBarsPadding()
        .padding(horizontal = MaharaniDimens.pageGutter),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceMd),
    ) {
      Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
      ) {
        FilterGlyph(modifier = Modifier.size(20.dp), tint = MaterialTheme.colorScheme.primary)
        Text(
          text = "Filters",
          style = MaterialTheme.typography.titleLarge,
          fontWeight = FontWeight.SemiBold,
          modifier = Modifier.weight(1f),
        )
        if (draft.activeCount > 0) {
          Badge(containerColor = MaterialTheme.colorScheme.primary) { Text("${draft.activeCount}") }
        }
      }
      Text(
        text = "Prices, discounts and minimums are checked by the server against your own rate.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

      FilterSectionLabel("Price per piece (\u20B9)")
      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        OutlinedTextField(
          value = draft.minPriceText,
          onValueChange = { value -> draft = draft.copy(minPriceText = value.filter(Char::isDigit).take(7)) },
          label = { Text("Min") },
          placeholder = { Text("No limit") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          modifier = Modifier
            .weight(1f)
            .testTag(CatalogFilterTags.MIN_PRICE),
        )
        OutlinedTextField(
          value = draft.maxPriceText,
          onValueChange = { value -> draft = draft.copy(maxPriceText = value.filter(Char::isDigit).take(7)) },
          label = { Text("Max") },
          placeholder = { Text("No limit") },
          singleLine = true,
          keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          modifier = Modifier
            .weight(1f)
            .testTag(CatalogFilterTags.MAX_PRICE),
        )
      }
      Text(
        text = "Whole rupees, up to \u20B9${CatalogFilterDraft.MAX_PRICE_BOUND_RUPEES}. Leave a box empty for no limit.",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )

      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

      FilterSectionLabel("Minimum discount off MRP")
      ChoiceRow(
        options = CatalogFilterDraft.DISCOUNT_STEPS.map { "$it%+" },
        selectedIndex = CatalogFilterDraft.DISCOUNT_STEPS.indexOf(draft.minDiscountPercent),
        onAny = { draft = draft.copy(minDiscountPercent = null) },
        onSelect = { index -> draft = draft.copy(minDiscountPercent = CatalogFilterDraft.DISCOUNT_STEPS[index]) },
        chipTag = CatalogFilterTags.DISCOUNT_CHIP,
      )

      FilterSectionLabel("Maximum minimum order")
      ChoiceRow(
        options = CatalogFilterDraft.MOQ_STEPS.map { "$it pcs" },
        selectedIndex = CatalogFilterDraft.MOQ_STEPS.indexOf(draft.maxMoq),
        onAny = { draft = draft.copy(maxMoq = null) },
        onSelect = { index -> draft = draft.copy(maxMoq = CatalogFilterDraft.MOQ_STEPS[index]) },
        chipTag = CatalogFilterTags.MOQ_CHIP,
      )

      HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

      FilterToggle(
        label = "Offers only",
        detail = "Rows carrying a live offer or a real MRP discount",
        checked = draft.offersOnly,
        onCheckedChange = { value -> draft = draft.copy(offersOnly = value) },
        tag = CatalogFilterTags.OFFERS_SWITCH,
      )
      FilterToggle(
        label = "New arrivals only",
        detail = "Products the distributor marked as a new launch",
        checked = draft.newOnly,
        onCheckedChange = { value -> draft = draft.copy(newOnly = value) },
        tag = CatalogFilterTags.NEW_SWITCH,
      )
      FilterToggle(
        label = "In stock only",
        detail = "Hides rows the warehouse cannot supply right now",
        checked = draft.inStockOnly,
        onCheckedChange = { value -> draft = draft.copy(inStockOnly = value) },
        tag = CatalogFilterTags.IN_STOCK_SWITCH,
      )

      val message = error
      if (message != null) {
        Surface(
          modifier = Modifier
            .fillMaxWidth()
            .testTag(CatalogFilterTags.ERROR),
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          color = MaterialTheme.colorScheme.errorContainer,
        ) {
          Text(
            text = message,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onErrorContainer,
            modifier = Modifier.padding(MaharaniDimens.spaceMd),
          )
        }
      }

      Spacer(modifier = Modifier.height(MaharaniDimens.spaceXs))

      Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        verticalAlignment = Alignment.CenterVertically,
      ) {
        OutlinedButton(
          onClick = {
            draft = CatalogFilterDraft()
            onClearAll()
          },
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          modifier = Modifier
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(CatalogFilterTags.CLEAR_ALL),
        ) { Text("Clear all") }
        Button(
          onClick = { onApply(draft) },
          shape = RoundedCornerShape(MaharaniDimens.radiusTile),
          modifier = Modifier
            .weight(1f)
            .heightIn(min = MaharaniDimens.touchTarget)
            .testTag(CatalogFilterTags.APPLY),
        ) {
          Text(
            text = if (draft.activeCount > 0) {
              "Apply ${draft.activeCount} filter${if (draft.activeCount == 1) "" else "s"}"
            } else {
              "Apply"
            },
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
      }
      Spacer(modifier = Modifier.height(MaharaniDimens.spaceMd))
    }
  }
}

@Composable
private fun FilterSectionLabel(text: String) {
  Text(
    text = text,
    style = MaterialTheme.typography.titleSmall,
    fontWeight = FontWeight.SemiBold,
    color = MaterialTheme.colorScheme.onSurface,
  )
}

/**
 * One row of mutually exclusive choices plus an explicit "Any".
 *
 * `selectedIndex` is `-1` when nothing is chosen, which selects "Any": a filter
 * row with no visible selection reads as broken even when it is behaving.
 */
@Composable
private fun ChoiceRow(
  options: List<String>,
  selectedIndex: Int,
  onAny: () -> Unit,
  onSelect: (Int) -> Unit,
  chipTag: String,
  modifier: Modifier = Modifier,
) {
  // One scrolling row, not a wrapped block: "Any" plus five steps is six chips,
  // which cannot fit 360dp minus the gutter at their own 48dp minimum height
  // without either shrinking below that minimum or wrapping into three ragged
  // lines that push the next section off the sheet. Scrolling keeps every chip
  // full size and the sheet's vertical rhythm predictable.
  Row(
    modifier = modifier
      .fillMaxWidth()
      .horizontalScroll(rememberScrollState()),
    horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    verticalAlignment = Alignment.CenterVertically,
  ) {
    FilterChip(
      selected = selectedIndex < 0,
      onClick = onAny,
      label = { Text("Any") },
      modifier = Modifier
        .heightIn(min = MaharaniDimens.touchTarget)
        .testTag(chipTag),
      colors = FilterChipDefaults.filterChipColors(),
    )
    options.forEachIndexed { index, label ->
      FilterChip(
        selected = index == selectedIndex,
        onClick = { onSelect(index) },
        label = { Text(label) },
        modifier = Modifier
          .heightIn(min = MaharaniDimens.touchTarget)
          .testTag(chipTag),
        colors = FilterChipDefaults.filterChipColors(),
      )
    }
  }
}

/**
 * One labelled switch.
 *
 * The whole row is the control, not just the switch, so it clears the 48dp
 * minimum with room for the sentence that explains what the filter actually
 * does — a shopper cannot be expected to guess what "Offers only" means.
 */
@Composable
private fun FilterToggle(
  label: String,
  detail: String,
  checked: Boolean,
  onCheckedChange: (Boolean) -> Unit,
  tag: String,
  modifier: Modifier = Modifier,
) {
  Surface(
    modifier = modifier
      .fillMaxWidth()
      .heightIn(min = MaharaniDimens.touchTarget)
      .testTag(tag),
    shape = RoundedCornerShape(MaharaniDimens.radiusTile),
    color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
  ) {
    Row(
      modifier = Modifier
        .fillMaxWidth()
        .toggleable(value = checked, role = Role.Switch, onValueChange = onCheckedChange)
        .padding(horizontal = MaharaniDimens.spaceMd, vertical = MaharaniDimens.spaceSm),
      verticalAlignment = Alignment.CenterVertically,
      horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Column(modifier = Modifier.weight(1f)) {
        Text(
          text = label,
          style = MaterialTheme.typography.bodyLarge,
          fontWeight = FontWeight.Medium,
          maxLines = 1,
          overflow = TextOverflow.Ellipsis,
        )
        Text(
          text = detail,
          style = MaterialTheme.typography.labelSmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
        )
      }
      Box(modifier = Modifier.width(52.dp), contentAlignment = Alignment.CenterEnd) {
        Switch(checked = checked, onCheckedChange = null)
      }
    }
  }
}

/**
 * `rememberSaveable` saver for the draft, stored as plain Bundle-able values.
 */
private val CatalogFilterDraftSaver = listSaver<CatalogFilterDraft, Any>(
  save = { draft ->
    listOf(
      draft.minPriceText,
      draft.maxPriceText,
      draft.minDiscountPercent ?: -1,
      draft.maxMoq ?: -1,
      draft.offersOnly,
      draft.newOnly,
      draft.inStockOnly,
    )
  },
  restore = { values ->
    CatalogFilterDraft(
      minPriceText = values[0] as String,
      maxPriceText = values[1] as String,
      minDiscountPercent = (values[2] as Int).takeIf { it > 0 },
      maxMoq = (values[3] as Int).takeIf { it > 0 },
      offersOnly = values[4] as Boolean,
      newOnly = values[5] as Boolean,
      inStockOnly = values[6] as Boolean,
    )
  },
)

/**
 * The Filters entry point on the catalogue's scope bar.
 *
 * Badged with the count of filters actually narrowing the list, so a shopper who
 * returns to a short catalogue can see WHY it is short without opening the sheet.
 */
@Composable
fun CatalogFilterButton(
  activeCount: Int,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
) {
  FilterChip(
    selected = activeCount > 0,
    onClick = onClick,
    label = { Text(if (activeCount > 0) "Filters \u00B7 $activeCount" else "Filters") },
    leadingIcon = { FilterGlyph(modifier = Modifier.size(16.dp)) },
    modifier = modifier
      .heightIn(min = MaharaniDimens.touchTarget)
      .testTag(CatalogFilterTags.OPEN),
    colors = FilterChipDefaults.filterChipColors(),
  )
}
