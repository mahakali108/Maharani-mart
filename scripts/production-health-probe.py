#!/usr/bin/env python3
"""production-health-probe.py — verify the LIVE production deployment over HTTP.

This is the launch gate behind the "Production health" row of
docs/LAUNCH_RELEASE_GATE_2026-10-11.md. It exists because the review sandbox
that produced this code has NO egress to the production host, so a human reading
a report there cannot tell "verified" from "assumed". The probe runs where the
network IS reachable — a GitHub Actions runner — and writes machine-checkable
evidence (HTTP status, latency, UTC timestamp) instead of a claim.

Pure stdlib: it runs identically on a developer machine and in CI, with no
dependencies to install and no credentials to configure.

    python3 scripts/production-health-probe.py                 # probe production
    python3 scripts/production-health-probe.py --self-test     # offline logic test
    python3 scripts/production-health-probe.py --json out.json # also write JSON

WHAT IT PROBES (all unauthenticated, all read-only)

  1. the website itself renders;
  2. the public login screen renders;
  3. /api/health reports the database reachable;
  4. /api/mobile/v1/health reports the database reachable with the mobile envelope
     (this is the exact endpoint the Android app calls at startup);
  5. protected PAGES redirect an anonymous visitor to /login (middleware alive);
  6. protected mobile APIs return 401 missing_token, NOT 200 and NOT 500
     (authorization alive — a 200 here would be a data-exposure incident);
  7. a POST-only auth route refuses GET with 405 (the route is really deployed).

WHAT IT NEVER DOES

  * it never sends credentials, and never POSTs to /auth/login — repeated login
    attempts would trip the real auth rate limiter and could lock out a genuine
    retailer. Route deployment is proven with a 405 instead;
  * it never prints a response body. Only keys on an explicit allowlist are
    echoed, and every emitted string passes through a redaction filter that
    drops JWTs, bearer tokens, connection strings and anything key-shaped;
  * it never writes, mutates or seeds data. Every request is a GET;
  * it never accepts a local, private, plain-HTTP or retired host as
    "production". A mock answer is a failed gate, not a passed one.

Exit status is 0 only when EVERY target passes. Anything else is exit 1 with the
failing rows named, so CI cannot go green on a broken production deployment.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Callable, Iterable, Sequence

# ---------------------------------------------------------------------------
# Production identity
# ---------------------------------------------------------------------------

#: The verified live origin. This is the value compiled into the Android release
#: build (android/app/build.gradle.kts -> BuildConfig.API_BASE_URL) and the host
#: the Vercel project serves. Override with MAHARANI_PRODUCTION_ORIGIN only to
#: point the SAME probe at a staging host — the validation below still applies.
PRODUCTION_ORIGIN = "https://maharanitraders.vercel.app"

#: Hosts that must never be reported as production. Kept in sync with
#: android/app/src/main/kotlin/com/maharanitraders/app/ApiBaseUrlContract.kt;
#: tests/production-health-probe.test.ts asserts the two lists agree, because a
#: probe that silently accepted a retired alias would "verify" a dead deployment.
RETIRED_HOSTS = frozenset(
    {
        "maharani-mart-one.vercel.app",
        "maharani-mart-mahakali108s-projects.vercel.app",
    }
)

#: Loopback / private / link-local literals that can never be production.
FORBIDDEN_HOSTS = frozenset(
    {
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "::1",
        "[::1]",
        "10.0.2.2",
        "example.com",
        "www.example.com",
    }
)

USER_AGENT = "maharani-traders-production-probe/1.0 (+github-actions)"

DEFAULT_TIMEOUT_SECONDS = 10.0
DEFAULT_ATTEMPTS = 3
DEFAULT_BACKOFF_SECONDS = 2.0

# ---------------------------------------------------------------------------
# Redaction
# ---------------------------------------------------------------------------

#: `name=value` / `name: value` shapes for every field that could carry a
#: credential. Split out as a named constant purely so the pattern stays readable.
CREDENTIAL_ASSIGNMENT_PATTERN = (
    r"(?i)\b(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|"
    r"service[_-]?role|private[_-]?key|authorization)\b\s*[:=]\s*\S+"
)

#: Anything matching these patterns is replaced before it reaches a log, the
#: step summary, an artifact or a pull-request comment. Ordered broadest-last so
#: the most specific shapes are scrubbed first.
SECRET_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("JWT", re.compile(r"\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{4,}\.[A-Za-z0-9_\-]*")),
    ("BEARER", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9_\-\.=]{8,}")),
    ("CONNECTION_STRING", re.compile(r"(?i)\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|libsql)://\S+")),
    ("SUPABASE_KEY", re.compile(r"\b(?:sb|sk)_[A-Za-z0-9_\-]{16,}")),
    ("LONG_TOKEN", re.compile(r"\b[A-Za-z0-9_\-]{40,}\b")),
    ("CREDENTIAL_ASSIGNMENT", re.compile(CREDENTIAL_ASSIGNMENT_PATTERN)),
)

REDACTED = "[REDACTED]"

#: Keys that sit BESIDE the `data`/`error` envelope object rather than inside it.
#: Only a request id qualifies: it is a random correlation id the server already
#: returns in a response header, it carries no business data, and without it a
#: production failure cannot be matched to a server log line.
ENVELOPE_SIBLING_KEYS: tuple[str, ...] = ("requestId",)


def redact(text: str) -> str:
    """Scrub every secret-shaped substring out of *text*.

    Applied to EVERY string this script emits — including error messages, which
    are the classic leak path (urllib happily puts a redirected URL with a token
    query parameter into an HTTPError string).
    """
    out = text
    for _label, pattern in SECRET_PATTERNS:
        out = pattern.sub(REDACTED, out)
    return out


def redact_mapping(mapping: Any, allowed_keys: Iterable[str]) -> dict[str, Any]:
    """Project *mapping* onto *allowed_keys*, redacting every retained value.

    Keys outside the allowlist are not copied at all, so an unexpected field the
    backend starts returning (a connection string, a stack trace, a user record)
    can never reach the report. Nested containers are dropped rather than walked:
    nothing this probe needs to assert lives inside a nested object.
    """
    if not isinstance(mapping, dict):
        return {}
    allowed = set(allowed_keys)
    projected: dict[str, Any] = {}
    for key, value in mapping.items():
        if key not in allowed:
            continue
        if isinstance(value, (dict, list)):
            continue
        if isinstance(value, str):
            projected[key] = redact(value)
        elif isinstance(value, (bool, int, float)) or value is None:
            projected[key] = value
    return projected


# ---------------------------------------------------------------------------
# Origin validation — a mock is never production
# ---------------------------------------------------------------------------


class OriginRejected(ValueError):
    """Raised when the configured origin cannot be the real production host."""


def _is_private_or_local_host(host: str) -> bool:
    """True for loopback, private, link-local and non-routable names/IPs.

    Resolves DNS so a hostname that points at 127.0.0.1 or 10.x is refused too —
    a probe that "verified production" against a tunnel into the review sandbox
    would be the single most misleading evidence this script could produce.
    """
    bare = host.strip("[]").lower()
    if bare in FORBIDDEN_HOSTS:
        return True
    if bare.endswith(".local") or bare.endswith(".internal") or bare.endswith(".localhost"):
        return True
    try:
        infos = socket.getaddrinfo(bare, None)
    except socket.gaierror:
        # Unresolvable is not "private"; the HTTP attempt will report it honestly.
        return False
    for info in infos:
        raw = info[4][0]
        candidate = raw.split("%", 1)[0]
        try:
            import ipaddress

            addr = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        if (
            addr.is_loopback
            or addr.is_private
            or addr.is_link_local
            or addr.is_reserved
            or addr.is_unspecified
        ):
            return True
    return False


def validate_origin(raw: str | None) -> str:
    """Return *raw* normalized to `scheme://host[:port]`, or raise OriginRejected.

    Mirrors the rules the Android app enforces on its own API base URL, so the
    probe and the shipped client cannot disagree about what "production" is.
    """
    value = (raw or "").strip()
    if not value:
        raise OriginRejected("origin is empty")

    match = re.match(r"^(?P<scheme>[a-zA-Z][a-zA-Z0-9+.\-]*)://(?P<rest>.*)$", value)
    if not match:
        raise OriginRejected("origin must be absolute (scheme://host)")

    scheme = match.group("scheme").lower()
    if scheme != "https":
        raise OriginRejected(f"origin must use https for production (found '{scheme}')")

    rest = match.group("rest")
    if not rest:
        raise OriginRejected("origin has no host")
    authority = rest.split("/", 1)[0]
    if "@" in authority:
        raise OriginRejected("origin must not contain credentials")
    if "?" in authority or "#" in authority:
        raise OriginRejected("origin must not contain a query or fragment")

    host = authority.rsplit(":", 1)[0].lower() if ":" in authority else authority.lower()
    host = host.strip("[]") if host.startswith("[") else host
    if not host:
        raise OriginRejected("origin has no host")
    if host.rstrip(".") in RETIRED_HOSTS:
        raise OriginRejected(f"'{host}' is a retired deployment alias, not production")
    if _is_private_or_local_host(host):
        raise OriginRejected(f"'{host}' is a local/private host and can never be production")
    if "." not in host:
        raise OriginRejected(f"'{host}' is not a routable public hostname")

    return f"https://{authority}"


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------


class Target:
    """One unauthenticated read-only probe against production.

    ``expect`` is the set of HTTP statuses that PASS. ``expect_location`` asserts
    the redirect target's PATH for middleware checks. ``expect_body`` maps an
    allowlisted key to the value it must equal — the only body content the probe
    is permitted to read, and the only content it may echo.

    ``envelope`` names the object those keys live in, because this backend has
    two response shapes and they are NOT interchangeable
    (docs/NATIVE_ANDROID_API_CONTRACT.md §1.3):

        success  jsonOk(...)     -> {"data": {...},  "requestId": "..."}
        failure  jsonError(...)  -> {"error": {"code", "message"}, "requestId": "..."}

    The operational ``/api/health`` predates that contract and answers with a
    FLAT body, so it takes ``envelope=None``. Reading the wrong level is not a
    cosmetic mistake: it silently turned a healthy 200 into a reported failure on
    the first real run of this probe.
    """

    def __init__(
        self,
        name: str,
        path: str,
        *,
        expect: Sequence[int],
        gate: str,
        expect_location: str | None = None,
        expect_body: dict[str, Any] | None = None,
        allowed_body_keys: Sequence[str] = (),
        envelope: str | None = None,
        why: str = "",
    ) -> None:
        self.name = name
        self.path = path
        self.expect = tuple(expect)
        self.gate = gate
        self.expect_location = expect_location
        self.expect_body = expect_body or {}
        self.allowed_body_keys = tuple(allowed_body_keys)
        self.envelope = envelope
        self.why = why


def production_targets() -> list[Target]:
    """The launch checklist, expressed as probes.

    Ordering is deliberate: cheapest/most-diagnostic first, so a total outage
    shows up on the first two rows rather than after a dozen retries.
    """
    return [
        Target(
            "website root renders",
            "/",
            expect=[200],
            gate="Website opens",
            why="The public entry point must serve HTML, not a Vercel 404 or a build error page.",
        ),
        Target(
            "login screen renders",
            "/login",
            expect=[200],
            gate="Authentication works",
            why="Every retailer enters here; a broken login page stops all commerce.",
        ),
        Target(
            "operational health",
            "/api/health",
            expect=[200],
            gate="Health endpoints respond",
            allowed_body_keys=("status", "database", "latencyMs", "timestamp"),
            expect_body={"status": "ok", "database": "reachable"},
            why="Proves Next.js AND the Supabase connection, not just that a container answered.",
        ),
        Target(
            "mobile API health",
            "/api/mobile/v1/health",
            expect=[200],
            gate="Health endpoints respond",
            allowed_body_keys=("status", "database", "apiVersion", "serverTime", "latencyMs", "requestId"),
            expect_body={"status": "ok", "database": "reachable"},
            envelope="data",
            why="The exact startup probe the Android app calls; also confirms the mobile envelope shape.",
        ),
        Target(
            "retailer page redirects anonymous visitor",
            "/retailer/home",
            expect=[307, 302, 308],
            gate="Session enforcement",
            expect_location="/login",
            why="Middleware must bounce an unauthenticated visitor to /login, never render the page.",
        ),
        Target(
            "admin page redirects anonymous visitor",
            "/admin/dashboard",
            expect=[307, 302, 308],
            gate="Admin permissions",
            expect_location="/login",
            why="Admin surfaces must not be reachable without a session.",
        ),
        Target(
            "mobile session API refuses anonymous caller",
            "/api/mobile/v1/session",
            expect=[401],
            gate="Authentication works",
            allowed_body_keys=("code", "requestId"),
            expect_body={"code": "missing_token"},
            envelope="error",
            why=(
                "A 200 here would expose a profile and a 500 would mean the auth path is broken. "
                "Asserting the CODE as well proves this is the authentication refusal and not some "
                "unrelated 401 from an edge or a proxy."
            ),
        ),
        Target(
            "mobile cart API refuses anonymous caller",
            "/api/mobile/v1/cart",
            expect=[401],
            gate="Checkout authorization",
            allowed_body_keys=("code", "requestId"),
            expect_body={"code": "missing_token"},
            envelope="error",
            why="Cart contents are retailer-private and priced per retailer; anonymity must be refused.",
        ),
        Target(
            "mobile catalog API refuses anonymous caller",
            "/api/mobile/v1/catalog/products",
            expect=[401],
            gate="Retailer data isolation",
            allowed_body_keys=("code", "requestId"),
            expect_body={"code": "missing_token"},
            envelope="error",
            why="Prices are per-retailer, so the catalogue is not a public endpoint.",
        ),
        Target(
            "mobile orders API refuses anonymous caller",
            "/api/mobile/v1/orders",
            expect=[401],
            gate="Retailer data isolation",
            allowed_body_keys=("code", "requestId"),
            expect_body={"code": "missing_token"},
            envelope="error",
            why=(
                "Order history must never leak to an unauthenticated caller. The route exports GET, "
                "so 405 is not an acceptable answer here and is no longer tolerated."
            ),
        ),
        Target(
            "login route is deployed and method-guarded",
            "/api/mobile/v1/auth/login",
            expect=[405],
            gate="Critical APIs work",
            allowed_body_keys=("code", "requestId"),
            expect_body={"code": "method_not_allowed"},
            envelope="error",
            why=(
                "GET on a POST-only route proves the handler is really deployed WITHOUT sending "
                "credentials or touching the auth rate limiter."
            ),
        ),
    ]


# The nineteen public pages the website-content module publishes: About, Contact
# and the seventeen documents in the legal registry. After publication these are
# served from the database instead of JSX, so a page that answers 404 (or the
# "This page is not available right now." state) is a content regression that the
# health checklist above would not notice — none of its eleven targets is a public
# information page.
#
# Kept in sync with `content/site-pages.seed.json` by
# tests/production-health-probe.test.ts, so adding a page to the module without
# adding it here fails the suite instead of shipping an unverified URL.
PUBLIC_PAGE_PATHS: tuple[str, ...] = (
    "/about",
    "/contact",
    "/legal/terms",
    "/legal/privacy",
    "/legal/returns",
    "/legal/shipping",
    "/legal/damaged-goods",
    "/legal/seller-agreement",
    "/legal/retailer-terms",
    "/legal/marketplace-disclaimer",
    "/legal/grievance",
    "/legal/business-disclosure",
    "/legal/gst-pricing-invoice",
    "/legal/product-safety",
    "/legal/prohibited-products",
    "/legal/ip-complaints",
    "/legal/suspension-termination",
    "/legal/cookies",
    "/legal/coins-loyalty",
)


def page_targets() -> list[Target]:
    """One probe per published page — the post-deploy "every URL still answers" check.

    Read-only, anonymous, GET only: it proves reachability, not readability. The
    wording itself is proven offline by the seed generator drift test and by
    tests/site-content-continuity.test.ts.
    """
    return [
        Target(
            f"page {path}",
            path,
            expect=[200],
            gate="Every published page is reachable",
            why=(
                "Served from the database after publication. A 404, a redirect or the "
                "'not available right now' state means a page that was live before the "
                "release has disappeared for customers."
            ),
        )
        for path in PUBLIC_PAGE_PATHS
    ]


# ---------------------------------------------------------------------------
# Probing
# ---------------------------------------------------------------------------


class ProbeResult:
    def __init__(self, target: Target, url: str) -> None:
        self.target = target
        self.url = url
        self.status: int | None = None
        self.latency_ms: float | None = None
        self.attempts = 0
        self.location_path: str | None = None
        self.body: dict[str, Any] = {}
        self.error: str | None = None
        self.reasons: list[str] = []
        self.probed_at: str = datetime.now(timezone.utc).isoformat(timespec="seconds")

    @property
    def passed(self) -> bool:
        return not self.reasons

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.target.name,
            "gate": self.target.gate,
            "url": redact(self.url),
            "path": self.target.path,
            "passed": self.passed,
            "status": self.status,
            "expectedStatus": list(self.target.expect),
            "latencyMs": None if self.latency_ms is None else round(self.latency_ms, 1),
            "attempts": self.attempts,
            "redirectPath": self.location_path,
            "body": self.body,
            "reasons": [redact(r) for r in self.reasons],
            "error": redact(self.error) if self.error else None,
            "probedAtUtc": self.probed_at,
        }


def _location_path(location: str) -> str:
    """Reduce a Location header to its PATH for comparison, dropping host/query.

    The query string is discarded on purpose: middleware appends
    `?redirect=/retailer/home`, and echoing raw redirect targets is how a token
    in a URL reaches a log.
    """
    value = location.split("#", 1)[0].split("?", 1)[0]
    match = re.match(r"^[a-zA-Z][a-zA-Z0-9+.\-]*://[^/]*(/.*)$", value)
    if match:
        value = match.group(1)
    return value or "/"


def _fetch_once(url: str, timeout: float) -> tuple[int | None, dict[str, str], bytes]:
    """One GET. Never follows redirects: a silent redirect would turn a 307
    middleware pass into a 200 login-page pass and hide which one happened."""
    request = urllib.request.Request(url, method="GET", headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    context = ssl.create_default_context()
    opener = urllib.request.build_opener(
        urllib.request.HTTPSHandler(context=context),
        _NoRedirect(),
    )
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, dict(response.headers.items()), response.read(65_536)
    except urllib.error.HTTPError as error:  # 4xx/5xx land here, and they are evidence
        headers = dict(error.headers.items()) if error.headers else {}
        try:
            payload = error.read(65_536)
        except Exception:  # noqa: BLE001 - a body we cannot read is not a probe failure
            payload = b""
        return error.code, headers, payload
    except urllib.error.URLError as error:
        raise ProbeTransportError(redact(str(error.reason))) from error
    except TimeoutError as error:
        raise ProbeTransportError(f"timed out after {timeout:.0f}s") from error
    except OSError as error:
        raise ProbeTransportError(redact(str(error))) from error


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """Redirect handler that refuses to follow anything.

    Returning None makes urllib surface the 3xx response itself. Following a
    redirect would silently convert a middleware 307 into a 200 login page and
    hide which of the two actually happened.
    """

    def redirect_request(self, *args: Any, **kwargs: Any) -> None:
        return None


class ProbeTransportError(RuntimeError):
    """Network-level failure: DNS, TLS, timeout, refused connection."""


def _evaluate(result: ProbeResult, status: int | None, headers: dict[str, str], payload: bytes) -> None:
    """Apply the target's expectations and record every mismatch as a reason."""
    target = result.target
    result.status = status

    if status is None:
        result.reasons.append("no HTTP status received")
        return
    if status not in target.expect:
        result.reasons.append(f"HTTP {status}, expected one of {list(target.expect)}")

    location = headers.get("Location") or headers.get("location")
    if location:
        result.location_path = _location_path(location)
        if target.expect_location and result.location_path != target.expect_location:
            result.reasons.append(
                f"redirected to '{result.location_path}', expected '{target.expect_location}'"
            )

    if target.expect_body or target.allowed_body_keys:
        content_type = (headers.get("Content-Type") or headers.get("content-type") or "").lower()
        if "json" not in content_type:
            if target.expect_body:
                result.reasons.append(f"expected JSON, content-type was '{redact(content_type) or 'unknown'}'")
        else:
            try:
                parsed = json.loads(payload.decode("utf-8", errors="replace"))
            except (ValueError, UnicodeDecodeError):
                if target.expect_body:
                    result.reasons.append("response was not parseable JSON")
                parsed = None
            if parsed is not None:
                container: Any = parsed
                if target.envelope is not None:
                    inner = parsed.get(target.envelope) if isinstance(parsed, dict) else None
                    if not isinstance(inner, dict):
                        # A missing envelope object is a real contract break, not
                        # an empty body: the Android client unwraps `data` and
                        # `error` unconditionally, so report it as such.
                        result.reasons.append(
                            f"response carried no '{target.envelope}' object "
                            "(mobile envelope shape mismatch)"
                        )
                        container = None
                    else:
                        container = inner
                if container is not None:
                    projected = redact_mapping(container, target.allowed_body_keys)
                    if target.envelope is not None and isinstance(parsed, dict):
                        # `requestId` is a SIBLING of `data`/`error` in this
                        # contract, not a child of it (lib/mobile/http.ts builds
                        # `{ data, requestId }` and `{ error: {...}, requestId }`).
                        # Lifting it when allowlisted is what makes a production
                        # failure correlatable with the server log.
                        for sibling in ENVELOPE_SIBLING_KEYS:
                            if sibling in target.allowed_body_keys and sibling not in projected:
                                value = parsed.get(sibling)
                                if isinstance(value, str):
                                    projected[sibling] = redact(value)
                    result.body = projected
                    for key, wanted in target.expect_body.items():
                        actual = result.body.get(key)
                        if actual != wanted:
                            where = f"{target.envelope}.{key}" if target.envelope else f"body.{key}"
                            result.reasons.append(f"{where} was {actual!r}, expected {wanted!r}")


