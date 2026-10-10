/**
 * Production health probe — executable safety and consistency guards.
 *
 * WHY THIS FILE EXISTS
 * `scripts/production-health-probe.py` is the only thing in this repository that
 * can produce LIVE production evidence, and it runs in GitHub Actions where a
 * mistake is invisible until launch day. The failure classes that matter are not
 * "does the script parse" — they are:
 *
 *   1. the probe drifts from the origin the Android app actually ships, so it
 *      "verifies" a host no retailer uses;
 *   2. the retired-alias list drifts from `ApiBaseUrlContract.kt`, so a dead
 *      deployment alias is accepted as production;
 *   3. somebody adds a POST or an Authorization header, turning an anonymous
 *      read-only probe into something that can mutate data or leak a token;
 *   4. the redaction filter is weakened, and a JWT or connection string reaches
 *      a PR comment;
 *   5. a protected endpoint's expectation is loosened to accept 200, which would
 *      turn a data-exposure incident into a green check.
 *
 * All five are asserted here against the real source files. The script's own
 * behaviour is additionally exercised by running its offline `--self-test` when a
 * Python interpreter is present — and the workflow guard below proves CI always
 * runs it, so the suite can never silently depend on an interpreter that a
 * contributor's machine lacks.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const PROBE = read('scripts/production-health-probe.py');
const WORKFLOW = read('.github/workflows/production-health.yml');
const GRADLE = read('android/app/build.gradle.kts');
const API_CONTRACT = read('android/app/src/main/kotlin/com/maharanitraders/app/ApiBaseUrlContract.kt');

/** Strip Python comments so an example in a docstring cannot satisfy a guard. */
const codeOnly = (python: string) =>
  python
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');

describe('1. the probe targets the real production origin', () => {
  const probeOrigin = PROBE.match(/^PRODUCTION_ORIGIN = "([^"]+)"/m)?.[1];
  const gradleOrigin = GRADLE.match(/\?:\s*"(https:\/\/[^"]+)"/)?.[1];

  it('declares a production origin', () => {
    expect(probeOrigin).toBeTruthy();
    expect(probeOrigin).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/);
  });

  it('agrees with the origin compiled into the Android release build', () => {
    // The APK's BuildConfig.API_BASE_URL is the retailer's actual path to the
    // backend. If these two ever diverge, the probe would certify a host that no
    // installed app talks to.
    expect(gradleOrigin, 'android/app/build.gradle.kts must keep a trailing slash for Retrofit').toBeTruthy();
    expect(probeOrigin).toBe(gradleOrigin?.replace(/\/$/, ''));
  });

  it('never treats a retired deployment alias as production', () => {
    const probeRetired = [...PROBE.matchAll(/^\s{8}"([a-z0-9.-]+\.vercel\.app)",$/gm)].map((m) => m[1]);
    const kotlinRetired = [
      ...API_CONTRACT.matchAll(/^\s*"([a-z0-9.-]+\.vercel\.app)",$/gm),
    ].map((m) => m[1]);

    expect(kotlinRetired.length, 'ApiBaseUrlContract.kt must keep listing the retired aliases').toBeGreaterThan(0);
    expect(probeRetired.length).toBeGreaterThan(0);
    expect(probeRetired.sort()).toEqual([...kotlinRetired].sort());
  });

  it('refuses local, loopback and private hosts before making any request', () => {
    expect(PROBE).toContain('def validate_origin');
    expect(PROBE).toContain('origin must use https for production');
    for (const forbidden of ['localhost', '127.0.0.1', '10.0.2.2', '::1']) {
      expect(PROBE, `${forbidden} must be in FORBIDDEN_HOSTS`).toContain(`"${forbidden}"`);
    }
    // DNS is resolved so a public-looking name pointing at loopback is refused too.
    expect(PROBE).toContain('socket.getaddrinfo');
    expect(PROBE).toContain('addr.is_loopback');
    expect(PROBE).toContain('addr.is_private');
  });

  it('rejects credentials embedded in the origin', () => {
    expect(PROBE).toContain('origin must not contain credentials');
  });
});

