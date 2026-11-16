package com.maharanitraders.feature.engagement

import androidx.lifecycle.SavedStateHandle
import com.google.common.truth.Truth.assertThat
import com.maharanitraders.core.common.AppError
import com.maharanitraders.core.common.AppResult
import com.maharanitraders.core.model.ApiErrorCode
import com.maharanitraders.core.network.dto.ManagedPageDto
import com.maharanitraders.core.network.dto.ManagedPageSectionDto
import com.maharanitraders.core.network.dto.ManagedPageSummaryDto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test

/**
 * The two screens that render published website content.
 *
 * The point of these tests is the STATE MACHINE, not the pixels: a shopper must
 * never see a spinner for ever, a published page must never be reported as an
 * error, and an unpublished page must never look like a bug or expose a draft.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class ManagedContentViewModelTest {

  private val testDispatcher = StandardTestDispatcher()
  private lateinit var repository: FakeManagedContentRepository

  private val about = ManagedPageSummaryDto(
    slug = "about",
    kind = "page",
    navLabel = "About us",
    title = "About Maharani Traders",
    version = "1.0",
    effectiveDate = "2026-11-14",
  )

  private val terms = ManagedPageSummaryDto(
    slug = "terms",
    kind = "legal",
    navLabel = "Terms",
    shortLabel = "Terms",
    title = "Terms and Conditions",
    version = "1.2",
    effectiveDate = "2026-11-14",
  )

  @Before
  fun setUp() {
    Dispatchers.setMain(testDispatcher)
    repository = FakeManagedContentRepository()
  }

  @After
  fun tearDown() {
    Dispatchers.resetMain()
  }

  @Test
  fun `index renders every published page the server returned, in its order`() = runTest(testDispatcher) {
    repository.pagesResult = AppResult.Success(listOf(about, terms))
    val viewModel = LegalCentreViewModel(repository)
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.loading).isFalse()
    assertThat(state.error).isNull()
    assertThat(state.pages.map { it.slug }).containsExactly("about", "terms").inOrder()
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `an empty answer is an empty state, not an error and not a retry loop`() = runTest(testDispatcher) {
    repository.pagesResult = AppResult.Success(emptyList())
    val viewModel = LegalCentreViewModel(repository)
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.isEmpty).isTrue()
    assertThat(state.error).isNull()
    assertThat(state.loading).isFalse()
  }

  @Test
  fun `a transport failure shows the offline message and stays retryable`() = runTest(testDispatcher) {
    repository.pagesResult = AppResult.Failure(AppError.Network())
    val viewModel = LegalCentreViewModel(repository)
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.error).isEqualTo(AppError.Network().message)
    assertThat(state.retryable).isTrue()
    assertThat(state.isEmpty).isFalse()
  }

  @Test
  fun `a non-retryable server answer does not offer a pointless retry`() = runTest(testDispatcher) {
    repository.pagesResult = AppResult.Failure(AppError.Api(ApiErrorCode.FORBIDDEN, "Not for you."))
    val viewModel = LegalCentreViewModel(repository)
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(viewModel.state.value.retryable).isFalse()
    assertThat(viewModel.state.value.error).isEqualTo("Not for you.")
  }

  @Test
  fun `retry reloads after a failure`() = runTest(testDispatcher) {
    repository.pagesResult = AppResult.Failure(AppError.Network())
    val viewModel = LegalCentreViewModel(repository)
    testDispatcher.scheduler.advanceUntilIdle()
    assertThat(viewModel.state.value.error).isNotNull()

    repository.pagesResult = AppResult.Success(listOf(about))
    viewModel.load()
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(viewModel.state.value.error).isNull()
    assertThat(viewModel.state.value.pages).hasSize(1)
  }

  @Test
  fun `a page renders only its renderable sections and its version line`() = runTest(testDispatcher) {
    repository.pageResult = AppResult.Success(
      ManagedPageDto(
        slug = "terms",
        title = "Terms and Conditions",
        intro = "The rules for using this shop.",
        version = "1.2",
        effectiveDate = "2026-11-14",
        sections = listOf(
          ManagedPageSectionDto(heading = "Orders", paragraphs = listOf("An order is a request.")),
          ManagedPageSectionDto(),
        ),
      ),
    )
    val viewModel = ManagedPageViewModel(repository, SavedStateHandle(mapOf(ManagedPageViewModel.ARG_SLUG to "terms")))
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.page?.title).isEqualTo("Terms and Conditions")
    assertThat(state.sections).hasSize(1)
    assertThat(state.sections.single().heading).isEqualTo("Orders")
    assertThat(ManagedContentPresentation.versionLine("1.2", "2026-11-14"))
      .isEqualTo("Version 1.2 · effective 2026-11-14")
  }

  @Test
  fun `an unpublished page is an honest unavailable state, not an error banner`() = runTest(testDispatcher) {
    repository.pageResult = AppResult.Failure(AppError.Api(ApiErrorCode.NOT_FOUND, "This page is not available right now."))
    val viewModel = ManagedPageViewModel(repository, SavedStateHandle(mapOf(ManagedPageViewModel.ARG_SLUG to "coins-loyalty")))
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.unavailable).isTrue()
    assertThat(state.error).isNull()
    assertThat(state.page).isNull()
  }

  @Test
  fun `a real failure is an error with retry, never an unavailable page`() = runTest(testDispatcher) {
    repository.pageResult = AppResult.Failure(AppError.Network())
    val viewModel = ManagedPageViewModel(repository, SavedStateHandle(mapOf(ManagedPageViewModel.ARG_SLUG to "terms")))
    testDispatcher.scheduler.advanceUntilIdle()

    val state = viewModel.state.value
    assertThat(state.unavailable).isFalse()
    assertThat(state.error).isEqualTo(AppError.Network().message)
    assertThat(state.retryable).isTrue()
  }

  @Test
  fun `a blank slug never reaches the network`() = runTest(testDispatcher) {
    val viewModel = ManagedPageViewModel(repository, SavedStateHandle())
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(repository.pageCalls).isEmpty()
    assertThat(viewModel.state.value.unavailable).isTrue()
    assertThat(viewModel.state.value.loading).isFalse()
  }

  @Test
  fun `the slug shown is the slug navigated to`() = runTest(testDispatcher) {
    repository.pageResult = AppResult.Success(ManagedPageDto(slug = "privacy", title = "Privacy"))
    val viewModel = ManagedPageViewModel(repository, SavedStateHandle(mapOf(ManagedPageViewModel.ARG_SLUG to "privacy")))
    testDispatcher.scheduler.advanceUntilIdle()

    assertThat(repository.pageCalls).containsExactly("privacy")
    assertThat(viewModel.state.value.slug).isEqualTo("privacy")
  }

  @Test
  fun `a half-filled link is sanitised before it reaches the screen`() {
    val page = ManagedPageDto(
      slug = "privacy",
      title = "Privacy",
      sections = listOf(
        ManagedPageSectionDto(heading = "Contact", paragraphs = listOf("Ask us."), linkLabel = "Write to us", linkHref = ""),
        ManagedPageSectionDto(heading = "Other", linkLabel = null, linkHref = "https://example.com"),
      ),
    )
    val sanitised = ManagedContentPresentation.sanitize(page)
    assertThat(sanitised.sections[0].linkLabel).isNull()
    assertThat(sanitised.sections[0].linkHref).isNull()
    assertThat(sanitised.sections[1].linkHref).isEqualTo("https://example.com")
  }

  @Test
  fun `the slug rule matches the database constraint`() {
    // Mirrors `site_pages_slug_format` in migration 0104: never start with a digit
    // or a dash, never double-dash, never end with a dash.
    val pattern = NetworkManagedContentRepository.SLUG_PATTERN
    listOf("about", "terms", "grievance-redressal", "coins-loyalty", "shipping-2").forEach {
      assertThat(pattern.matches(it)).isTrue()
    }
    listOf("", "-about", "About", "about_us", "about--us", "about-").forEach {
      assertThat(pattern.matches(it)).isFalse()
    }
  }

  @Test
  fun `an on-site link opens the same page in the app, not the browser`() {
    val opened = mutableListOf<String>()
    val external = mutableListOf<String>()

    com.maharanitraders.feature.engagement.ui.openLink("/contact", { opened += it }) { external += it }
    com.maharanitraders.feature.engagement.ui.openLink("https://maharanitraders.example", { opened += it }) { external += it }
    com.maharanitraders.feature.engagement.ui.openLink("mailto:care@maharanitraders.example", { opened += it }) { external += it }
    // An unknown scheme must not become a dead button or a crash.
    com.maharanitraders.feature.engagement.ui.openLink("javascript:alert(1)", { opened += it }) { external += it }
    com.maharanitraders.feature.engagement.ui.openLink("/", { opened += it }) { external += it }

    assertThat(opened).containsExactly("contact")
    assertThat(external).containsExactly("https://maharanitraders.example", "mailto:care@maharanitraders.example")
  }

  @Test
  fun `only one slug is named by the app, and it comes from the server's list`() {
    // The contact shortcut is the single place the app knows a slug. If the page is
    // not in the published list, the screen must not offer a link to it.
    val published = listOf(about, terms)
    assertThat(published.any { it.slug == com.maharanitraders.feature.engagement.ui.CONTACT_SLUG }).isFalse()
    val withContact = published + about.copy(slug = "contact", navLabel = "Contact us")
    assertThat(withContact.any { it.slug == com.maharanitraders.feature.engagement.ui.CONTACT_SLUG }).isTrue()
  }

  @Test
  fun `the index drops rows the app cannot render but keeps the rest`() {
    val rows = listOf(
      about,
      ManagedPageSummaryDto(slug = ""),
      ManagedPageSummaryDto(slug = "blank", navLabel = "", title = ""),
      terms,
    )
    assertThat(ManagedContentPresentation.index(rows).map { it.slug }).containsExactly("about", "terms").inOrder()
  }
}

/** In-memory double: the tests are about states, so the "server" is just a result. */
private class FakeManagedContentRepository : ManagedContentRepository {
  var pagesResult: AppResult<List<ManagedPageSummaryDto>> = AppResult.Success(emptyList())
  var pageResult: AppResult<ManagedPageDto> = AppResult.Failure(AppError.Network())
  val pageCalls = mutableListOf<String>()

  override suspend fun loadPages(): AppResult<List<ManagedPageSummaryDto>> = pagesResult

  override suspend fun loadPage(slug: String): AppResult<ManagedPageDto> {
    pageCalls += slug
    return pageResult
  }
}
