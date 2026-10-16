package com.maharanitraders.feature.catalog.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.maharanitraders.core.designsystem.components.FactChip
import com.maharanitraders.core.designsystem.components.FavoriteButton
import com.maharanitraders.core.designsystem.components.PriceBlock
import com.maharanitraders.core.designsystem.components.PriceEmphasis
import com.maharanitraders.core.designsystem.components.StockBadge
import com.maharanitraders.core.designsystem.components.nextSlabHint
import com.maharanitraders.core.designsystem.theme.MaharaniDimens
import com.maharanitraders.core.model.CatalogPack
import com.maharanitraders.core.model.CatalogProduct
import com.maharanitraders.core.model.PackAvailability
import com.maharanitraders.feature.catalog.ui.CatalogTags
import com.maharanitraders.feature.catalog.ui.NewLaunchBadge
import com.maharanitraders.feature.catalog.ui.OfferBadge

/** Test tag of one product tile, used by Compose UI tests to find a card. */
const val PRODUCT_CARD_TAG = "catalog_product_tile"

/** Test tag of the favourite control drawn on a product tile. */
const val FAVORITE_TOGGLE_TAG = "catalog_favorite_toggle"

/**
 * Test tag of the card's quick add-to-cart control. The pack id is appended so
 * a Compose UI test can address one card's button in a grid of many.
 */
const val ADD_TO_CART_TAG = "catalog_add_to_cart"

/**
 * Test tag of the card's compare control. The product id is appended so a UI
 * test can address one card in a grid of many.
 */
const val COMPARE_TOGGLE_TAG = "catalog_compare_toggle"

/**
 * The quantity a quick add sends: the pack's MOQ, never a smaller number.
 *
 * The server re-validates MOQ, stock and price on every cart write, so this is
 * about sending a request that has a chance of being accepted rather than about
 * the app deciding anything — a button that posted 1 for a pack with MOQ 12
 * would simply be rejected, which reads to a shopkeeper as a broken button. A
 * pack the server priced without an MOQ means one piece.
 */
fun quickAddQuantity(pack: CatalogPack): Int = (pack.moq ?: 1).coerceAtLeast(1)

/**
 * Whether a card may offer the quick add control at all.
 *
 * A pack the server marked out of stock, or one it deliberately priced without
 * a rate, gets no button: the same rule the product detail applies to its own
 * add action, so the two surfaces cannot disagree about what is orderable.
 */
fun canQuickAdd(pack: CatalogPack?): Boolean =
  pack != null &&
    pack.availability != PackAvailability.OUT_OF_STOCK &&
    pack.unitPricePaise != null &&
    quickAddQuantity(pack) <= CartQuantityRules.MAX_QUANTITY

/**
 * One product card — the atom every rail and grid in the app is built from.
 *
 * INFORMATION HIERARCHY (top to bottom, the order the eye reads a shelf in):
 *   1. artwork, centred on its own light surface — never stretched, never
 *      cropped into an unreadable label;
 *   2. brand, small and muted (the shop's own grouping);
 *   3. product name, two lines, dark and semibold — the loudest text;
 *   4. pack size and case configuration as chips;
 *   5. the PRICE, bold, with the printed MRP struck through beside it when the
 *      server published one;
 *   6. MOQ under the price ("Min order 4 pcs");
 *   7. the stock state as a chip, mint in stock / neutral slate unavailable.
 *
 * Every field is server-supplied: the image URL the media resolver produced,
 * the pack size, units per case and MOQ from the pack row, the GST-inclusive
 * per-piece price the pricing engine returned, and the two-state stock status.
 * Nothing is estimated on the device, and nothing the server did not send is
 * drawn: no rating, no review count, no invented discount percentage, no
 * crossed-out price unless an MRP really exists.
 *
 * A product with no active pack renders its name and an explicit "No pack
 * available" line: it stays browsable, but there is no price to misread and no
 * affordance that suggests it can be ordered.
 *
 * HEIGHT STABILITY: the name block is pinned to two lines and the artwork to a
 * 1:1 band, so cards in a row line up instead of forming a ragged wall — the
 * "unfinished grid" look this redesign removes.
 */
