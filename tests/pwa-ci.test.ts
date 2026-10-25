import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

/**
 * Web CI is the release gate for this PWA; the native Android pipeline is a
 * historical, manual diagnostic.
 *
 * These assertions used to live entirely in `android-apk.yml`, which meant the
 * web gate ran on every push AND every pull request of a private Free-tier
 * repository, alongside a 45-minute Android job and a live production probe.
 * That shape is what exhausted the account's included Actions minutes (see
 * docs/CI_ACTIONS_ZERO_COST.md). The split below keeps every guarantee the
 * earlier test protected — web checks still block a merge into main, native
 * automation still cannot run by accident — while removing the duplicate and
 * the unrelated work from normal developer activity.
 *
 * The intent of the original test is preserved deliberately: "retiring native
 * automation must not silently remove those release gates". So each guarantee
 * is asserted against its new home, and the absence of the old triggers is
 * asserted explicitly.
 */
describe('web PWA CI', () => {
  const ci = read('.github/workflows/ci.yml');
  const native = read('.github/workflows/android-apk.yml');
  const health = read('.github/workflows/production-health.yml');

  it('runs the web gate on pull requests into main and on pushes to main', () => {
    expect(ci).toMatch(/\n  pull_request:\n/);
    expect(ci).toMatch(/\n  push:\n/);
    expect(ci).toMatch(/\n    branches: \[main\]\n/);
  });

  it('runs typecheck, lint, tests and a production build through the repo scripts', () => {
    for (const command of [
      'corepack pnpm install --frozen-lockfile',
      'corepack pnpm run typecheck',
      'corepack pnpm run lint',
      'corepack pnpm test',
      'corepack pnpm run build',
    ]) {
      expect(ci).toContain(command);
    }
  });

  it('keeps the web job unconditional and cheap', () => {
    const web = ci.split('\n  web:\n')[1] ?? '';
    // No `if:` — a skipped required check is worse than a red one: it can leave
    // a pull request permanently "pending" instead of honestly failing.
    expect(web).not.toMatch(/\n    if:/);
    // No matrix / services / container: one runner, one install, one build.
    expect(web).not.toMatch(/\n    strategy:/);
    expect(web).not.toMatch(/\n    services:/);
    // A superseded push must stop paying for the run it replaced.
    expect(ci).toContain('cancel-in-progress: true');
    // The gate needs no secret at all.
    expect(ci).not.toMatch(/secrets\.[A-Za-z0-9_]+/);
  });

  it('leaves the native APK pipeline manual-only', () => {
    // Triggers that made every push and every PR pay for an Android runner.
    expect(native).not.toMatch(/\n  push:\n/);
    expect(native).not.toMatch(/\n  pull_request:\n/);
    expect(native).toMatch(/\non:\n  workflow_dispatch:\n/);

    const android = native.split('\n  android:\n')[1]?.split('\n  production-probe:\n')[0] ?? '';
    expect(android).toMatch(/\n    if: github\.event_name == 'workflow_dispatch'\n/);
    expect(android).toContain('assembleDebug');
    expect(android).toContain('testDebugUnitTest');
    expect(android).toContain('lintDebug');
  });

  it('does not run the production probe as a pull-request gate', () => {
    // A probe measures the DEPLOYED build, so gating a diff on it produced a
    // false red (someone else's incident) or a false green ("probe passed").
    expect(health).not.toMatch(/\n  pull_request:\n/);
    expect(health).toMatch(/\n  schedule:\n/);
    expect(health).toMatch(/--self-test/);
    expect(health).toContain('production-health-probe.py');
    // The in-repo probe job survives for manual reproduction of a failure.
    const probe = native.split('\n  production-probe:\n')[1] ?? '';
    expect(probe).toContain('Production probe (maharanitraders.vercel.app)');
    expect(probe).toContain('node scripts/production-probe.mjs');
  });
});
