import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

describe('Super Admin compliance dashboard access boundary', () => {
  it('requires an authenticated Super Admin before reading owner-entered readiness details', () => {
    const page = read('app/admin/compliance/page.tsx');
    const navigation = read('components/layout/admin-shell.tsx');

    expect(page).toContain("import { requireUser } from '@/lib/auth/session';");
    expect(page).toContain("if (viewer.role !== 'super_admin')");
    expect(page).toContain("redirect('/unauthorized');");
    expect(page).not.toContain("requirePagePermission('reports.view.all')");
    expect(navigation).toContain("{ label: 'Compliance', href: '/admin/compliance', icon: Scale, roles: ['super_admin'] }");
  });
});
