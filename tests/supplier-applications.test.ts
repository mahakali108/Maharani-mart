import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  normalizeSupplierApplication,
  parseSupplierReviewQuery,
  validateSupplierApplication,
} from '@/lib/admin/supplier-application';
import { can } from '@/lib/permissions/permissions';

const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8');
const valid = normalizeSupplierApplication({
  businessName: 'Sharma Wholesale',
  contactName: 'A Sharma',
  phone: '+91 98765 43210',
});

describe('supplier application validation', () => {
  it('accepts a minimal valid application and normalizes phone', () => {
    expect(valid.phone).toBe('9876543210');
    expect(validateSupplierApplication(valid)).toEqual({});
  });
  it('rejects invalid phone, GSTIN, pincode and email', () => {
    const bad = normalizeSupplierApplication({
      businessName: 'X',
      contactName: 'Y',
      phone: '12345',
      email: 'not-an-email',
      pincode: '123',
      gstin: 'FAKEGSTIN123',
    });
    const errors = validateSupplierApplication(bad);
    expect(errors.phone).toBeTruthy();
    expect(errors.email).toBeTruthy();
    expect(errors.pincode).toBeTruthy();
    expect(errors.gstin).toBeTruthy();
  });
  it('accepts a well-formed GSTIN but offers no way to mark it verified', () => {
    const withGstin = normalizeSupplierApplication({
      businessName: 'Sharma Wholesale',
      contactName: 'A Sharma',
      phone: '9876543210',
      gstin: '10abcde1234f1z5',
    });
    expect(withGstin.gstin).toBe('10ABCDE1234F1Z5');
    expect(validateSupplierApplication(withGstin)).toEqual({});
    expect(Object.keys(withGstin)).not.toContain('gstinVerified');
    expect(Object.keys(withGstin)).not.toContain('status');
  });
  it('bounds the review queue query', () => {
    expect(parseSupplierReviewQuery({}).status).toBe('pending');
    expect(parseSupplierReviewQuery({ status: 'approved', page: '9999' })).toEqual({ status: 'approved', page: 200 });
    expect(parseSupplierReviewQuery({ status: 'hax', page: '-2' })).toEqual({ status: 'pending', page: 1 });
  });
});

describe('supplier review permissions (owner decision: Admin + Super Admin)', () => {
  it('review + documents held by admin/super_admin only', () => {
    for (const perm of ['suppliers.review', 'suppliers.documents.manage'] as const) {
      expect(can('super_admin', perm)).toBe(true);
      expect(can('admin', perm)).toBe(true);
      expect(can('staff', perm)).toBe(false);
      expect(can('salesman', perm)).toBe(false);
      expect(can('retailer', perm)).toBe(false);
    }
  });
});

describe('supplier server actions (static guard surface)', () => {
  const src = read('lib/admin/supplier-actions.ts');
  it('every review/document action re-checks permission server-side', () => {
    expect(src).toContain("requirePermission('suppliers.review')");
    expect(src).toContain("requirePermission('suppliers.documents.manage')");
  });
  it('submission writes only through the definer function and never sets status/verification', () => {
    expect(src).toContain("supabase.rpc('submit_supplier_application'");
    expect(src).not.toMatch(/gstin_verified|status:\s*'approved'/);
    expect(src).toContain('23505'); // duplicate pending application handled
    expect(src).toContain('input.website'); // honeypot
  });
  it('rate limiting is durable-first, generic, and non-enumerating', () => {
    expect(src).toContain('createSupplierSubmissionLimiter');
    expect(src).toContain('Too many submissions. Please wait a few minutes and try again.');
    // The rate-limit response must not key its wording to an identity.
    expect(src).not.toContain('Too many submissions from this number');
  });
  it('review only transitions pending rows and stamps the reviewer', () => {
    expect(src).toContain(".eq('status', 'pending')");
    expect(src).toContain('reviewed_by: user.id');
  });
});
