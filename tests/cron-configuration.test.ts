import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/**
 * Cron configuration contract.
 *
 * The AI-only retention engine (migration 0084) is destructive and
 * irreversible. It must never be armed by a normal deploy of application code:
 * arming it is a separate, explicitly approved change that may only happen after
 * the migration is applied, one authorised dry run has been reviewed, and the
 * owner has signed off in writing.
 *
 * The general 90/120-day cleanup schedule (/api/cron/cleanup) predates this work
 * and must remain byte-identical: same path, same schedule, single entry.
 */

interface VercelCron {
  path: string;
  schedule: string;
}

function readVercelConfig(): { crons: VercelCron[] } {
  return JSON.parse(readFileSync('vercel.json', 'utf8')) as { crons: VercelCron[] };
}

describe('vercel.json cron schedule', () => {
  it('registers the pre-existing general cleanup schedule unchanged', () => {
    const { crons } = readVercelConfig();
    const general = crons.filter((cron) => cron.path === '/api/cron/cleanup');
    expect(general).toHaveLength(1);
    expect(general[0]!.schedule).toBe('0 2 * * *');
  });

  it('does NOT schedule the AI cleanup — arming it requires a separate approved change', () => {
    const { crons } = readVercelConfig();
    expect(crons.some((cron) => cron.path === '/api/cron/ai-cleanup')).toBe(false);
  });

  it('contains exactly one scheduled cron entry in total', () => {
    const { crons } = readVercelConfig();
    expect(crons).toHaveLength(1);
    expect(crons.map((cron) => cron.path)).toEqual(['/api/cron/cleanup']);
  });

  it('schedules no path that could delete AI data', () => {
    const { crons } = readVercelConfig();
    for (const cron of crons) {
      expect(cron.path).not.toMatch(/ai-cleanup|ai_cleanup|retention-ai/i);
    }
  });
});

describe('AI cleanup route exists but is inert until explicitly armed', () => {
  const route = readFileSync('app/api/cron/ai-cleanup/route.ts', 'utf8');

  it('documents that this PR deliberately does not schedule it', () => {
    expect(route).toContain('NOT SCHEDULED BY THIS PR');
    expect(route).toContain('SEPARATE, explicitly');
    expect(route).toContain('written sign-off');
  });

  it('still fails closed when CRON_SECRET is absent', () => {
    expect(route).toContain('if (!process.env.CRON_SECRET)');
    expect(route).toContain('{ status: 503 }');
    expect(route).toContain('CRON_SECRET is not configured.');
  });

  it('still rejects an unauthenticated caller with 401', () => {
    expect(route).toContain('secretMatches');
    expect(route).toContain('{ status: 401 }');
    expect(route).toContain('timingSafeEqual');
  });

  it('still calls only the AI-only cleanup function', () => {
    expect(route).toContain("rpc('run_ai_data_cleanup'");
    expect(route).not.toContain("rpc('run_data_cleanup'");
  });

  it('still supports an explicit dry run and never forces a live delete', () => {
    expect(route).toContain("searchParams.get('dry_run') === '1'");
    expect(route).toContain('p_dry_run: dryRun');
  });
});

describe('general cleanup route is untouched by this change', () => {
  const route = readFileSync('app/api/cron/cleanup/route.ts', 'utf8');

  it('keeps its authentication and its single engine call', () => {
    expect(route).toContain('if (!process.env.CRON_SECRET)');
    expect(route).toContain('timingSafeEqual');
    expect(route).toContain("rpc('run_data_cleanup'");
    expect(route).not.toContain('run_ai_data_cleanup');
  });

  it('still sweeps only the explicitly temporary storage buckets', () => {
    expect(route).toContain('sweepTemporaryStorage');
  });
});