describe('2. the probe is anonymous and read-only', () => {
  it('only ever issues GET', () => {
    const code = codeOnly(PROBE);
    expect(code).toContain('method="GET"');
    expect(code).not.toMatch(/method="(POST|PUT|PATCH|DELETE)"/);
    // No request body is ever attached.
    expect(code).not.toMatch(/urllib\.request\.Request\([^)]*\bdata=/);
  });

  it('sends no Authorization header and no cookies', () => {
    const code = codeOnly(PROBE);
    expect(code).not.toMatch(/["']Authorization["']\s*:/);
    expect(code).not.toMatch(/["']Cookie["']\s*:/);
    expect(code).not.toMatch(/["']X-Api-Key["']\s*:/i);
    expect(code).not.toContain('os.environ.get("SUPABASE');
    expect(code).not.toContain('SERVICE_ROLE');
  });

  it('never POSTs to the login route — it proves deployment with a 405 instead', () => {
    // Repeated login attempts would trip the real auth rate limiter and could
    // lock out a genuine retailer. GET on a POST-only route is the safe proof.
    expect(PROBE).toMatch(/"\/api\/mobile\/v1\/auth\/login",\s*\n\s*expect=\[405\]/);
    expect(PROBE).toContain('WITHOUT sending');
  });

  it('never follows a redirect, so a middleware 307 cannot masquerade as a 200', () => {
    expect(PROBE).toContain('class _NoRedirect');
    expect(PROBE).toMatch(/def redirect_request\([^)]*\)[^:]*:\s*\n\s*return None/);
    expect(PROBE).toContain('_NoRedirect()');
  });

  it('is pure stdlib, so it needs no install step and no lockfile entry', () => {
    const imports = [...PROBE.matchAll(/^(?:import|from)\s+([A-Za-z0-9_.]+)/gm)].map(
      (m) => m[1]?.split('.')[0]
    );
    const allowed = new Set([
      '__future__', 'argparse', 'json', 'os', 're', 'socket', 'ssl', 'sys', 'time',
      'urllib', 'datetime', 'typing', 'ipaddress',
    ]);
    for (const module of imports) {
      expect(allowed.has(module as string), `unexpected dependency: ${module}`).toBe(true);
    }
  });
});

describe('3. the probe covers the launch-critical production gates', () => {
  const targetPaths = [...PROBE.matchAll(/^\s+"(\/[^"]*)",$/gm)].map((m) => m[1]);

  it('probes both health endpoints named in the launch task', () => {
    expect(targetPaths).toContain('/api/health');
    expect(targetPaths).toContain('/api/mobile/v1/health');
  });

  it('probes the storefront and the login screen', () => {
    expect(targetPaths).toContain('/');
    expect(targetPaths).toContain('/login');
  });

  it('probes the mobile APIs the Android app depends on at startup', () => {
    for (const path of [
      '/api/mobile/v1/session',
      '/api/mobile/v1/cart',
      '/api/mobile/v1/catalog/products',
      '/api/mobile/v1/orders',
      '/api/mobile/v1/auth/login',
    ]) {
      expect(targetPaths, `${path} must be probed`).toContain(path);
    }
  });

  it('proves session enforcement by expecting a redirect to /login on protected pages', () => {
    expect(PROBE).toMatch(/"\/retailer\/home",[\s\S]{0,220}?expect_location="\/login"/);
    expect(PROBE).toMatch(/"\/admin\/dashboard",[\s\S]{0,220}?expect_location="\/login"/);
  });

  it('treats 200 on a protected API as a FAILURE, not a pass', () => {
    // This is the security assertion that matters most: loosening any of these to
    // accept 200 would turn a retailer-data exposure into a green check mark.
    for (const path of [
      '/api/mobile/v1/session',
      '/api/mobile/v1/cart',
      '/api/mobile/v1/catalog/products',
    ]) {
      const block = PROBE.slice(PROBE.indexOf(`"${path}",`), PROBE.indexOf(`"${path}",`) + 400);
      expect(block, `${path} must expect 401`).toMatch(/expect=\[401[\], 405]*\]/);
      expect(block, `${path} must NOT accept 200`).not.toMatch(/expect=\[[^\]]*\b200\b/);
    }
  });

  it('asserts the health bodies actually say the database is reachable', () => {
    expect(PROBE).toMatch(/expect_body=\{"status": "ok", "database": "reachable"\}/);
    // A 200 with a degraded database must not pass: the mismatch is reported per
    // key, and the reported path names the envelope it was read from.
    expect(PROBE).toContain('was {actual!r}, expected {wanted!r}');
    expect(PROBE).toMatch(/f"\{target\.envelope\}\.\{key\}" if target\.envelope else f"body\.\{key\}"/);
    expect(PROBE).toContain('expect_body={"status": "ok"}');
  });

  it('bounds retries and timeouts so the gate cannot hang the pipeline', () => {
    expect(PROBE).toMatch(/^DEFAULT_TIMEOUT_SECONDS = 10\.0$/m);
    expect(PROBE).toMatch(/^DEFAULT_ATTEMPTS = 3$/m);
    expect(PROBE).toContain('read(65_536)');
    // Only transport errors and 5xx are retried; a definitive answer is accepted
    // immediately so retry noise cannot mask a wrong expectation.
    expect(PROBE).toContain('retryable = status is None or status >= 500');
  });

  it('exits non-zero unless every target passed', () => {
    expect(PROBE).toContain('return 0 if not failed else 1');
    expect(PROBE).toContain('::error title=production probe failed');
  });
});

describe('4. the probe reads this backend\'s two response envelopes correctly', () => {
  // lib/mobile/http.ts: jsonOk -> { data, requestId }, jsonError -> { error, requestId }.
  // The operational /api/health predates that contract and answers flat. Reading
  // the wrong level is not cosmetic — it reported a HEALTHY production as broken
  // on the probe's first real run.
  /**
   * Slice exactly one Target(...) call, cut at its own closing `),` — a fixed-width
   * window would bleed into the neighbouring target and let one target's envelope
   * satisfy another target's assertion.
   */
  const blockFor = (path: string) => {
    const start = PROBE.indexOf(`"${path}",`);
    expect(start, `${path} must be a probe target`).toBeGreaterThan(-1);
    const end = PROBE.indexOf('\n        ),', start);
    expect(end, `${path} target must be a closed Target(...) call`).toBeGreaterThan(start);
    return PROBE.slice(start, end);
  };

  it('reads the mobile health endpoint through the data envelope', () => {
    const block = blockFor('/api/mobile/v1/health');
    expect(block).toContain('envelope="data"');
    expect(block).toContain('"apiVersion"');
  });

  it('reads the operational health endpoint as a FLAT body, with no envelope', () => {
    const block = blockFor('/api/health');
    expect(block).not.toContain('envelope=');
    expect(block).toContain('"latencyMs"');
  });

  it('reads every refusal through the error envelope and asserts the exact code', () => {
    // Asserting the code is what distinguishes the application's own auth refusal
    // from an unrelated 401 emitted by an edge or a proxy.
    for (const path of [
      '/api/mobile/v1/session',
      '/api/mobile/v1/cart',
      '/api/mobile/v1/catalog/products',
      '/api/mobile/v1/orders',
    ]) {
      const block = blockFor(path);
      expect(block, `${path} must unwrap the error envelope`).toContain('envelope="error"');
      expect(block, `${path} must assert missing_token`).toContain('expect_body={"code": "missing_token"}');
    }
  });

  it('asserts the method-guard code on the login route', () => {
    const block = blockFor('/api/mobile/v1/auth/login');
    expect(block).toContain('envelope="error"');
    expect(block).toContain('expect_body={"code": "method_not_allowed"}');
  });

  it('treats a missing envelope object as a contract break, not an empty pass', () => {
    expect(PROBE).toContain('mobile envelope shape mismatch');
    expect(PROBE).toMatch(/if not isinstance\(inner, dict\):/);
  });

  it('lifts only the request id from beside the envelope, for incident correlation', () => {
    expect(PROBE).toContain('ENVELOPE_SIBLING_KEYS: tuple[str, ...] = ("requestId",)');
    // Nothing else may be lifted: the sibling list is the only place a top-level
    // field can reach the report from outside the allowlisted envelope object.
    expect(PROBE).toMatch(/for sibling in ENVELOPE_SIBLING_KEYS:/);
    expect(PROBE).toContain('if sibling in target.allowed_body_keys and sibling not in projected');
    expect(PROBE.match(/ENVELOPE_SIBLING_KEYS: tuple\[str, \.\.\.\] = \(([^)]*)\)/)?.[1] ?? '')
      .toBe('"requestId",');
  });

  it('proves all of it in the offline self-test, including the negative cases', () => {
    expect(PROBE).toContain('mobile health unwraps the data envelope');
    expect(PROBE).toContain('operational health reads its FLAT body');
    expect(PROBE).toContain('a 401 records the auth refusal code');
    expect(PROBE).toContain('a missing data envelope FAILS the probe');
    expect(PROBE).toContain('a 401 with an unexpected code FAILS the probe');
    expect(PROBE).toContain('a 200 on a protected API FAILS the probe');
  });
});

describe('5. the probe cannot leak a secret into evidence', () => {
  it('redacts JWTs, bearer tokens, connection strings and key-shaped values', () => {
    expect(PROBE).toContain('\\beyJ[A-Za-z0-9_\\-]{8,}');
    for (const needle of ['JWT', 'BEARER', 'CONNECTION_STRING', 'SUPABASE_KEY', 'LONG_TOKEN', 'CREDENTIAL_ASSIGNMENT']) {
      expect(PROBE, `${needle} redaction pattern must exist`).toContain(`("${needle}"`);
    }
    expect(PROBE).toContain('REDACTED = "[REDACTED]"');
  });

  it('routes every emitted string through the redaction filter', () => {
    expect(PROBE).toContain('def redact(text: str) -> str:');
    // Errors are the classic leak path: urllib puts a redirected URL, possibly
    // with a token query parameter, straight into an HTTPError string.
    expect(PROBE).toContain('ProbeTransportError(redact(str(error.reason)))');
    expect(PROBE).toMatch(/"reasons": \[redact\(r\) for r in self\.reasons\]/);
    expect(PROBE).toMatch(/"error": redact\(self\.error\)/);
    expect(PROBE).toMatch(/redact\(reason\) for reason in result\.reasons/);
  });

  it('projects bodies onto an allowlist instead of printing them', () => {
    expect(PROBE).toContain('def redact_mapping(');
    expect(PROBE).toContain('if key not in allowed:');
    expect(PROBE).toContain('continue');
    // Nested containers are dropped rather than walked, so a new nested field can
    // never leak through an allowlisted parent key.
    expect(PROBE).toMatch(/if isinstance\(value, \(dict, list\)\):\s*\n\s*continue/);
    expect(PROBE).toContain('projected = redact_mapping(container, target.allowed_body_keys)');
    expect(PROBE).toContain('result.body = projected');
  });

  it('allowlists no secret-shaped field name', () => {
    const allowed = [...PROBE.matchAll(/allowed_body_keys=\(([^)]*)\)/g)]
      .map((m) => m[1] ?? '')
      .join(',');
    const names = [...allowed.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(name, `${name} must never be allowlisted`).not.toMatch(
        /token|secret|password|key|credential|authorization|jwt|session|cookie|connection/i
      );
    }
  });

  it('drops the redirect query string before comparing or printing it', () => {
    expect(PROBE).toMatch(/value = location\.split\("#", 1\)\[0\]\.split\("\?", 1\)\[0\]/);
  });
});

describe('6. the workflow publishes evidence and fails the gate honestly', () => {
  it('verifies the probe logic offline before pointing it at production', () => {
    expect(WORKFLOW).toContain('python3 scripts/production-health-probe.py --self-test');
  });

  it('probes the real production URL and never a local stand-in', () => {
    expect(WORKFLOW).toContain('https://maharanitraders.vercel.app');
    expect(WORKFLOW).not.toMatch(/--origin\s+["']?https?:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)/);
    expect(WORKFLOW).not.toContain('npm run dev');
    expect(WORKFLOW).not.toContain('next start');
  });

  it('records status, latency and timestamp evidence as an artifact and a summary', () => {
    expect(WORKFLOW).toContain('GITHUB_STEP_SUMMARY');
    expect(WORKFLOW).toContain('actions/upload-artifact');
    expect(WORKFLOW).toContain('production-health.json');
    expect(WORKFLOW).toContain('if-no-files-found: error');
    expect(PROBE).toContain('"latencyMs"');
    expect(PROBE).toContain('"probedAtUtc"');
  });

  it('posts the evidence where api.github.com can serve it', () => {
    // Actions logs live in Azure blob storage, unreachable from some environments.
    expect(WORKFLOW).toContain('gh pr comment');
    expect(WORKFLOW).toContain('repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/comments');
  });

  it('resolves the pull request from the event payload, not from GITHUB_REF_NAME', () => {
    // On a pull_request event GITHUB_REF_NAME is "<pr>/merge", which matches no
    // head branch — that is exactly why the first real run posted no evidence
    // comment at all.
    expect(WORKFLOW).toContain('github.event.pull_request.number');
    expect(WORKFLOW).toContain('GITHUB_HEAD_REF');
  });

  it('replaces its own previous evidence comment instead of stacking one per push', () => {
    expect(WORKFLOW).toContain('<!-- production-health-evidence -->');
    expect(WORKFLOW).toContain('-X PATCH');
  });

  it('references no secret other than the automatic GITHUB_TOKEN', () => {
    const referenced = [...WORKFLOW.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(name, `${name} must not be needed by an anonymous probe`).toBe('GITHUB_TOKEN');
    }
    // ...and the workflow enforces that on every run, so it cannot regress.
    expect(WORKFLOW).toContain('Guard — this workflow must reference no credentials');
  });

  it('has a dedicated step that turns an unhealthy production into a red job', () => {
    expect(WORKFLOW).toContain('Fail the gate when production is unhealthy');
    expect(WORKFLOW).toMatch(/if \[ "\$\{\{ steps\.probe\.outputs\.verdict \}\}" = "PASS" \]/);
  });

  it('says plainly that a pull-request run measures deployed main, not the diff', () => {
    expect(WORKFLOW).toContain('currently DEPLOYED production');
    expect(WORKFLOW).toContain('not necessarily a defect in this diff');
  });

  it('resolves the host first so an egress failure is reported as itself', () => {
    expect(WORKFLOW).toContain('Confirm the runner can actually reach production');
    expect(WORKFLOW).toContain('cannot resolve production host');
  });
});

describe('7. the launch-gate report the probe feeds actually exists', () => {
  it('is present and records the production-health verdict', () => {
    // The probe's module docstring names this file as the gate it feeds. A
    // dangling reference in a launch document is how a report gets written and
    // then quietly never read.
    const doc = read('docs/LAUNCH_RELEASE_GATE_2026-10-11.md');
    expect(doc).toContain('Production health');
    expect(doc).toContain('maharanitraders.vercel.app');
    expect(doc).toContain('/api/mobile/v1/health');
    expect(doc).toContain('missing_token');
  });

  it('states the verdict for every gate the launch task asks for', () => {
    const doc = read('docs/LAUNCH_RELEASE_GATE_2026-10-11.md');
    for (const gate of [
      'Reference-style Home',
      'Catalog, Categories, Brands',
      'Website functionality',
      'Android functionality',
      'Cart and checkout',
      'Admin Category/Brand flow',
      'Session persistence',
      'Security',
      'Responsive rendered UI',
      'Web tests and production build',
      'Android tests and release build',
      'Actual CI status',
      'Production health',
      'Signed release artifact',
      'Existing PR status',
    ]) {
      expect(doc, `gate "${gate}" must be reported`).toContain(gate);
    }
    // Every gate carries one of the three permitted verdicts.
    expect(doc).toContain('PASS');
    expect(doc).toContain('PARTIAL');
    expect(doc).toContain('BLOCKED');
  });

  it('does not claim launch readiness while a gate is blocked', () => {
    const doc = read('docs/LAUNCH_RELEASE_GATE_2026-10-11.md');
    expect(doc).toContain('**NOT launch-ready.**');
    // No affirmative readiness claim anywhere in the report.
    expect(doc).not.toMatch(/(?:is|are|now|fully|officially)\s+launch[- ]ready/i);
    expect(doc).not.toMatch(/ready (?:for|to) (?:public )?launch/i);
    expect(doc).not.toContain('All gates PASS');
  });
});

describe('8. the probe behaviour is executed, not only read', () => {  const python = (() => {
    for (const candidate of ['python3', 'python']) {
      try {
        execFileSync(candidate, ['--version'], { stdio: 'ignore' });
        return candidate;
      } catch {
        /* try the next candidate */
      }
    }
    return null;
  })();

  it(
    'passes its own offline self-test (origin guard, redaction, expectations, retries)',
    { skip: python === null },
    () => {
      const output = execFileSync(python as string, ['scripts/production-health-probe.py', '--self-test'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      });
      expect(output).toContain('SELF-TEST PASSED');
    }
  );

  it('the self-test is guaranteed to run in CI even without a local interpreter', () => {
    // The skip above must never become a silent hole: CI always executes it.
    expect(WORKFLOW).toContain('Verify the probe logic offline');
    if (python === null) {
      // eslint-disable-next-line no-console
      console.warn(
        '[production-health-probe] no Python interpreter on this machine — the offline ' +
          'self-test was skipped locally but is enforced by .github/workflows/production-health.yml.'
      );
    }
  });
});