def probe_target(
    origin: str,
    target: Target,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    attempts: int = DEFAULT_ATTEMPTS,
    backoff: float = DEFAULT_BACKOFF_SECONDS,
    sleeper: Callable[[float], None] = time.sleep,
    fetcher: Callable[[str, float], tuple[int | None, dict[str, str], bytes]] = _fetch_once,
) -> ProbeResult:
    """Probe one target with bounded retries.

    Retries only TRANSPORT failures (DNS/TLS/timeout) and 5xx — a cold Vercel
    function or a transient blip should not fail a launch gate, but a definitive
    401/405/307/200 answer is accepted on the first try and never retried, so a
    wrong expectation cannot be masked by retry noise.
    """
    url = f"{origin.rstrip('/')}{target.path}"
    result = ProbeResult(target, url)
    last_error: str | None = None

    for attempt in range(1, max(1, attempts) + 1):
        result.attempts = attempt
        last_error = None
        started = time.monotonic()
        try:
            status, headers, payload = fetcher(url, timeout)
        except ProbeTransportError as error:
            last_error = str(error)
            result.error = last_error
            result.latency_ms = (time.monotonic() - started) * 1000.0
            if attempt < attempts:
                sleeper(backoff * attempt)
            continue

        result.latency_ms = (time.monotonic() - started) * 1000.0
        retryable = status is None or status >= 500
        # Reset before each evaluation: without this a 503 that survives all three
        # attempts would report the same mismatch three times and bury the fact
        # that there is only one problem.
        result.reasons = []
        result.body = {}
        result.location_path = None
        _evaluate(result, status, headers, payload)
        if not retryable:
            return result

        # 5xx: keep the evaluation (it records the mismatch) but retry, because a
        # single cold-start 503 on a serverless function is not a launch blocker.
        result.error = f"HTTP {status} on attempt {attempt}"
        if attempt < attempts:
            sleeper(backoff * attempt)

    if last_error and result.status is None:
        result.reasons.append(f"transport failure after {result.attempts} attempt(s): {last_error}")
    elif result.status is not None and not result.reasons:
        result.reasons.append(f"HTTP {result.status} persisted after {result.attempts} attempts")
    return result


