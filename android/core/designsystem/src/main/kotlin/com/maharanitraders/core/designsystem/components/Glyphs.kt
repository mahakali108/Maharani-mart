package com.maharanitraders.core.designsystem.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * The app's iconography, drawn instead of imported.
 *
 * WHY NOT `androidx.compose.material:material-icons-*`: Google deprecated those
 * artifacts and STOPPED publishing them after 1.7.x, so depending on them pins
 * a dead version or ships a ~1.4 MB enum for a handful of glyphs. Every glyph
 * here is a few `drawPath`/`drawCircle` calls on a 24x24 grid, costs nothing,
 * and cannot be broken by a Compose release — the same reasoning the project
 * already applied to [MenuIcon].
 *
 * Accessibility: each glyph carries a [contentDescription] so TalkBack
 * announces what a sighted shopper sees; purely decorative repeats pass an
 * empty description via the caller's `Modifier.clearAndSetSemantics {}`.
 */

/** One design unit: the 24x24 grid these glyphs are drawn on, scaled to px. */
private fun DrawScope.unit(): Float = size.minDimension / 24f

private fun DrawScope.px(value: Float): Float = value * unit()

private fun DrawScope.point(x: Float, y: Float): Offset = Offset(px(x), px(y))

/** A closed polygon through 24-grid points, in pixel space. */
private fun DrawScope.polygon(vararg points: Float): Path {
  val path = Path()
  path.moveTo(px(points[0]), px(points[1]))
  var index = 2
  while (index + 1 < points.size) {
    path.lineTo(px(points[index]), px(points[index + 1]))
    index += 2
  }
  path.close()
  return path
}

@Composable
private fun Glyph(
  description: String,
  modifier: Modifier = Modifier,
  onDraw: DrawScope.() -> Unit,
) {
  Canvas(
    modifier = modifier
      .size(24.dp)
      .semantics { contentDescription = description },
    onDraw = onDraw,
  )
}

/** Magnifier: search fields and search actions. */
@Composable
fun SearchGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Search", modifier) {
    val stroke = Stroke(px(2f), cap = StrokeCap.Round)
    drawCircle(
      color = tint,
      radius = px(6.1f),
      center = point(10.4f, 10.4f),
      style = stroke,
    )
    drawLine(
      color = tint,
      start = point(14.9f, 14.9f),
      end = point(20.2f, 20.2f),
      strokeWidth = px(2.2f),
      cap = StrokeCap.Round,
    )
  }
}

/** Cross: clear a search term / dismiss. */
@Composable
fun CloseGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Clear", modifier) {
    drawLine(tint, point(6.9f, 6.9f), point(17.1f, 17.1f), px(2f), cap = StrokeCap.Round)
    drawLine(tint, point(17.1f, 6.9f), point(6.9f, 17.1f), px(2f), cap = StrokeCap.Round)
  }
}

/** Three bars: the navigation drawer. */
@Composable
fun MenuGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Open navigation", modifier) {
    for (y in floatArrayOf(7f, 12f, 17f)) {
      drawLine(tint, point(4.5f, y), point(19.5f, y), px(2f), cap = StrokeCap.Round)
    }
  }
}

/** Left arrow: back / up navigation. */
@Composable
fun BackGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Navigate back", modifier) {
    drawLine(tint, point(19.4f, 12f), point(5.4f, 12f), px(2f), cap = StrokeCap.Round)
    drawPath(polygon(11.4f, 5.6f, 12.8f, 7f, 8.2f, 12f, 12.8f, 17f, 11.4f, 18.4f, 5.4f, 12f), tint)
  }
}

/** Right chevron: "View all" and list disclosure. */
@Composable
fun ChevronRightGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Open", modifier) {
    drawPath(
      polygon(9.6f, 5.8f, 15.6f, 12f, 9.6f, 18.2f, 8.2f, 16.8f, 12.8f, 12f, 8.2f, 7.2f),
      tint,
    )
  }
}

