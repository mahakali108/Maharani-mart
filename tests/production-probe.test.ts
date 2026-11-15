/**
 * Production probe — executable verification of every reported path.
 *
 * The probe is the thing that certifies (or refuses to certify) the live
 * deployment at the FIXED url https://maharanitraders.vercel.app. A probe whose
 * failure modes are untested is a probe that will eventually certify the wrong
 * thing, so every path the evidence report quotes is asserted here:
 *
 *   - success (2xx)
 *   - timeout (request exceeds its deadline)
 *   - unreachable-host (DNS/connect failure)
 *   - HTTP error (host answers non-2xx, including 3xx to a retired alias)
 *   - secret redaction (no token/cookie/private-key material in any output)
 *   - the verdict is REPORTED EVEN WHEN the probe fails
 *   - sandbox network restrictions are distinguished from a real outage
 *   - the production URL stays fixed and retired aliases are refused
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRegisteredSecrets,
  main,
  markdownVerdict,
  probeProduction,
  PRODUCTION_URL,
  registerSecret,
  RETIRED_ALIASES,
  validateProductionUrl,
  VERDICTS,
  EXIT_CODES,
  redact,
} from '../scripts/production-probe.mjs';

afterEach(() => clearRegisteredSecrets());

const ok = (status = 200) => ({
  status,
  headers: { get: (name: string) => (name.toLowerCase() === 'location' ? null : null) },
});
const redirect = (location: string) => ({
  status: 308,
  headers: { get: (name: string) => (name.toLowerCase() === 'location' ? location : null) },
});

/** A fetch double that answers per-URL and can fail/timeout per-URL. */
type FakeInit = { signal: AbortSignal };
type FakeHandler = (init: FakeInit) => unknown;

function fakeFetch(handlers: Record<string, FakeHandler>) {
  const impl = async (input: unknown, init: FakeInit = { signal: new AbortController().signal }) => {
    const url = String(input);
    const key = Object.keys(handlers).find((k) => url.startsWith(k));
    const handler = key ? handlers[key] : undefined;
    if (!handler) throw Object.assign(new Error(`fetch failed: ${url}`), { cause: { code: 'ECONNREFUSED' } });
    return handler(init);
  };
  // The probe only reads `status` and `headers.get`, which every double provides.
  return impl as unknown as typeof fetch;
}

/** All controls answer: this environment HAS internet access. */
const reachableInternet: Record<string, FakeHandler> = {
  'https://api.github.com/': () => ok(),
  'https://example.com/': () => ok(),
};

describe('the production URL is fixed and alias-proof', () => {
  it('is exactly the approved deployment', () => {
    expect(PRODUCTION_URL).toBe('https://maharanitraders.vercel.app');
  });

  it('refuses every retired deployment alias', () => {
    for (const alias of RETIRED_ALIASES) {
      const verdict = validateProductionUrl(`https://${alias}`);
      expect(verdict.ok, alias).toBe(false);
      expect(verdict.reason).toMatch(/retired/);
    }
  });

  it('refuses a retired alias through the probe itself, without contacting it', async () => {
    let contacts = 0;
    const result = await probeProduction({
      url: `https://${RETIRED_ALIASES[0]}`,
      fetchImpl: (() => {
        contacts += 1;
        return Promise.resolve(ok());
      }) as unknown as typeof fetch,
    });
    expect(contacts).toBe(0);
    expect(result.path).toBe('refused-url');
    expect(result.verdict).toBe(VERDICTS.HTTP_ERROR);
    expect(result.detail).toMatch(/retired/);
    // The verdict still names the fixed production URL as the only mode.
    expect(result.detail).toContain('maharanitraders.vercel.app');
  });

  it('reports — never follows — a redirect toward a retired alias', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => redirect(`https://${RETIRED_ALIASES[0]}/`),
        ...reachableInternet,
      }),
    });
    expect(result.verdict).toBe(VERDICTS.HTTP_ERROR);
    expect(result.path).toBe('http-error');
    expect(result.detail).toMatch(/RETIR[ED]+ alias/i);
    expect(result.detail).toMatch(/not followed/);
  });
});

describe('the probe classifies each failure path honestly', () => {
  it('success: 2xx from the health endpoint is PRODUCTION_REACHABLE', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/api/health': () => ok(200),
      }),
    });
    expect(result.verdict).toBe(VERDICTS.REACHABLE);
    expect(result.path).toBe('success');
    expect(result.status).toBe(200);
    expect(result.exitCode).toBe(0);
  });

  it('http-error: a 5xx answer is PRODUCTION_ERROR — the host is up', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/api/health': () => ok(503),
        ...reachableInternet,
      }),
    });
    expect(result.verdict).toBe(VERDICTS.HTTP_ERROR);
    expect(result.path).toBe('http-error');
    expect(result.status).toBe(503);
    expect(result.exitCode).toBe(EXIT_CODES[VERDICTS.HTTP_ERROR]);
  });

  it('unreachable-host: DNS failure with working controls is a PRODUCTION signal', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('getaddrinfo ENOTFOUND maharanitraders.vercel.app'), {
            cause: { code: 'ENOTFOUND' },
          });
        },
        ...reachableInternet,
      }),
    });
    expect(result.verdict).toBe(VERDICTS.UNREACHABLE);
    expect(result.path).toBe('unreachable-host');
    expect(result.exitCode).toBe(3);
    expect(result.detail).toMatch(/environment is fine/);
  });

  it('timeout: a request past its deadline with working controls is a PRODUCTION signal', async () => {
    const result = await probeProduction({
      timeoutMs: 40,
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': (init: FakeInit) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
            );
          }),
        ...reachableInternet,
      }),
    });
    expect(result.verdict).toBe(VERDICTS.UNREACHABLE);
    expect(result.path).toBe('timeout');
    expect(result.exitCode).toBe(3);
    expect(result.detail).toMatch(/timeout/);
  });
});

