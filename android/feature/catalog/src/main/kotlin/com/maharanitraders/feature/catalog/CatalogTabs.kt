package com.maharanitraders.feature.catalog

/**
 * The three panes of the Catalogue.
 *
 * WHY ONE SCREEN WITH THREE PANES
 * Categories, brands and products are three views of the SAME catalogue: the
 * shop's real taxonomy, the real brand list, and the priced product rows the
 * server returns for a filter. They used to be split across two destinations
 * (a catalogue that could only filter, and a directory that could only list),
 * which made "browse by brand" and "browse by category" feel like two different
 * apps and gave the shopper no way to see which filter they were under.
 *
 * Keeping them in one destination with a segmented control means:
 *  - there is exactly ONE catalogue implementation, so a price, a pack size or
 *    a stock state cannot differ between the panes;
 *  - tapping a category or a brand lands on the same product list the filter
 *    chips drive, pre-filtered, with the selection visible;
 *  - the product query is loaded once per filter change, not once per pane.
 *
 * The labels are UI copy, not data: nothing about a category or a brand is
 * invented on the device.
 */
enum class CatalogTab(val label: String) {
  /** The product list: search, filters, sort and the paginated grid. */
  PRODUCTS("Products"),

  /** The shop's published categories, as a selectable directory. */
  CATEGORIES("Categories"),

  /** The shop's published brands, as a selectable directory. */
  BRANDS("Brands"),
}
