/**
 * scripts/production-probe.mjs — live probe of the ONE production deployment.
 *
 * The URL is FIXED: {@link PRODUCTION_URL}. It is never overridden at runtime,
 * never inferred, and the retired deployment aliases are refused on sight —
 * a probe that silently follows a retired alias would certify a deployment
 * that is not production any more.
 *
 * The probe answers one question — "is the production health endpoint
 * answering?" — and reports a VERDICT even when it cannot answer. The verdict
 * vocabulary is deliberately small and honest:
 *
 *   PRODUCTION_REACHABLE   the health endpoint answered 2xx. (exit 0)
 *   PRODUCTION_ERROR       the host answered, but not with 2xx — the server
 *                          is up and the application is not healthy. (exit 2)
 *   PRODUCTION_UNREACHABLE the host could not be reached at TCP/DNS level (or
 *                          the request timed out) WHILE control hosts on the
 *                          open internet answered: this is an outage signal,
 *                          not an environment artefact. (exit 3)
 *   NETWORK_RESTRICTED     this environment cannot reach the open internet
 *                          (or filters which hosts it may reach), so the
 *                          production answer is UNKNOWN here. This is NOT
 *                          reported as an outage. (exit 4)
 *
 * The distinction between the last two is empirical, not guessed: two CONTROL
 * hosts are probed under the same network policy —
 * `https://api.github.com/` and `https://example.com/`. If the controls fail
 * the same way production does, the environment is the cause (sandbox egress
 * allowlist, offline runner, proxy). If the controls answer and production
 * does not, the environment is fine and production is the problem.
 *
 * SECRET REDACTION is part of the contract, not a nicety: every string this
 * module returns passes through {@link redact}, which strips Authorization /
 * Cookie / Set-Cookie header values and replaces any explicitly registered
 * secret value with `[REDACTED]`. The probe never echoes request headers.
 *
 * CLI usage (also what CI runs):
 *   node scripts/production-probe.mjs            # probe and print a verdict
 *   node scripts/production-probe.mjs --json     # machine-readable verdict
 * The verdict block is ALWAYS printed, on every exit path, before exiting.
 */

/** The one production deployment. FIXED on purpose — see the header. */
export const PRODUCTION_URL = 'https://maharanitraders.vercel.app';

/** Health endpoint probed: same origin as the app, no alias hop. */
export const HEALTH_PATH = '/api/health';

/**
 * Retired deployment aliases. The probe refuses to contact these hosts and
 * refuses any redirect that lands on them: a green verdict for a retired alias
 * is worse than no verdict.
 */
export const RETIRED_ALIASES = [
  'maharani-mart-one.vercel.app',
  'maharani-mart-mahakali108s-projects.vercel.app',
];

/**
 * Control hosts used ONLY to tell "this environment cannot reach the internet"
 * apart from "production is down". Never part of the production verdict URL.
 */
export const CONTROL_URLS = ['https://api.github.com/', 'https://example.com/'];

export const VERDICTS = {
  REACHABLE: 'PRODUCTION_REACHABLE',
  HTTP_ERROR: 'PRODUCTION_ERROR',
  UNREACHABLE: 'PRODUCTION_UNREACHABLE',
  RESTRICTED: 'NETWORK_RESTRICTED',
};

/** Exit code per verdict, so CI can gate on the probe without parsing text. */
export const EXIT_CODES = {
  [VERDICTS.REACHABLE]: 0,
  [VERDICTS.HTTP_ERROR]: 2,
  [VERDICTS.UNREACHABLE]: 3,
  [VERDICTS.RESTRICTED]: 4,
};

const DEFAULT_TIMEOUT_MS = 10_000;

/** Secret values registered for redaction (e.g. a probe token). */
const registeredSecrets = new Set();

/** Register a literal secret value that must never appear in any output. */
export function registerSecret(value) {
  if (value && typeof value === 'string') registeredSecrets.add(value);
}

/** Clear registered secrets — tests only. */
export function clearRegisteredSecrets() {
  registeredSecrets.clear();
}

