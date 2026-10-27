import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Read-failure guarding on the two screens that replaced the retired paid
 * membership UI (migration 0083):
 *   - /retailer/membership  → pricing category + retained loyalty points
 *   - /admin/retailer-applications → the approval queue (the old admin
 *     /admin/membership screen is gone)
 */
describe('Retailer category / approvals read failure guarding', () => {
  it('retailer category page guards against failed reads with ReadFailureNotice', () => {
    const content = readFileSync('app/retailer/membership/page.tsx', 'utf8');
    expect(content).toContain('ReadFailureNotice');
    expect(content).toContain('readFailureMessage');
    // No purchase, renewal or fee language may survive on this screen (the
    // module comment explaining the retirement is excluded from the check).
    const visible = content.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(visible).not.toMatch(/₹\s*\d/);
    expect(visible).not.toMatch(/upgrade|renew|subscription fee|price_paise/i);
  });

  it('admin approval queue guards against failed reads with ReadFailureNotice', () => {
    const content = readFileSync('app/admin/retailer-applications/page.tsx', 'utf8');
    expect(content).toContain('ReadFailureNotice');
    expect(content).toContain('readFailed');
    expect(content).toContain('readFailure');
  });

  it('the admin membership screen no longer exists', () => {
    expect(existsSync('app/admin/membership/page.tsx')).toBe(false);
  });
});
