import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BRAND,
  BRAND_WITH_TRADING_STYLE,
  LEGAL_ISSUER_LINE,
  pageTitle,
} from '@/lib/brand';
import {
  getLegalIssuer,
  statutoryBlock,
  statutoryBlockIsComplete,
} from '@/lib/legal/issuer';
import { buildStandaloneInvoiceHtml } from '@/lib/retailer/invoice-html';
import { getTaxInvoiceReadiness } from '@/lib/retailer/tax-invoice-readiness';

/**
 * BRANDING GUARD.
 *
 * The customer-facing app is "Maha Bazar by Maharani". That is a RENAME OF THE
 * BRAND, not a change of legal entity: the seller and invoice issuer is still
 * Ajay General (proprietorship), trading as Maharani Traders. These tests exist
 * so a future branding edit cannot quietly move the legal identity with it, and
 * so no surface starts claiming an entity, GSTIN or address nobody supplied.
 */

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('brand constants', () => {
  it('names the app "Maha Bazar by Maharani"', () => {
    expect(BRAND.name).toBe('Maha Bazar by Maharani');
    expect(BRAND.shortName).toBe('Maha Bazar');
  });

  it('keeps the legal entity distinct from the brand', () => {
    expect(BRAND.legalName).toBe('Ajay General');
    expect(BRAND.legalForm).toBe('proprietorship');
    expect(BRAND.tradingStyle).toBe('Maharani Traders');
    // "Maharani" is a brand family name, never the legal name.
    expect(BRAND.legalName).not.toBe(BRAND.brandFamily);
    expect(BRAND.legalName).not.toBe(BRAND.name);
  });

  it('states the approved issuer line without inventing a registration', () => {
    expect(LEGAL_ISSUER_LINE).toBe('Ajay General (proprietorship), trading as Maharani Traders');
    // No GSTIN-shaped string anywhere in the constant.
    expect(LEGAL_ISSUER_LINE).not.toMatch(/\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][0-9A-Z]/);
    expect(BRAND_WITH_TRADING_STYLE).toContain('Maha Bazar by Maharani');
    expect(BRAND_WITH_TRADING_STYLE).toContain('Maharani Traders');
  });

  it('builds page titles from the one brand name', () => {
    expect(pageTitle('Sign in')).toBe('Sign in — Maha Bazar by Maharani');
  });

  it('deliberately does NOT carry Maa Kali Enterprises', () => {
    // It is a separate identity; if it ever needs to appear it must be added
    // deliberately with an explicit "separate" statement, not inherited.
    expect(JSON.stringify(BRAND)).not.toMatch(/maa kali/i);
  });
});

describe('legal issuer refuses to publish unverified facts', () => {
  it('reports every missing statutory fact as pending, never as a value', () => {
    const issuer = getLegalIssuer({});
    expect(issuer.gstin.value).toBeNull();
    expect(issuer.registeredAddress.value).toBeNull();
    expect(issuer.supportPhone.value).toBeNull();
    expect(issuer.grievanceOfficer.value).toBeNull();
    expect(statutoryBlockIsComplete(issuer)).toBe(false);
  });

  it('renders a placeholder instruction rather than a fabricated value', () => {
    const block = statutoryBlock(getLegalIssuer({}));
    const gstin = block.find((row) => row.label === 'GSTIN');
    expect(gstin?.value).toContain('to be supplied by the owner');
    expect(gstin?.value).not.toMatch(/\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z][0-9A-Z]/);
  });

  it('treats obvious configuration prompts as absent, not as values', () => {
    for (const prompt of ['TBD', 'TODO', 'n/a', 'owner input required', 'placeholder', 'configure']) {
      const issuer = getLegalIssuer({ COMPANY_GSTIN: prompt });
      expect(issuer.gstin.value, prompt).toBeNull();
    }
  });

  it('accepts real owner-supplied values once provided', () => {
    const issuer = getLegalIssuer({
      COMPANY_GSTIN: '10ABCDE1234F1Z5',
      COMPANY_ADDRESS: 'Verified registered address',
      COMPANY_PHONE: '8987023959',
      COMPANY_GRIEVANCE_OFFICER: 'Appointed officer',
    });
    expect(statutoryBlockIsComplete(issuer)).toBe(true);
  });
});

