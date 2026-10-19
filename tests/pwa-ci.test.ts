import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The legacy-named workflow also owns web CI and the production health probe.
 * Retiring native automation must not silently remove those release gates. */
describe('web PWA CI', () => {
  const workflow = readFileSync(join(process.cwd(), '.github/workflows/android-apk.yml'), 'utf8');

  it('keeps web/health checks on pushes and PRs while native APK work requires a manual dispatch', () => {
    expect(workflow).toMatch(/\n  push:\n/);
    expect(workflow).toMatch(/\n  pull_request:\n/);

    const web = workflow.split('\n  web:\n')[1]?.split('\n  android:\n')[0] ?? '';
    expect(web).toContain('Web typecheck, lint, tests, and build');
    for (const command of [
      'corepack pnpm run typecheck',
      'corepack pnpm run lint',
      'corepack pnpm test',
      'corepack pnpm run build',
    ]) {
      expect(web).toContain(command);
    }
    expect(web).not.toMatch(/\n    if:/);

    const android = workflow.split('\n  android:\n')[1]?.split('\n  production-probe:\n')[0] ?? '';
    expect(android).toMatch(/\n    if: github\.event_name == 'workflow_dispatch'\n/);
    expect(android).toContain('assembleDebug');

    const probe = workflow.split('\n  production-probe:\n')[1] ?? '';
    expect(probe).toContain('Production probe (maharanitraders.vercel.app)');
    expect(probe).toContain('node scripts/production-probe.mjs');
    expect(probe).not.toMatch(/\n    if:/);
  });
});
