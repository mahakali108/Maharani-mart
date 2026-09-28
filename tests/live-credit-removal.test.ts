import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allBusinessTools } from '@/lib/ai/tools';

/**
 * LIVE-CREDIT REMOVAL — the regression guard for this phase.
 *
 * Maharani Traders no longer offers retailer credit. Customer credit was
 * removed from the live checkout/account/order flow and replaced by 🪙 coins:
 *
 *   Order Total · Coins Available · Coins Used · Remaining Payable
 *
 * Historical credit data stays in the database, the ledger and the admin
 * reconciliation reports — but no LIVE customer or field surface may render a
 * credit limit, available credit, an outstanding balance or Net-N terms.
 *
 * Comments are stripped before scanning: explaining the removal in a comment is
 * expected, rendering it is not.
 */

const root = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

/** Page/component sources for the customer + field surfaces. */
function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) files.push(...walk(rel));
    else if (/\.tsx?$/.test(entry)) files.push(rel);
  }
  return files;
}

/** Remove `/* … *​/` blocks and `//` lines so only rendered copy is scanned. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const CUSTOMER_SURFACES = ['app/retailer', 'components/retailer', 'app/salesman', 'components/salesman', 'app/staff', 'components/staff'];

/** Copy that only a live credit feature would render. */
const FORBIDDEN_COPY = [
  /Credit limit/i,
  /Available credit/i,
  /Outstanding balance/i,
  /\bNet-15\b/,
  /\bNet-30\b/,
  /pay later/i,
  /Business credit/i,
  /credit facility/i,
  /Credit terms/i,
];