describe('the invoice issuer is the entity, never the brand alone', () => {
  const configured = {
    COMPANY_NAME: 'Ajay General',
    COMPANY_GSTIN: '10ABCDE1234F1Z5',
    COMPANY_ADDRESS: 'Verified registered address',
    COMPANY_PHONE: '8987023959',
  };

  it('refuses the new app brand as the issuer', () => {
    for (const brandOnly of [BRAND.name, BRAND.shortName, BRAND.tradingStyle, BRAND.brandFamily]) {
      const readiness = getTaxInvoiceReadiness({
        hasMarketplaceSellerLine: false,
        environment: { ...configured, COMPANY_NAME: brandOnly },
      });
      expect(readiness.ready, brandOnly).toBe(false);
      expect(readiness.ready ? null : readiness.reason, brandOnly).toBe('issuer_identity_unapproved');
    }
  });

  it('accepts the approved entity, with or without the brand alongside', () => {
    for (const approved of [BRAND.legalName, 'Ajay General (Proprietor)', `${BRAND.legalName}, trading as ${BRAND.tradingStyle}`]) {
      const readiness = getTaxInvoiceReadiness({
        hasMarketplaceSellerLine: false,
        environment: { ...configured, COMPANY_NAME: approved },
      });
      expect(readiness.ready, approved).toBe(true);
    }
  });
});

describe('customer-facing surfaces use the brand constant', () => {
  it('takes the app name from lib/brand instead of hardcoding it', () => {
    // Metadata, manifest and the shells are the surfaces a user actually sees as
    // the app identity. They must not carry their own copy of the name.
    for (const path of ['app/layout.tsx', 'app/manifest.ts']) {
      const source = read(path);
      expect(source, path).toContain("from '@/lib/brand'");
      expect(source, `${path} still hardcodes the old app name`).not.toContain("'Maharani Traders'");
    }
    const manifest = read('app/manifest.ts');
    expect(manifest).toContain('BRAND.name');
    expect(manifest).toContain('BRAND.shortName');
  });

  it('shows the legal issuer separately from the brand on an invoice', () => {
    const html = read('lib/retailer/invoice-html.ts');
    // The issuer block renders company.name (the entity) and offers the brand
    // alongside it as "Trading as ...".
    expect(html).toContain('data.company.name');
    expect(html).toContain('Trading as');
    expect(html).toContain('brandName');
  });
});

/**
 * REGRESSION: the three names an invoice can mix up.
 *
 *   app name        Maha Bazar by Maharani   -> a product name, never on a tax document as an issuer
 *   trading style   Maharani Traders         -> "Trading as ...", never the issuer
 *   legal issuer    Ajay General             -> the only name that may head a tax invoice
 *
 * Real defect this guards: the download route passed `brandName: BRAND.name`, so
 * every invoice read "Trading as Maha Bazar by Maharani" - asserting to a tax
 * authority that an installable app name is the trade the proprietorship
 * operates under.
 */
