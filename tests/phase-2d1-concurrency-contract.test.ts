import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const migration = readFileSync(join(root, 'supabase/migrations/0087_phase_2d1_compliance_security_and_evidence_storage.sql'), 'utf8');

describe('Phase 2D.1 suspension/publication concurrency contract', () => {
  it('takes a conflicting seller-row share lock before an offer can become saleable', () => {
    const guard = migration.slice(
      migration.indexOf('create or replace function public.enforce_seller_offer_compliance()'),
      migration.indexOf('-- The prior Phase 2D trigger was UPDATE-only')
    );
    expect(guard).toContain('if not v_requires_eligibility then');
    expect(guard).toContain('from public.sellers s where s.id = new.seller_id for share;');
    expect(guard).toContain('from public.products p where p.id = new.product_id for share;');
    // the comment is wrapped across lines in the migration; match it unwrapped
    expect(guard.replace(/\n\s*--\s?/g, ' ').replace(/\s+/g, ' ')).toContain('A seller suspension takes a conflicting row lock');
  });

  it('serializes approval-revision stamping with later fact changes so invalidation audit ordering is deterministic', () => {
    expect(migration).toContain('from public.products p where p.id = new.product_id for share;');
    expect(migration).toContain('from public.sellers s where s.id = new.seller_id for share;');
    expect(migration).toContain('audit_product_compliance_revision_invalidation');
    expect(migration).toContain('audit_seller_compliance_revision_invalidation');
  });
});

// A two-real-connection PostgreSQL test is deliberately not emulated here.
// PGlite's single connection cannot prove lock interleaving. Run the following
// scenario only in an isolated disposable PostgreSQL database: hold a seller
// offer publication after its BEFORE trigger acquires FOR SHARE, concurrently
// suspend the seller, then assert exactly one serial order wins and no active
// offer remains after the suspension commits.
