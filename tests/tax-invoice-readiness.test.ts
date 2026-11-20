import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTaxInvoiceReadiness } from '@/lib/retailer/tax-invoice-readiness';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

const configuredEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  COMPANY_NAME: 'Ajay General',
  COMPANY_GSTIN: '10ABCDE1234F1Z5',
  COMPANY_ADDRESS: 'Verified principal place of business',
  COMPANY_PHONE: '9876543210',
};

describe('tax-invoice publication guard', () => {
  it('permits an own-stock tax invoice only with complete, syntactically valid issuer details', () => {
    expect(getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: false,
      environment: configuredEnvironment,
    })).toEqual({
      ready: true,
      issuer: {
        name: 'Ajay General',
        gstin: '10ABCDE1234F1Z5',
        address: 'Verified principal place of business',
        phone: '9876543210',
      },
    });
  });

  it('blocks incomplete or placeholder issuer configuration instead of emitting a configure prompt as a tax invoice', () => {
    const readiness = getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: false,
      environment: { ...configuredEnvironment, COMPANY_ADDRESS: 'Configure COMPANY_ADDRESS in environment variables' },
    });
    expect(readiness).toMatchObject({ ready: false, reason: 'issuer_details_missing' });
  });

  it('blocks an invalid GSTIN rather than using it for invoice tax classification', () => {
    const readiness = getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: false,
      environment: { ...configuredEnvironment, COMPANY_GSTIN: 'not-a-gstin' },
    });
    expect(readiness).toMatchObject({ ready: false, reason: 'issuer_gstin_invalid' });
  });

  it('blocks marketplace seller orders until the seller-of-record and invoice-issuer model has CA approval', () => {
    const readiness = getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: true,
      environment: configuredEnvironment,
    });
    expect(readiness).toMatchObject({ ready: false, reason: 'marketplace_issuer_model_pending' });
  });

  it('uses the same guard for web, downloadable, and mobile invoice paths', () => {
    for (const path of [
      'app/retailer/orders/[id]/invoice/page.tsx',
      'app/retailer/orders/[id]/invoice/download/route.ts',
      'app/api/mobile/v1/orders/[id]/invoice/route.ts',
    ]) {
      const source = read(path);
      expect(source).toContain("getTaxInvoiceReadiness");
      expect(source).toContain("source_type");
      expect(source).toContain("hasMarketplaceSellerLine");
    }
  });
});

describe('issuer identity must be the proprietorship, not the brand', () => {
  it('refuses a tax invoice issued under the brand name alone', () => {
    // The owner confirmed the AJAY GENERAL proprietorship is the invoice issuer
    // and MAHARANI TRADERS is the brand it trades under. A brand is not a legal
    // entity, so it cannot appear on a tax document by itself.
    for (const brandOnly of ['Maharani Traders', 'Maha Bazar by Maharani', 'MAHARANI']) {
      const readiness = getTaxInvoiceReadiness({
        hasMarketplaceSellerLine: false,
        environment: { ...configuredEnvironment, COMPANY_NAME: brandOnly },
      });
      expect(readiness.ready, brandOnly).toBe(false);
      expect(readiness.ready ? null : readiness.reason, brandOnly).toBe('issuer_identity_unapproved');
    }
  });

  it('accepts the proprietorship, with or without the brand alongside it', () => {
    for (const approved of ['Ajay General', 'AJAY GENERAL (Proprietor)', 'Ajay General, trading as Maharani Traders']) {
      const readiness = getTaxInvoiceReadiness({
        hasMarketplaceSellerLine: false,
        environment: { ...configuredEnvironment, COMPANY_NAME: approved },
      });
      expect(readiness.ready, approved).toBe(true);
    }
  });

  it('never invents an issuer identity when none is configured', () => {
    const readiness = getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: false,
      environment: { ...configuredEnvironment, COMPANY_NAME: '', COMPANY_GSTIN: '' },
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.ready ? null : readiness.reason).toBe('issuer_details_missing');
  });
});
