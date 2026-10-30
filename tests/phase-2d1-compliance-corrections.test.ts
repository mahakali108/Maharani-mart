import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const migration = readFileSync(join(root, 'supabase/migrations/0087_phase_2d1_compliance_security_and_evidence_storage.sql'), 'utf8');
const phase2d = readFileSync(join(root, 'supabase/migrations/0086_catalog_seller_compliance_enforcement.sql'), 'utf8');
const evidenceStorage = readFileSync(join(root, 'lib/compliance/evidence-storage.ts'), 'utf8');

describe('Phase 2D.1 critical compliance corrections', () => {
  it('allows seller suspension/takedown to deactivate an offer while requiring eligibility for creation and publication', () => {
    expect(migration).toContain("v_requires_eligibility boolean := tg_op = 'INSERT'");
    expect(migration).toContain("not (old.is_active and old.moderation_status = 'approved')");
    expect(migration).toContain('if not v_requires_eligibility then');
    expect(migration).toContain('for share;');
    expect(migration).toContain("before insert or update on public.sellers");
  });

  it('uses reviewed product/seller revisions and fingerprints rather than relying on deactivation', () => {
    expect(migration).toContain("add column if not exists compliance_revision bigint not null default 1");
    expect(migration).toContain('approved_product_revision = p.compliance_revision');
    expect(migration).toContain('approved_seller_revision = s.compliance_revision');
    expect(migration).toContain('product_compliance_review_fingerprint');
    expect(migration).toContain('seller_compliance_review_fingerprint');
    expect(migration).toContain("'invalidated'");
    expect(migration).toContain('bump_product_revision_from_pack_change');
  });

  it('requires an explicit product-level non-food regulatory classification', () => {
    expect(migration).toContain("('cosmetics', 'non_food_fmcg', 'food_blocked', 'unclassified')");
    expect(migration).toContain("p.regulatory_classification = 'non_food_fmcg'");
    expect(migration).not.toContain("lower(btrim(new.name)) ~");
    expect(migration).toContain('Existing rows remain `unclassified`');
  });

  it('explicitly hardens all internal Security Definer helper classes and preserves only declared authenticated RPCs', () => {
    expect(migration).toContain('revoke all on function public.product_compliance_has_evidence(uuid, text)');
    expect(migration).toContain('public.seller_compliance_has_evidence(uuid, text)');
    expect(migration).toContain('from public, anon, authenticated, service_role;');
    expect(migration).toContain('grant execute on function public.product_is_sale_eligible(uuid)');
    expect(migration).toContain('public.can_read_compliance_evidence_object(text)');
  });

  it('provides one private canonical evidence bucket, object policies, server validation, and authorized short-lived URLs', () => {
    expect(migration).toContain("'compliance-evidence', 'compliance-evidence', false, 10485760");
    expect(migration).toContain('create policy "compliance_evidence_read" on storage.objects');
    expect(migration).toContain('create policy "compliance_evidence_write" on storage.objects');
    expect(migration).toContain('No delete policy is intentionally created');
    expect(evidenceStorage).toContain("COMPLIANCE_EVIDENCE_BUCKET_ID = 'compliance-evidence'");
    expect(evidenceStorage).toContain('validateComplianceEvidenceUpload');
    expect(evidenceStorage).toContain('uploadComplianceEvidenceObject');
    expect(evidenceStorage).toContain('createComplianceEvidenceSignedUrl');
    expect(evidenceStorage).toContain('COMPLIANCE_EVIDENCE_SIGNED_URL_TTL_SECONDS = 300');
  });

  it('keeps the final compliance order guard insert-only so historical fulfilment updates remain untouched', () => {
    expect(phase2d).toContain('before insert on public.order_items');
    expect(phase2d).not.toContain('before insert or update on public.order_items\nfor each row execute function public.enforce_order_item_compliance');
  });
});