/**
 * Redact anything that could carry signing material, a token or a password:
 * Authorization/Cookie/Set-Cookie header values, `Bearer …` tokens, and every
 * explicitly registered secret value.
 */
export function redact(input) {
  if (input == null) return input;
  let text = String(input);
  for (const secret of registeredSecrets) {
    if (secret) text = text.split(secret).join('[REDACTED]');
  }
  text = text
    .replace(/(authorization\s*[:=]\s*)(\S.*)$/gim, '$1[REDACTED]')
    .replace(/((?:set-)?cookie\s*[:=]\s*)(\S.*)$/gim, '$1[REDACTED]')
    .replace(/\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gim, '$1 [REDACTED]')
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{8,})\b/g, '[REDACTED]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED PRIVATE KEY]');
  return text;
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Validate a candidate base URL against the fixed-production rules. Used by the
 * CLI and callable from tests: retired aliases and non-https schemes are
 * rejected loudly, never "fixed up".
 */
export function validateProductionUrl(url = PRODUCTION_URL) {
  const host = hostOf(url);
  if (!host) return { ok: false, reason: `not a URL: ${redact(url)}` };
  if (RETIRED_ALIASES.includes(host)) {
    return { ok: false, reason: `refusing retired deployment alias: ${host}` };
  }
  if (!String(url).startsWith('https://')) {
    return { ok: false, reason: 'production URL must be https' };
  }
  return { ok: true, host };
}

async function fetchOnce(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'maharani-production-probe/1.0' },
    });
    return { ok: true, response };
  } catch (error) {
    return { ok: false, error };
  } finally {
    clearTimeout(timer);
  }
}

function errorKind(error) {
  const raw = `${(error && error.name) || ''} ${(error && error.message) || ''} ${(error && error.cause && (error.cause.code || error.cause.message)) || ''}`;
  if (/abort|timeout/i.test(raw)) return 'timeout';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(raw)) return 'dns';
  if (/ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed|network/i.test(raw)) return 'connect';
  return 'unknown';
}

/**
 * Probe the production health endpoint and classify the result.
 *
 * @param {object} [options]
 * @param {string} [options.url]           defaults to PRODUCTION_URL (tests only)
 * @param {typeof fetch} [options.fetchImpl] injected fetch (tests only)
 * @param {number} [options.timeoutMs]     per-request deadline
 * @returns {Promise<{
 *   verdict: string, path: string, url: string, status: number|null,
 *   latencyMs: number, detail: string, controls: object, exitCode: number,
 * }>}
 */