describe('no live credit copy on customer or field surfaces', () => {
  it('renders coins, never a credit limit / available credit / terms', () => {
    const offenders: string[] = [];
    for (const dir of CUSTOMER_SURFACES) {
      for (const file of walk(dir)) {
        // The retired credit card is kept on disk (its rendering is proof of
        // what the old flow said) but is mounted nowhere and marked
        // `@deprecated RETIRED`; the next test proves it stays unmounted.
        if (file.endsWith('components/retailer/credit-summary.tsx')) continue;
        const rendered = stripComments(read(file));
        for (const pattern of FORBIDDEN_COPY) {
          if (pattern.test(rendered)) offenders.push(`${file} → ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the retired credit component is imported by nothing', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components']) {
      for (const file of walk(dir)) {
        if (file.endsWith('components/retailer/credit-summary.tsx')) continue;
        // The admin dashboard has its OWN `CreditSummary` TYPE (the historical
        // reporting shape); only an import of the retired component counts.
        if (/from '@\/components\/retailer\/credit-summary'/.test(read(file))) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
    expect(read('components/retailer/credit-summary.tsx')).toContain('@deprecated RETIRED');
  });

  it('the coin components ARE the customer balance everywhere', () => {
    expect(read('app/retailer/checkout/page.tsx')).toContain('CoinsCheckoutSummary');
    expect(read('components/retailer/home-content.tsx')).toContain('CoinsBalanceCard');
    expect(read('app/retailer/cart/page.tsx')).toContain('CoinsBalanceCard');
    expect(read('app/retailer/account/page.tsx')).toContain('CoinsBalanceCard');
    expect(read('app/retailer/account/ledger/page.tsx')).toContain('WalletLedgerList');
  });

  it('checkout shows exactly the four coin numbers', () => {
    const summary = read('components/retailer/coins-checkout-summary.tsx');
    for (const label of ['Order total', 'Coins available', 'Coins used', 'Remaining payable']) {
      expect(summary, label).toContain(label);
    }
  });
});

describe('order-coin arithmetic is the only balance logic in the order flow', () => {
  it('order placement quotes, debits coins and never consults credit', () => {
    const createOrder = read('lib/orders/create-order.ts');
    expect(createOrder).toContain('debitCoinsForOrder');
    expect(createOrder).not.toMatch(/exceedsLimit|calculateCreditPosition|credit_limit/);
  });

  it('the deprecated credit position is not used by any live order path', () => {
    const offenders: string[] = [];
    for (const file of [...walk('lib'), ...walk('components')]) {
      if (file.endsWith('lib/orders/credit.ts')) continue;
      const source = read(file);
      if (!/calculateCreditPosition/.test(source)) continue;
      // Allowed: internal admin reporting, the Super Admin AI risk report and
      // the retired (unmounted) component. Nothing in the live order path.
      const allowed =
        /admin|ai\/tools\/super-admin|components\/retailer\/credit-summary|components\/command-center\/credit-section/.test(file);
      if (!allowed) offenders.push(file);
    }
    expect(offenders, offenders.join(', ')).toEqual([]);
    // The CUSTOMER ledger module no longer derives a credit position at all.
    expect(read('lib/retailer/ledger.ts')).not.toContain('calculateCreditPosition');
    // The shared order quote — used by checkout, the AI cart and salesman
    // capture — carries only the coin payment now.
    const quote = read('lib/orders/quote-order.ts');
    expect(quote).not.toContain('calculateCreditPosition');
    expect(quote).toContain('coins: CoinPayment');
  });

  it('the AI cart preview and budget planner use coins, not a credit check', () => {
    const cart = read('lib/ai/tools/cart.ts');
    expect(cart).not.toMatch(/exceedsLimit|credit check/i);
    expect(cart).toContain('🪙 Coins used');
    expect(cart).toContain('Payable on delivery');
  });

  it('the coin debit is idempotent and clamped by the balance', () => {
    const coins = read('lib/coins/server.ts');
    expect(coins).toContain('coinDebitKey(orderId)');
    expect(coins).toMatch(/if \(payment\.usedPaise <= 0\)/);
    expect(coins).toContain("rpc('check_and_debit_retailer_wallet'");
  });
});

describe('Maharani AI reports coins, not credit', () => {
  it('exposes coin tools for the retailer and field surfaces', () => {
    const names = new Set(allBusinessTools.map((tool) => tool.name));
    for (const name of ['get_retailer_coins', 'get_coin_balance', 'calculate_order_coin_impact']) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('keeps the legacy credit tool names as coin-backed aliases', () => {
    const names = new Set(allBusinessTools.map((tool) => tool.name));
    for (const name of ['get_credit_summary', 'get_retailer_credit', 'get_available_credit', 'calculate_order_credit_impact']) {
      expect(names.has(name), name).toBe(true);
    }
    const aliases = allBusinessTools.filter((tool) => tool.name.includes('credit') && tool.surfaces?.includes('retailer'));
    for (const tool of aliases) {
      expect(tool.description?.toLowerCase(), tool.name).toContain('deprecated alias');
      expect(tool.description, tool.name).not.toMatch(/available authorized retailer credit/i);
    }
  });

  it('the assistant no longer advertises a credit balance', () => {
    const tools = read('lib/ai/tools/orders.ts');
    expect(tools).toContain('getRetailerCoinPosition');
    expect(tools).toContain("type: 'coins'");
    expect(tools).not.toMatch(/Credit limit', value/);
  });
});

describe('admin keeps historical credit reporting but manages coins', () => {
  it('the admin wallet area is coins-first', () => {
    expect(read('app/admin/wallets/page.tsx')).toContain('🪙 Retailer coins');
    expect(read('app/admin/wallets/[id]/page.tsx')).toContain('Coin ledger (last 100)');
    expect(read('components/admin/wallet-balance-cards.tsx')).toContain('Historical credit mirror');
  });

  it('historical credit reporting is preserved, clearly labelled as historical', () => {
    const dashboard = read('components/admin/dashboard-view.tsx');
    expect(dashboard).toContain('Legacy credit (historical)');
    expect(dashboard).toContain('Read-only historical view');
    // The reporting computation itself is untouched.
    expect(read('lib/admin/dashboard/compute.ts')).toContain('computeCreditSummary');
  });

  it('no historical credit migration or table was deleted or edited', () => {
    const migrations = readdirSync(join(root, 'supabase/migrations'));
    for (const name of ['0029_retailer_wallet_ledger.sql', '0030_wallet_rpc_security.sql', '0031_wallet_outstanding_opening_baseline.sql', '0049_credit_payment_terms.sql']) {
      expect(migrations.includes(name), name).toBe(true);
    }
    const ledger = read('supabase/migrations/0029_retailer_wallet_ledger.sql');
    expect(ledger).toContain('retailer_credit_accounts');
    expect(ledger).toContain('No row is ever deleted');
  });
});

describe('field-team surfaces report coins', () => {
  it('the salesman order builder shows coins used and payable, never credit', () => {
    const builder = read('components/salesman/order-builder.tsx');
    expect(builder).toContain('coinsAvailableRupees');
    expect(builder).toContain('coinsUsedRupees');
    expect(builder).toContain('payableOnDeliveryRupees');
    // Comments may explain the removal; rendered code may not reference credit.
    expect(stripComments(builder)).not.toMatch(/credit|outstanding/i);
  });

  it('the salesman pages read the shop balance from the coin source', () => {
    expect(read('app/salesman/orders/new/page.tsx')).toContain('getRetailerCoinPosition');
    expect(read('app/salesman/retailers/[id]/page.tsx')).toContain('getRetailerCoinPosition');
    // The list aggregates the ledger once per batch instead of per retailer.
    const list = read('app/salesman/retailers/page.tsx');
    expect(list).toContain("from('retailer_wallet_ledger')");
    expect(list).toContain('coinBalancePaise');
  });

  it('admin funding/admin balance wording is coins', () => {
    const limitForm = read('components/admin/wallet-limit-form.tsx');
    expect(limitForm).toContain('Coin funding');
    expect(limitForm).not.toMatch(/Set Credit Limit|Credit Limit \(₹\)/);
    expect(read('lib/admin/wallet-actions.ts')).toMatch(/Coin funding ₹/);
  });
});
