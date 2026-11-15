package com.maharanitraders.core.network.dto

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Published website content, as served by `GET /api/mobile/v1/pages` and
 * `GET /api/mobile/v1/pages/{slug}` (contract §2.4.1).
 *
 * The app holds no policy text of its own: every heading, paragraph and
 * effective date below comes from the Super Admin's published snapshot. A draft,
 * an internal note or an owner review decision is never serialised by those
 * endpoints, so there is nothing here that a shopper must not read.
 *
 * Every field has a default. A server that adds a field, or a page whose section
 * has no bullets, must not fail deserialisation — an empty list is rendered as
 * "nothing here", never as an error.
 */
@Serializable
data class ManagedPageSummaryDto(
  val slug: String = "",
  val kind: String = "page",
  val audience: String = "everyone",
  @SerialName("navLabel") val navLabel: String = "",
  @SerialName("shortLabel") val shortLabel: String? = null,
  val title: String = "",
  val summary: String? = null,
  val version: String = "",
  @SerialName("effectiveDate") val effectiveDate: String = "",
)

@Serializable
data class ManagedPagesDto(
  val pages: List<ManagedPageSummaryDto> = emptyList(),
)

@Serializable
data class ManagedPageSectionDto(
  val heading: String = "",
  val paragraphs: List<String> = emptyList(),
  val bullets: List<String> = emptyList(),
  val tone: String = "standard",
  @SerialName("imageUrl") val imageUrl: String? = null,
  @SerialName("linkLabel") val linkLabel: String? = null,
  @SerialName("linkHref") val linkHref: String? = null,
)

@Serializable
data class ManagedPageDto(
  val slug: String = "",
  val kind: String = "page",
  val audience: String = "everyone",
  @SerialName("navLabel") val navLabel: String = "",
  val title: String = "",
  val eyebrow: String? = null,
  val intro: String = "",
  val version: String = "",
  @SerialName("effectiveDate") val effectiveDate: String = "",
  @SerialName("publishedAt") val publishedAt: String = "",
  @SerialName("showContactDetails") val showContactDetails: Boolean = false,
  @SerialName("relatedSlugs") val relatedSlugs: List<String> = emptyList(),
  val sections: List<ManagedPageSectionDto> = emptyList(),
)