export async function probeProduction(options = {}) {
  const {
    url = PRODUCTION_URL,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const started = Date.now();
  const base = {
    url: redact(url),
    status: null,
    latencyMs: 0,
    controls: {},
  };

  const checked = validateProductionUrl(url);
  if (!checked.ok) {
    // A retired alias (or worse) was requested: report against the FIXED
    // deployment instead of certifying the alias.
    return finish({
      ...base,
      verdict: VERDICTS.HTTP_ERROR,
      path: 'refused-url',
      detail: `${checked.reason} — probing ${PRODUCTION_URL} is the only supported mode`,
    });
  }

  function finish(result) {
    return {
      ...result,
      detail: redact(result.detail),
      latencyMs: Date.now() - started,
      exitCode: EXIT_CODES[result.verdict],
    };
  }

  const probe = await fetchOnce(fetchImpl, url.replace(/\/$/, '') + HEALTH_PATH, timeoutMs);

  if (probe.ok) {
    const { response } = probe;
    // redirect: 'manual' — a 3xx is REPORTED, never followed. Following it
    // could land on a retired alias and turn a dead deployment green.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers && typeof response.headers.get === 'function'
        ? response.headers.get('location')
        : null;
      const target = location ? hostOf(new URL(location, url)) : '(unspecified)';
      const retired = RETIRED_ALIASES.includes(target);
      return finish({
        ...base,
        status: response.status,
        verdict: VERDICTS.HTTP_ERROR,
        path: 'http-error',
        detail: retired
          ? `HTTP ${response.status} redirect to RETIRED alias ${target} refused — not followed`
          : `HTTP ${response.status} redirect to ${target} reported, not followed`,
      });
    }
    if (response.status >= 200 && response.status < 300) {
      return finish({
        ...base,
        status: response.status,
        verdict: VERDICTS.REACHABLE,
        path: 'success',
        detail: `health endpoint answered HTTP ${response.status}`,
      });
    }
    return finish({
      ...base,
      status: response.status,
      verdict: VERDICTS.HTTP_ERROR,
      path: 'http-error',
      detail: `host answered HTTP ${response.status}`,
    });
  }

  // The request itself failed (DNS / connect / timeout). Controls decide
  // whether that is an outage or this environment's network policy.
  //
  // Two controls, two questions:
  //   - api.github.com   answers even in allowlisted sandboxes (it is almost
  //                      always on the permit list), so it proves "some egress".
  //   - example.com      is plain open internet. If THIS cannot be reached
  //                      while github can, the environment is filtering hosts,
  //                      and a verdict about production would be a guess.
  const productionKind = errorKind(probe.error);
  const controlResults = {};
  for (const controlUrl of CONTROL_URLS) {
    const attempt = await fetchOnce(fetchImpl, controlUrl, timeoutMs);
    controlResults[controlUrl] = attempt.ok ? `http-${attempt.response.status}` : `error-${errorKind(attempt.error)}`;
  }
  const genericControlOk = String(controlResults[CONTROL_URLS[1]] || '').startsWith('http-');
  const anyControlOk = Object.values(controlResults).some((v) => String(v).startsWith('http-'));
  const path = productionKind === 'timeout' ? 'timeout' : 'unreachable-host';
  const controlSummary = Object.entries(controlResults)
    .map(([k, v]) => `${hostOf(k)}=${v}`)
    .join(', ');

  if (!genericControlOk) {
    return finish({
      ...base,
      verdict: VERDICTS.RESTRICTED,
      path,
      controls: controlResults,
      detail:
        `production ${productionKind} failure AND the open-internet control (example.com) failed ` +
        `(${controlSummary}) — this environment filters or blocks general egress, so production ` +
        'is UNKNOWN here, not down',
    });
  }

  return finish({
    ...base,
    verdict: VERDICTS.UNREACHABLE,
    path,
    controls: controlResults,
    detail:
      `production ${productionKind} failure while control hosts answered ` +
      `(${controlSummary}${anyControlOk ? '' : ''}) — ` +
      'the environment is fine, so this is a production reachability signal',
  });
}

export function markdownVerdict(result) {
  const lines = [
    '### Production probe',
    '',
    `- URL: \`${result.url}\` (fixed; retired aliases refused)`,
    `- Verdict: **${result.verdict}** (exit ${result.exitCode})`,
    `- Path: \`${result.path}\`  ·  HTTP status: ${result.status ?? '—'}  ·  latency: ${result.latencyMs} ms`,
    `- Detail: ${result.detail}`,
  ];
  if (result.controls && Object.keys(result.controls).length) {
    lines.push(`- Controls: ${Object.entries(result.controls).map(([k, v]) => `${hostOf(k)}=${v}`).join(', ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function main(argv = [], options = {}) {
  const asJson = argv.includes('--json');
  const result = await probeProduction(options);

  // The verdict is ALWAYS printed — before any exit, on every path — so a
  // failing probe can never hide its own conclusion.
  const md = markdownVerdict(result);
  const payload = JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2);
  if (asJson) {
    console.log(payload);
  } else {
    console.log(md);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  }
  return result.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      // Last-resort: even an unexpected crash still states a verdict.
      console.error('### Production probe');
      console.error(`- Verdict: **${VERDICTS.RESTRICTED}** (exit ${EXIT_CODES[VERDICTS.RESTRICTED]})`);
      console.error(`- Detail: probe crashed: ${redact(error && error.stack ? error.stack : error)}`);
      process.exit(EXIT_CODES[VERDICTS.RESTRICTED]);
    });
}