/** House: bottom navigation "Home". */
@Composable
fun HomeGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Home", modifier) {
    drawPath(
      polygon(
        12f, 3.1f, 3.4f, 10.6f, 5.8f, 10.6f, 5.8f, 20.6f, 10.2f, 20.6f, 10.2f, 14.6f,
        13.8f, 14.6f, 13.8f, 20.6f, 18.2f, 20.6f, 18.2f, 10.6f, 20.6f, 10.6f,
      ),
      tint,
    )
  }
}

/** Four tiles: bottom navigation "Categories". */
@Composable
fun CategoryGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Categories", modifier) {
    val corner = CornerRadius(px(2f))
    val tile = Size(px(7.4f), px(7.4f))
    drawRoundRect(tint, topLeft = point(3.6f, 3.6f), size = tile, cornerRadius = corner)
    drawRoundRect(tint, topLeft = point(13f, 3.6f), size = tile, cornerRadius = corner)
    drawRoundRect(tint, topLeft = point(3.6f, 13f), size = tile, cornerRadius = corner)
    drawRoundRect(tint, topLeft = point(13f, 13f), size = tile, cornerRadius = corner)
  }
}

/** Trolley: bottom navigation "Cart". */
@Composable
fun CartGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Cart", modifier) {
    val path = Path()
    path.moveTo(px(2.8f), px(4.4f))
    path.lineTo(px(5.7f), px(4.4f))
    path.lineTo(px(8.2f), px(15.4f))
    path.lineTo(px(18.4f), px(15.4f))
    path.lineTo(px(20.8f), px(8.2f))
    path.lineTo(px(6.6f), px(8.2f))
    drawPath(path, tint, style = Stroke(px(1.9f), cap = StrokeCap.Round, join = StrokeJoin.Round))
    drawCircle(tint, radius = px(1.7f), center = point(9.6f, 19.4f))
    drawCircle(tint, radius = px(1.7f), center = point(17.4f, 19.4f))
  }
}

/** Receipt: bottom navigation "Orders". */
@Composable
fun OrdersGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Orders", modifier) {
    val path = polygon(
      6f, 2.8f, 18f, 2.8f, 18f, 21.2f, 15f, 19.4f, 12f, 21.2f, 9f, 19.4f, 6f, 21.2f,
    )
    // The ruled lines are holes in the filled receipt, so the glyph stays a
    // single tinted shape at any size.
    path.addPath(polygon(8.8f, 7.2f, 15.2f, 7.2f, 15.2f, 8.8f, 8.8f, 8.8f))
    path.addPath(polygon(8.8f, 11f, 15.2f, 11f, 15.2f, 12.6f, 8.8f, 12.6f))
    path.addPath(polygon(8.8f, 14.8f, 12.8f, 14.8f, 12.8f, 16.4f, 8.8f, 16.4f))
    path.fillType = PathFillType.EvenOdd
    drawPath(path, tint)
  }
}

/** Person: bottom navigation "Account". */
@Composable
fun AccountGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Account", modifier) {
    drawCircle(tint, radius = px(3.7f), center = point(12f, 8.2f))
    val shoulders = Path()
    shoulders.moveTo(px(4.6f), px(20.4f))
    shoulders.cubicTo(px(4.6f), px(15.6f), px(7.9f), px(13.2f), px(12f), px(13.2f))
    shoulders.cubicTo(px(16.1f), px(13.2f), px(19.4f), px(15.6f), px(19.4f), px(20.4f))
    shoulders.close()
    drawPath(shoulders, tint)
  }
}

/** Map pin: delivery area / address context. */
@Composable
fun PinGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Delivery area", modifier) {
    drawCircle(
      color = tint,
      radius = px(5.2f),
      center = point(12f, 9.6f),
      style = Stroke(px(1.9f)),
    )
    drawLine(tint, point(8.4f, 13.8f), point(12f, 21f), px(1.9f), cap = StrokeCap.Round)
    drawLine(tint, point(15.6f, 13.8f), point(12f, 21f), px(1.9f), cap = StrokeCap.Round)
    drawCircle(tint, radius = px(1.6f), center = point(12f, 9.6f))
  }
}

