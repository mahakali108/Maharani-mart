import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('Membership Pages Read Failure Guarding', () => {
  it('Admin membership page guards against failed reads with ReadFailureNotice', () => {
    const content = readFileSync('app/admin/membership/page.tsx', 'utf8');
    expect(content).toContain('ReadFailureNotice');
    expect(content).toContain('readFailed');
    expect(content).toContain('readFailureMessage');
  });

  it('Retailer membership page guards against failed reads with ReadFailureNotice', () => {
    const content = readFileSync('app/retailer/membership/page.tsx', 'utf8');
    expect(content).toContain('ReadFailureNotice');
    expect(content).toContain('readFailed');
    expect(content).toContain('readFailureMessage');
  });
});
