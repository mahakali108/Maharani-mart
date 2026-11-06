import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminShell } from '@/components/layout/admin-shell';
import { StaffShell } from '@/components/layout/staff-shell';
import { SalesmanShell } from '@/components/layout/salesman-shell';
import { RetailerShell } from '@/components/layout/retailer-shell';
import SellerPortalLayout from '@/app/seller/layout';

vi.mock('next/navigation', () => ({ usePathname: () => '/retailer/home', useRouter: () => ({}) }));
vi.mock('@/lib/auth/actions', () => ({ logoutAction: '/login' }));
vi.mock('@/lib/seller/guard', () => ({
  requireSellerPage: vi.fn().mockResolvedValue({ seller: { business_name: 'Fixture seller', status: 'active', gstin: null } }),
}));
vi.mock('@/components/layout/sidebar', () => ({ Sidebar: () => null }));
vi.mock('@/components/layout/topbar', () => ({ Topbar: () => null }));
vi.mock('@/components/retailer/search-field', () => ({ SearchField: () => null }));

const paths = ['/legal/terms', '/legal/privacy', '/legal/shipping', '/legal/returns', '/legal/grievance', '/legal/product-safety', '/legal/business-disclosure'];

function expectPolicyFooter(html: string) {
  const footer = html.match(/<footer\b[\s\S]*?<\/footer>/)?.[0];
  expect(footer).toBeDefined();
  for (const href of paths) expect(footer).toContain(`href="${href}"`);
  expect(footer).toContain('flex-wrap');
}

describe('policy links in role-specific shells', () => {
  it('renders all seven links in the admin footer', () => {
    expectPolicyFooter(renderToStaticMarkup(<AdminShell fullName="Fixture" role="admin">Content</AdminShell>));
  });
  it('renders all seven links in the staff footer', () => {
    expectPolicyFooter(renderToStaticMarkup(<StaffShell fullName="Fixture" role="staff">Content</StaffShell>));
  });
  it('renders all seven links in the salesman footer', () => {
    expectPolicyFooter(renderToStaticMarkup(<SalesmanShell fullName="Fixture" role="salesman">Content</SalesmanShell>));
  });
  it('renders all seven links in the retailer footer', () => {
    expectPolicyFooter(renderToStaticMarkup(<RetailerShell fullName="Fixture" role="retailer">Content</RetailerShell>));
  });
  it('renders all seven links in the seller footer without removing seller navigation', async () => {
    const html = renderToStaticMarkup(await SellerPortalLayout({ children: 'Content' }));
    expectPolicyFooter(html);
    for (const href of ['/seller/dashboard', '/seller/offers', '/seller/orders', '/seller/profile']) expect(html).toContain(`href="${href}"`);
  });
});