/** The Maharani crown: the brand mark, drawn to match the launcher artwork. */
@Composable
fun CrownGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Maharani Traders", modifier) {
    drawPath(
      polygon(
        5.2f, 14.6f, 5.2f, 7.4f, 8.7f, 10.6f, 12f, 5.4f, 15.3f, 10.6f, 18.8f, 7.4f, 18.8f, 14.6f,
      ),
      tint,
    )
    drawRoundRect(
      tint,
      topLeft = point(5.2f, 16.2f),
      size = Size(px(13.6f), px(3f)),
      cornerRadius = CornerRadius(px(1f)),
    )
    drawCircle(tint, radius = px(1.25f), center = point(5.2f, 5.2f))
    drawCircle(tint, radius = px(1.25f), center = point(12f, 3.2f))
    drawCircle(tint, radius = px(1.25f), center = point(18.8f, 5.2f))
  }
}

/** Circular arrow: retry / refresh. */
@Composable
fun RefreshGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Refresh", modifier) {
    drawArc(
      color = tint,
      startAngle = -55f,
      sweepAngle = 290f,
      useCenter = false,
      topLeft = point(4.4f, 4.4f),
      size = Size(px(15.2f), px(15.2f)),
      style = Stroke(px(1.9f), cap = StrokeCap.Round),
    )
    drawPath(polygon(17.4f, 1.8f, 21.6f, 4.6f, 17.6f, 7.6f), tint)
  }
}

/** Sliders: filters. */
@Composable
fun FilterGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Filters", modifier) {
    drawLine(tint, point(4f, 7f), point(20f, 7f), strokeWidth = px(1.8f), cap = StrokeCap.Round)
    drawLine(tint, point(4f, 12f), point(20f, 12f), strokeWidth = px(1.8f), cap = StrokeCap.Round)
    drawLine(tint, point(4f, 17f), point(20f, 17f), strokeWidth = px(1.8f), cap = StrokeCap.Round)
    drawCircle(tint, radius = px(2.1f), center = point(9.4f, 7f))
    drawCircle(tint, radius = px(2.1f), center = point(15f, 12f))
    drawCircle(tint, radius = px(2.1f), center = point(7.6f, 17f))
  }
}

/** Up/down arrows: sort order. */
@Composable
fun SortGlyph(
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph("Sort", modifier) {
    drawLine(tint, point(8f, 4.6f), point(8f, 17.6f), px(1.8f), cap = StrokeCap.Round)
    drawPath(polygon(5.4f, 15.6f, 10.6f, 15.6f, 8f, 20.4f), tint)
    drawLine(tint, point(16f, 19.4f), point(16f, 6.4f), px(1.8f), cap = StrokeCap.Round)
    drawPath(polygon(13.4f, 8.4f, 18.6f, 8.4f, 16f, 3.6f), tint)
  }
}

/**
 * Heart: the favourite (wishlist) affordance.
 *
 * [filled] draws the solid state the server confirmed, the outline state is the
 * un-favourited one. Both are the same path, so the two states cannot drift in
 * size or optical weight as a shopper taps between them.
 */
@Composable
fun HeartGlyph(
  filled: Boolean,
  modifier: Modifier = Modifier,
  tint: Color = LocalContentColor.current,
) {
  Glyph(if (filled) "Saved to favourites" else "Not in favourites", modifier) {
    val path = Path().apply {
      moveTo(px(12f), px(20.4f))
      cubicTo(px(3.4f), px(14.7f), px(2.4f), px(9.5f), px(5.1f), px(6.6f))
      cubicTo(px(7.4f), px(4.1f), px(10.7f), px(4.8f), px(12f), px(7.5f))
      cubicTo(px(13.3f), px(4.8f), px(16.6f), px(4.1f), px(18.9f), px(6.6f))
      cubicTo(px(21.6f), px(9.5f), px(20.6f), px(14.7f), px(12f), px(20.4f))
      close()
    }
    if (filled) {
      drawPath(path, tint)
    } else {
      drawPath(path, tint, style = Stroke(px(1.9f), join = StrokeJoin.Round))
    }
  }
}