def probe_production(
    origin: str | None = None,
    *,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
    attempts: int = DEFAULT_ATTEMPTS,
    backoff: float = DEFAULT_BACKOFF_SECONDS,
    targets: Sequence[Target] | None = None,
    fetcher: Callable[[str, float], tuple[int | None, dict[str, str], bytes]] = _fetch_once,
    sleeper: Callable[[float], None] = time.sleep,
) -> tuple[str, list[ProbeResult]]:
    """Validate the origin, then probe every target. Returns (origin, results)."""
    resolved = validate_origin(origin if origin is not None else os.environ.get("MAHARANI_PRODUCTION_ORIGIN", PRODUCTION_ORIGIN))
    chosen = targets if targets is not None else production_targets()
    results = [
        probe_target(resolved, target, timeout=timeout, attempts=attempts, backoff=backoff, fetcher=fetcher, sleeper=sleeper)
        for target in chosen
    ]
    return resolved, results


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def render_markdown(origin: str, results: Sequence[ProbeResult]) -> str:
    """The evidence table. Every cell is redacted; no body is ever printed whole."""
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    verdict = "PASS" if passed == total else "FAIL"
    slowest = max((r.latency_ms or 0.0) for r in results) if results else 0.0
    probed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    lines = [
        f"### Production health — {origin}",
        "",
        f"**{verdict}** — {passed}/{total} probes passed · probed {probed_at} · slowest response {slowest:.0f} ms",
        "",
        "| Probe | Launch gate | Path | Status | Expected | ms | Tries | Verdict |",
        "|---|---|---|---:|---|---:|---:|---|",
    ]
    for result in results:
        status = "—" if result.status is None else str(result.status)
        latency = "—" if result.latency_ms is None else f"{result.latency_ms:.0f}"
        mark = "PASS" if result.passed else "FAIL"
        lines.append(
            f"| {result.target.name} | {result.target.gate} | `{result.target.path}` | {status} "
            f"| {', '.join(str(s) for s in result.target.expect)} | {latency} | {result.attempts} | {mark} |"
        )

    failures = [r for r in results if not r.passed]
    if failures:
        lines += ["", "**Failures**", ""]
        for result in failures:
            lines.append(f"- `{result.target.path}` — {result.target.name}")
            for reason in result.reasons:
                lines.append(f"  - {redact(reason)}")
            if result.error:
                lines.append(f"  - transport: {redact(result.error)}")

    observed = [r.body for r in results if r.body]
    if observed:
        lines += ["", "Allowlisted response fields (the only body content this probe reads):", "", "```json"]
        lines.append(json.dumps(observed, indent=2, sort_keys=True))
        lines.append("```")

    lines += [
        "",
        "_Unauthenticated GETs only. No credentials were sent, no data was written, and no_",
        "_response body was printed beyond the allowlisted fields above._",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Offline self-test — proves the probe logic without touching the network
# ---------------------------------------------------------------------------


def self_test() -> int:
    """Exercise the pure logic against synthetic responses. No network, no CI.

    This is what a sandbox with no egress to production can still verify: that
    the origin guard, the redaction filter, the expectation evaluator and the
    retry policy behave correctly. It is NOT evidence that production is healthy
    — only the real run is.
    """
    failures: list[str] = []

    def check(label: str, condition: bool, detail: str = "") -> None:
        if not condition:
            failures.append(f"{label}{(' — ' + detail) if detail else ''}")

    # --- origin validation -------------------------------------------------
    check("accepts the real production origin", validate_origin(PRODUCTION_ORIGIN) == PRODUCTION_ORIGIN)
    for bad, why in [
        ("http://maharanitraders.vercel.app", "plain http"),
        ("https://localhost:3000", "loopback"),
        ("https://127.0.0.1", "loopback ip"),
        ("https://10.0.2.2", "emulator alias"),
        ("https://maharani-mart-one.vercel.app", "retired alias"),
        ("https://maharani-mart-mahakali108s-projects.vercel.app", "retired alias"),
        ("https://user:pass@maharanitraders.vercel.app", "credentials in url"),
        ("maharanitraders.vercel.app", "not absolute"),
        ("", "empty"),
        ("https://", "no host"),
        ("https://intranet.local", "dot-local"),
    ]:
        try:
            validate_origin(bad)
            check(f"rejects {bad}", False, why)
        except OriginRejected:
            check(f"rejects {bad}", True)

    # --- redaction ---------------------------------------------------------
    leaky = (
        "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123 "
        "postgres://postgres:supersecret@db.ref.supabase.co:5432/postgres "
        "Authorization: Bearer sk_live_abcdefghij "
        "password=hunter2 "
        "sb_secret_abcdefghijklmnopqrstuvwxyz0123456789"
    )
    scrubbed = redact(leaky)
    for needle in ["eyJhbGciOiJIUzI1NiJ9", "supersecret", "hunter2", "sk_live_abcdefghij", "sb_secret_"]:
        check(f"redacts {needle!r}", needle not in scrubbed, scrubbed)
    check("redaction leaves a marker", REDACTED in scrubbed)

    projected = redact_mapping(
        {
            "status": "ok",
            "database": "reachable",
            "latencyMs": 12,
            "connectionString": "postgres://postgres:pw@db.supabase.co/postgres",
            "serviceRoleKey": "sb_secret_key_value",
            "nested": {"token": "eyJhbGci.eyJzdWIi.sig"},
        },
        ("status", "database", "latencyMs"),
    )
    check("allowlist keeps status", projected.get("status") == "ok")
    check("allowlist keeps database", projected.get("database") == "reachable")
    check("allowlist keeps latencyMs", projected.get("latencyMs") == 12)
    check("allowlist drops connectionString", "connectionString" not in projected)
    check("allowlist drops serviceRoleKey", "serviceRoleKey" not in projected)
    check("allowlist drops nested containers", "nested" not in projected)

    # --- redirect path reduction ------------------------------------------
    check(
        "reduces an absolute Location to its path",
        _location_path("https://maharanitraders.vercel.app/login?redirect=%2Fretailer%2Fhome") == "/login",
    )
    check("reduces a relative Location to its path", _location_path("/login?redirect=%2Fadmin") == "/login")

    # --- expectation evaluation via a synthetic fetcher --------------------
    def fake_fetcher(responses: dict[str, tuple[int, dict[str, str], bytes]]) -> Callable[[str, float], tuple[int | None, dict[str, str], bytes]]:
        def fetch(url: str, _timeout: float) -> tuple[int | None, dict[str, str], bytes]:
            for suffix, value in responses.items():
                if url.endswith(suffix):
                    return value
            raise ProbeTransportError(f"no synthetic response for {url}")

        return fetch

    # Real response shapes, taken from lib/mobile/http.ts: jsonOk wraps in
    # `data`, jsonError wraps in `error`, and the operational /api/health is
    # flat because it predates the mobile contract.
    ok_health = json.dumps({"status": "ok", "database": "reachable", "latencyMs": 9}).encode()
    ok_mobile_health = json.dumps(
        {
            "data": {
                "status": "ok",
                "database": "reachable",
                "apiVersion": "v1",
                "serverTime": "2026-10-09T00:00:00.000Z",
                "latencyMs": 5,
            },
            "requestId": "req_synthetic",
        }
    ).encode()
    missing_token = json.dumps(
        {"error": {"code": "missing_token", "message": "Sign in to continue."}, "requestId": "req_synthetic"}
    ).encode()
    method_not_allowed = json.dumps(
        {"error": {"code": "method_not_allowed", "message": "This method is not supported here."}, "requestId": "req_synthetic"}
    ).encode()
    json_headers = {"Content-Type": "application/json"}

    good = fake_fetcher(
        {
            "/api/health": (200, json_headers, ok_health),
            "/api/mobile/v1/health": (200, json_headers, ok_mobile_health),
            "/retailer/home": (307, {"Location": "https://maharanitraders.vercel.app/login?redirect=%2Fretailer%2Fhome"}, b""),
            "/admin/dashboard": (307, {"Location": "https://maharanitraders.vercel.app/login?redirect=%2Fadmin%2Fdashboard"}, b""),
            "/api/mobile/v1/session": (401, json_headers, missing_token),
            "/api/mobile/v1/cart": (401, json_headers, missing_token),
            "/api/mobile/v1/catalog/products": (401, json_headers, missing_token),
            "/api/mobile/v1/orders": (401, json_headers, missing_token),
            "/api/mobile/v1/auth/login": (405, json_headers, method_not_allowed),
            "/login": (200, {"Content-Type": "text/html; charset=utf-8"}, b"<html>login</html>"),
        }
    )

    healthy_targets = [t for t in production_targets() if t.path != "/"]
    _origin, results = probe_production(
        PRODUCTION_ORIGIN,
        targets=healthy_targets,
        attempts=1,
        fetcher=good,
        sleeper=lambda _s: None,
    )
    # "/" is served by the real run; the synthetic map has no entry for the bare
    # origin, so only the non-root targets are asserted.
    for result in results:
        if result.target.path == "/":
            continue
        check(
            f"healthy production passes '{result.target.path}'",
            result.passed,
            "; ".join(result.reasons) or result.error or "",
        )

    # The envelopes must actually be UNWRAPPED, not merely tolerated: a probe that
    # read the wrong level reported a healthy production as broken on its first
    # real run, so the projected fields are asserted here.
    by_path = {r.target.path: r for r in results}
    check(
        "mobile health unwraps the data envelope",
        by_path["/api/mobile/v1/health"].body.get("status") == "ok"
        and by_path["/api/mobile/v1/health"].body.get("database") == "reachable",
        str(by_path["/api/mobile/v1/health"].body),
    )
    check(
        "operational health reads its FLAT body",
        by_path["/api/health"].body.get("status") == "ok",
        str(by_path["/api/health"].body),
    )
    check(
        "a 401 records the auth refusal code",
        by_path["/api/mobile/v1/session"].body.get("code") == "missing_token",
        str(by_path["/api/mobile/v1/session"].body),
    )
    check(
        "the requestId survives projection so an incident can be correlated",
        by_path["/api/mobile/v1/cart"].body.get("requestId") == "req_synthetic",
        str(by_path["/api/mobile/v1/cart"].body),
    )

    # A 200 whose envelope is missing must FAIL, not be read as an empty pass.
    flat_mobile_health = fake_fetcher({"/api/mobile/v1/health": (200, json_headers, ok_health)})
    flat_result = probe_target(
        PRODUCTION_ORIGIN,
        next(t for t in production_targets() if t.path == "/api/mobile/v1/health"),
        attempts=1,
        fetcher=flat_mobile_health,
        sleeper=lambda _s: None,
    )
    check("a missing data envelope FAILS the probe", not flat_result.passed, str(flat_result.reasons))
    check(
        "the envelope failure names the contract break",
        any("mobile envelope shape mismatch" in reason for reason in flat_result.reasons),
        str(flat_result.reasons),
    )

    # A 401 with the WRONG code must fail: an unrelated 401 from an edge or proxy
    # is not evidence that the application's authorization ran.
    wrong_code = fake_fetcher(
        {"/api/mobile/v1/cart": (401, json_headers, json.dumps({"error": {"code": "forbidden"}}).encode())}
    )
    wrong_result = probe_target(
        PRODUCTION_ORIGIN,
        next(t for t in production_targets() if t.path == "/api/mobile/v1/cart"),
        attempts=1,
        fetcher=wrong_code,
        sleeper=lambda _s: None,
    )
    check("a 401 with an unexpected code FAILS the probe", not wrong_result.passed, str(wrong_result.reasons))

    # A leaked cart (200 instead of 401) MUST fail — this is the security gate.
    leaking = fake_fetcher({"/api/mobile/v1/cart": (200, json_headers, json.dumps({"data": []}).encode())})
    leak_result = probe_target(
        PRODUCTION_ORIGIN,
        Target("cart leak", "/api/mobile/v1/cart", expect=[401], gate="Checkout authorization"),
        attempts=1,
        fetcher=leaking,
        sleeper=lambda _s: None,
    )
    check("a 200 on a protected API FAILS the probe", not leak_result.passed, str(leak_result.to_dict()))

    # A degraded database (503) must fail, after retries.
    degraded = fake_fetcher({"/api/health": (503, {"Content-Type": "application/json"}, b'{"status":"degraded"}')})
    slept: list[float] = []
    degraded_result = probe_target(
        PRODUCTION_ORIGIN,
        Target("health", "/api/health", expect=[200], gate="Health endpoints respond", expect_body={"status": "ok"}),
        attempts=3,
        backoff=1.0,
        fetcher=degraded,
        sleeper=slept.append,
    )
    check("503 health FAILS the probe", not degraded_result.passed)
    check("5xx is retried up to the bound", degraded_result.attempts == 3, str(degraded_result.attempts))
    check("retries back off", slept == [1.0, 2.0], str(slept))

    # A transport failure must be reported, not swallowed as a pass.
    def dead_fetcher(_url: str, _timeout: float) -> tuple[int | None, dict[str, str], bytes]:
        raise ProbeTransportError("name or service not known")

    dead = probe_target(
        PRODUCTION_ORIGIN,
        Target("root", "/", expect=[200], gate="Website opens"),
        attempts=2,
        backoff=0.0,
        fetcher=dead_fetcher,
        sleeper=lambda _s: None,
    )
    check("unreachable host FAILS the probe", not dead.passed, str(dead.reasons))
    check("unreachable host records the transport error", "name or service not known" in (dead.error or ""))

    # --- the nineteen page probes -----------------------------------------
    page_list = page_targets()
    check("page probe covers nineteen pages", len(PUBLIC_PAGE_PATHS) == 19, str(len(PUBLIC_PAGE_PATHS)))
    check("page probe has no duplicate path", len(set(PUBLIC_PAGE_PATHS)) == len(PUBLIC_PAGE_PATHS))
    check(
        "every page probe expects 200",
        all(target.expect == (200,) for target in page_list),
        str([t.path for t in page_list if t.expect != (200,)]),
    )
    check(
        "page probes are anonymous public GETs under /legal, /about or /contact",
        all(
            path == "/about" or path == "/contact" or path.startswith("/legal/")
            for path in PUBLIC_PAGE_PATHS
        ),
        str([p for p in PUBLIC_PAGE_PATHS if not (p in ("/about", "/contact") or p.startswith("/legal/"))]),
    )
    check(
        "the page probe does not replace the health checklist",
        len(production_targets()) == 11 and not any(t.path in PUBLIC_PAGE_PATHS for t in production_targets()),
    )

    # --- report rendering --------------------------------------------------
    markdown = render_markdown(PRODUCTION_ORIGIN, results + [dead])
    check("report states the origin", PRODUCTION_ORIGIN in markdown)
    check("report renders a verdict", "**FAIL**" in markdown or "**PASS**" in markdown)
    check("report renders a table", "| Probe | Launch gate |" in markdown)
    check("report never prints a raw JWT", "eyJ" not in markdown)

    if failures:
        print(f"SELF-TEST FAILED ({len(failures)} assertion(s)):")
        for failure in failures:
            print(f"  x {failure}")
        return 1
    print("SELF-TEST PASSED — probe logic verified offline (this is NOT production evidence).")
    return 0


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else "")
    parser.add_argument("--origin", default=None, help="override the production origin (still validated)")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_SECONDS, help="per-request timeout in seconds")
    parser.add_argument("--attempts", type=int, default=DEFAULT_ATTEMPTS, help="bounded retries per target")
    parser.add_argument("--backoff", type=float, default=DEFAULT_BACKOFF_SECONDS, help="linear backoff base in seconds")
    parser.add_argument("--json", dest="json_path", default=None, help="also write machine-readable results here")
    parser.add_argument(
        "--pages",
        action="store_true",
        help="probe the nineteen published information pages instead of the health checklist",
    )
    parser.add_argument("--self-test", action="store_true", help="run the offline logic test and exit (no network)")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()

    try:
        origin, results = probe_production(
            args.origin,
            timeout=args.timeout,
            attempts=args.attempts,
            backoff=args.backoff,
            targets=page_targets() if args.pages else None,
        )
    except OriginRejected as error:
        print(f"::error::Refusing to probe: {error}", file=sys.stderr)
        print("A mock, local or retired host can never be accepted as production evidence.", file=sys.stderr)
        return 2

    markdown = render_markdown(origin, results)
    print(markdown)

    summary_path = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary_path:
        try:
            with open(summary_path, "a", encoding="utf-8") as handle:
                handle.write(markdown + "\n")
        except OSError as error:
            print(f"warning: could not append to GITHUB_STEP_SUMMARY: {error}", file=sys.stderr)

    if args.json_path:
        payload = {
            "origin": origin,
            "probedAtUtc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "passed": all(r.passed for r in results),
            "passedCount": sum(1 for r in results if r.passed),
            "totalCount": len(results),
            "results": [r.to_dict() for r in results],
        }
        with open(args.json_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
        print(f"wrote {args.json_path}", file=sys.stderr)

    failed = [r for r in results if not r.passed]
    for result in failed:
        detail = "; ".join(redact(reason) for reason in result.reasons) or redact(result.error or "unknown failure")
        print(f"::error title=production probe failed: {result.target.path}::{detail}")

    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