@Composable
fun ProductCard(
  product: CatalogProduct,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  emphasis: PriceEmphasis = PriceEmphasis.Card,
  /**
   * Favourite state for this card. Defaults to the flag the SERVER put on the
   * product row, so a card is correct even before the shared favourites set has
   * loaded; the favourites-aware screens pass the store's answer instead.
   */
  isFavorite: Boolean = product.isFavorite,
  favoritePending: Boolean = false,
  /** Null hides the control entirely — a surface with no favourite affordance. */
  onToggleFavorite: (() -> Unit)? = null,
  /**
   * Quick add to the cart. Null hides the control, which is what a non-retailer
   * or a surface with no cart behind it must get — the card never becomes a
   * button that cannot work. The caller sends `(packId, quantity)` and the
   * cart API re-validates everything.
   */
  onAddToCart: (() -> Unit)? = null,
  /** Opens the validated MOQ/stock-aware quantity sheet instead of adding a fixed quantity. */
  onSelectQuantity: (() -> Unit)? = null,
  /** True while THIS card's add is in flight; shows a spinner in place of the label. */
  addPending: Boolean = false,
  /** Null hides the control: not every grid offers comparison. */
  onToggleCompare: (() -> Unit)? = null,
  /** Whether this card is parked in the comparison tray. */
  compareSelected: Boolean = false,
  /** True when the tray is full, so the control can explain a refused tap. */
  compareFull: Boolean = false,
) {
  val pack = product.pack
  val outOfStock = pack?.availability == PackAvailability.OUT_OF_STOCK

  Surface(
    onClick = onClick,
    shape = RoundedCornerShape(MaharaniDimens.radiusCard),
    color = MaterialTheme.colorScheme.surface,
    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    shadowElevation = MaharaniDimens.cardElevation,
    modifier = modifier.testTag(PRODUCT_CARD_TAG),
  ) {
    Column(
      modifier = Modifier.padding(MaharaniDimens.cardPadding),
      verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
    ) {
      Box(modifier = Modifier.fillMaxWidth()) {
        ProductImage(
          url = product.imageUrl,
          fallbackLabel = product.name,
          contentScale = ContentScale.Fit,
          modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(MaharaniDimens.productImageRatio)
            .clip(RoundedCornerShape(MaharaniDimens.radiusTile)),
        )

        // An out-of-stock pack is washed out, so a scrolling shopper sees the
        // state before reading the label. Kept light — the artwork stays
        // recognisable and the chip below carries the words.
        if (outOfStock) {
          Box(
            modifier = Modifier
              .fillMaxWidth()
              .aspectRatio(MaharaniDimens.productImageRatio)
              .clip(RoundedCornerShape(MaharaniDimens.radiusTile))
              .background(MaterialTheme.colorScheme.surface.copy(alpha = 0.45f)),
          )
        }

        if (product.isNewLaunch || product.hasOffer) {
          Row(
            modifier = Modifier
              .align(Alignment.TopStart)
              .padding(MaharaniDimens.spaceSm),
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          ) {
            if (product.isNewLaunch) NewLaunchBadge()
            if (product.hasOffer) OfferBadge()
          }
        }

        if (onToggleFavorite != null) {
          FavoriteButton(
            isFavorite = isFavorite,
            pending = favoritePending,
            onToggle = onToggleFavorite,
            modifier = Modifier
              .align(Alignment.TopEnd)
              .padding(MaharaniDimens.spaceXs)
              .testTag(FAVORITE_TOGGLE_TAG),
          )
        }
      }

      Column(verticalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXxs)) {
        product.brandName?.let { brand ->
          Text(
            text = brand.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
          )
        }
        Text(
          text = product.name,
          style = MaterialTheme.typography.titleSmall,
          color = MaterialTheme.colorScheme.onSurface,
          maxLines = 2,
          overflow = TextOverflow.Ellipsis,
          // Pinned to two lines: one product with a long name must not make
          // every other card in the row a different height.
          minLines = 2,
        )
      }

      if (pack == null) {
        Text(
          text = "No pack available",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      } else {
        val chips = buildList {
          pack.packName?.let { name -> add(name) }
          pack.unitsPerCase?.takeIf { it > 1 }?.let { units -> add("$units pcs/case") }
        }
        if (chips.isNotEmpty()) {
          Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceXs),
          ) {
            chips.forEach { chip ->
              // Weighted, so two long facts split the card width and ellipsis
              // instead of overflowing a 158dp column.
              FactChip(
                text = chip,
                modifier = Modifier
                  .weight(1f, fill = false)
                  .testTag(CatalogTags.PACK_NAME),
              )
            }
          }
        }

        Row(
          modifier = Modifier.fillMaxWidth(),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(MaharaniDimens.spaceSm),
        ) {
          PriceBlock(
            unitPricePaise = pack.unitPricePaise,
            mrpPaise = pack.mrpPaise,
            emphasis = emphasis,
            // The minimum AND the next slab, when the server published one.
            // Both are server figures: the MOQ from the pack row, and the slab
            // from the same tiers the cart prices with — so the card never
            // advertises a rate checkout would refuse.
            caption = buildList {
              pack.moq?.let { moq -> add("Min order $moq pcs") }
              nextSlabHint(tiers = pack.tiers, quantity = quickAddQuantity(pack))?.let { add(it) }
            }.joinToString(" · ").takeIf { it.isNotEmpty() },
            casePricePaise = pack.derivedCasePricePaise,
            unitsPerCase = pack.unitsPerCase,
            modifier = Modifier
              .weight(1f, fill = false)
              .testTag(CatalogTags.PRICE),
          )
          StockBadge(
            availability = pack.availability,
            compact = true,
            modifier = Modifier.testTag(CatalogTags.AVAILABILITY),
          )
        }

        // The catalogue opens a quantity selector; compact rails and saved
        // products may retain a one-tap MOQ add. Both routes use the same cart
        // endpoint, which re-validates price and stock.
        val addablePack = pack?.takeIf { candidate -> canQuickAdd(candidate) }
        val orderAction = onSelectQuantity ?: onAddToCart
        if (orderAction != null) {
          if (addablePack != null) {
            Button(
              onClick = orderAction,
              enabled = !addPending,
              modifier = Modifier
                .fillMaxWidth()
                .heightIn(min = MaharaniDimens.touchTarget)
                .testTag("${ADD_TO_CART_TAG}_${addablePack.packId}"),
            ) {
              if (addPending) {
                CircularProgressIndicator(
                  strokeWidth = 2.dp,
                  modifier = Modifier.size(18.dp),
                  color = MaterialTheme.colorScheme.onPrimary,
                )
              } else if (onSelectQuantity != null) {
                Text("Select Qty")
              } else {
                Text("Add ${quickAddQuantity(addablePack)} to cart")
              }
            }
          } else {
            // Honest, inert notice instead of a button the cart would reject:
            // this pack cannot be ordered right now. Tagged with a stable id so
            // a UI test can still find the card it belongs to.
            Text(
              text = if (outOfStock) "Out of stock — cannot add" else "Not orderable right now",
              style = MaterialTheme.typography.labelSmall,
              color = MaterialTheme.colorScheme.onSurfaceVariant,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
              modifier = Modifier.testTag("${ADD_TO_CART_TAG}_${pack?.packId ?: product.id}"),
            )
          }
        }

        if (onToggleCompare != null) {
          // A text control, not a bare glyph: "Compare" says what the tap does,
          // and the state is carried by the WORD (Added / Compare) as well as
          // by colour, so it is readable without colour perception.
          TextButton(
            onClick = onToggleCompare,
            enabled = compareSelected || !compareFull,
            modifier = Modifier
              .fillMaxWidth()
              .heightIn(min = MaharaniDimens.touchTarget)
              .testTag("${COMPARE_TOGGLE_TAG}_${product.id}"),
            contentPadding = PaddingValues(horizontal = 4.dp),
          ) {
            Text(
              text = when {
                compareSelected -> "✓ Comparing"
                compareFull -> "Compare (${com.maharanitraders.feature.catalog.ProductCompare.MAX_PRODUCTS} max)"
                else -> "Compare"
              },
              style = MaterialTheme.typography.labelSmall,
              maxLines = 1,
              overflow = TextOverflow.Ellipsis,
            )
          }
        }
      }
    }
  }
}