describe('invoice identity cannot conflate issuer, trading style and app name', () => {
  const downloadRoute = read('app/retailer/orders/[id]/invoice/download/route.ts');
  const mobileRoute = read('app/api/mobile/v1/orders/[id]/invoice/route.ts');

  it('renders the trading style as "Trading as", never the app name', () => {
    expect(downloadRoute).toContain('brandName: BRAND.tradingStyle');
    expect(downloadRoute, 'the app name must never be the "Trading as" value').not.toMatch(
      /brandName:\s*BRAND\.(name|shortName|brandFamily)\b/,
    );
  });

  it('never prints "Trading as Maha Bazar" on a rendered invoice', () => {
    const html = buildStandaloneInvoiceHtml({
      orderNumber: 'INV-TEST-1',
      placedAt: '2026-11-18T00:00:00Z',
      company: {
        name: 'Ajay General',
        gstin: '10ABCDE1234F1Z5',
        address: 'Verified registered address',
        phone: '8987023959',
      },
      brandName: BRAND.tradingStyle,
      billedTo: { shopName: 'Test Shop', address: 'Test address', areaName: 'Test', gstin: '' },
      lines: [],
      taxMode: 'intra',
      subtotal: 0,
      gstTotal: 0,
      discountTotal: 0,
      grandTotal: 0,
    });
    expect(html).toContain('Trading as Maharani Traders');
    expect(html).not.toContain(`Trading as ${BRAND.name}`);
    expect(html).not.toContain(BRAND.name);
    // The issuer is the entity and is what the document says it was issued by.
    expect(html).toContain('issued by Ajay General');
  });

  it('keeps the app name in its own field on the mobile payload', () => {
    expect(mobileRoute).toContain('biller: issuance.issuer');
    expect(mobileRoute).toContain('tradingStyle: BRAND.tradingStyle');
    expect(mobileRoute).toContain('appName: BRAND.name');
    // A mobile client must not be handed a field that reads like a trade name
    // while holding the app name.
    expect(mobileRoute).not.toMatch(/\bbrand:\s*BRAND\.name/);
  });

  it('never lets the trading style stand alone as the legal issuer', () => {
    // BRAND.tradingStyle must not be accepted where a legal issuer name is
    // required - the invoice block would then name a trading style as the entity.
    for (const tradingStyleOnly of [BRAND.tradingStyle, BRAND.brandFamily]) {
      const readiness = getTaxInvoiceReadiness({
        hasMarketplaceSellerLine: false,
        environment: {
          COMPANY_NAME: tradingStyleOnly,
          COMPANY_GSTIN: '10ABCDE1234F1Z5',
          COMPANY_ADDRESS: 'Verified registered address',
          COMPANY_PHONE: '8987023959',
        },
      });
      expect(readiness.ready, tradingStyleOnly).toBe(false);
      expect(readiness.ready ? null : readiness.reason).toBe('issuer_identity_unapproved');
    }
  });

  it('ships a fail-closed issuer block even when the app name is configured', () => {
    const readiness = getTaxInvoiceReadiness({
      hasMarketplaceSellerLine: false,
      environment: {
        COMPANY_NAME: BRAND.name,
        COMPANY_GSTIN: '10ABCDE1234F1Z5',
        COMPANY_ADDRESS: 'Verified registered address',
        COMPANY_PHONE: '8987023959',
      },
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.ready ? null : readiness.reason).toBe('issuer_identity_unapproved');
  });
});

describe('brand identity is never the legal counterparty', () => {
  it('reports the legal entity, not the app name, as the support counterparty', () => {
    const route = read('app/api/mobile/v1/help/route.ts');
    expect(route).toContain('BRAND.legalName');
    expect(route).toContain('appName');
  });

  it('never presents Maa Kali Enterprises as the seller, issuer or owner', () => {
    const surfaces = [
      'content/site-pages.seed.json',
      'lib/brand.ts',
      'lib/legal/issuer.ts',
      'app/manifest.ts',
      'app/layout.tsx',
    ];
    for (const path of surfaces) {
      const source = read(path);
      if (!/maa kali/i.test(source)) continue;
      expect(source, path).not.toMatch(
        /Maa Kali[^.]{0,80}(seller of record|invoice issuer|GST registrant|owns|operates|is the legal)/i,
      );
    }
  });

  it('does not introduce an Android APK/AAB or Flutter surface', () => {
    // Explicitly out of scope for this change.
    const pkg = JSON.parse(read('package.json')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['@capacitor/core', '@capacitor/android', 'react-native']) {
      expect(all, banned).not.toHaveProperty(banned);
    }
  });
});