describe('the probe distinguishes sandbox restrictions from a real outage', () => {
  it('production down AND controls down is NETWORK_RESTRICTED, not an outage claim', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
        'https://api.github.com/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
        'https://example.com/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
      }),
    });
    expect(result.verdict).toBe(VERDICTS.RESTRICTED);
    expect(result.exitCode).toBe(4);
    expect(result.detail).toMatch(/UNKNOWN here, not down/);
    expect(result.detail).not.toMatch(/production is down/i);
  });

  it('a sandbox that allowlists hosts reads as NETWORK_RESTRICTED, not an outage', async () => {
    // Exactly this sandbox's shape: github (almost always allowlisted) answers,
    // the open-internet control is filtered, production is filtered.
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
        'https://api.github.com/': () => ok(),
        'https://example.com/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
      }),
    });
    expect(result.verdict).toBe(VERDICTS.RESTRICTED);
    expect(result.exitCode).toBe(4);
    expect(result.detail).toMatch(/UNKNOWN here, not down/);
    expect(result.detail).not.toMatch(/production reachability signal/);
    expect((result.controls as Record<string, string>)['https://example.com/']).toMatch(/error-/);
    expect((result.controls as Record<string, string>)['https://api.github.com/']).toMatch(/http-/);
  });

  it('offline runner (every request times out) is NETWORK_RESTRICTED', async () => {
    const slow = (init: FakeInit) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        );
      });
    const result = await probeProduction({
      timeoutMs: 30,
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': slow,
        'https://api.github.com/': slow,
        'https://example.com/': slow,
      }),
    });
    expect(result.verdict).toBe(VERDICTS.RESTRICTED);
    expect(result.path).toBe('timeout');
    expect(result.detail).toMatch(/UNKNOWN here, not down/);
  });
});

describe('the verdict is reported even when the probe fails', () => {
  it('markdownVerdict states the verdict for every failure shape', async () => {
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
        },
        ...reachableInternet,
      }),
    });
    const md = markdownVerdict(result);
    expect(md).toContain('### Production probe');
    expect(md).toContain(result.verdict);
    expect(md).toContain(String(result.exitCode));
  });

  it('main() prints the verdict and returns the exit code even on failure', async () => {
    const printed: string[] = [];
    const original = console.log;
    console.log = (line: string) => printed.push(String(line));
    try {
      const code = await main([], {
        fetchImpl: fakeFetch({
          'https://maharanitraders.vercel.app/api/health': () => ok(500),
          ...reachableInternet,
        }),
      });
      expect(code).toBe(2);
      expect(printed.join('\n')).toContain('PRODUCTION_ERROR');
    } finally {
      console.log = original;
    }
  });

  it('main() reports a restricted verdict and exits 4 when the crash path is hit', async () => {
    const printed: string[] = [];
    const original = console.log;
    console.log = (line: string) => printed.push(String(line));
    try {
      const code = await main([], {
        fetchImpl: () => {
          throw Object.assign(new Error('this sandbox refuses the connection'), { cause: { code: 'ECONNREFUSED' } });
        },
      });
      expect(code).toBe(4);
      const output = printed.join('\n');
      expect(output).toContain('NETWORK_RESTRICTED');
      // The restricted verdict must not claim a production outage.
      expect(output).not.toMatch(/production is down/i);
    } finally {
      console.log = original;
    }
  });
});

describe('no signing material or token can survive the probe output', () => {
  it('redacts bearer tokens, cookies, private keys and registered secrets', () => {
    registerSecret('super-secret-keystore-password');
    const dirty =
      'Authorization: Bearer abcdefghijklmnop\n' +
      'Set-Cookie: session=1234567890; HttpOnly\n' +
      'failed with password super-secret-keystore-password\n' +
      'ghp_abcdefghijklmnop1234567890abcd\n' +
      '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg\n-----END PRIVATE KEY-----';
    const clean = redact(dirty);
    expect(clean).not.toContain('abcdefghijklmnop');
    expect(clean).not.toContain('session=1234567890');
    expect(clean).not.toContain('super-secret-keystore-password');
    expect(clean).not.toContain('ghp_');
    expect(clean).not.toContain('MIIEvQIBADANBg');
    expect(clean).toContain('[REDACTED]');
    expect(clean).toContain('[REDACTED PRIVATE KEY]');
  });

  it('a thrown error carrying a secret is redacted inside the reported detail', async () => {
    registerSecret('hunter2-keystore-password');
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('connect refused for hunter2-keystore-password'), {
            cause: { code: 'ECONNREFUSED' },
          });
        },
        ...reachableInternet,
      }),
    });
    expect(result.detail).not.toContain('hunter2-keystore-password');
    // The detail still explains WHAT failed, just not with the secret.
    expect(result.detail).toMatch(/connect|failure/i);
  });

  it('the markdown verdict never contains registered secrets', async () => {
    registerSecret('release-key-password-42');
    const result = await probeProduction({
      fetchImpl: fakeFetch({
        'https://maharanitraders.vercel.app/': () => {
          throw Object.assign(new Error('proxy auth failed: release-key-password-42'), {
            cause: { code: 'ECONNREFUSED' },
          });
        },
        ...reachableInternet,
      }),
    });
    expect(markdownVerdict(result)).not.toContain('release-key-password-42');
  });
});
