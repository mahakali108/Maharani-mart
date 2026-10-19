// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServiceAreaSelect } from '@/components/areas/service-area-select';
import { CatalogueNav } from '@/components/retailer/catalogue-nav';
import { CommerceSteps } from '@/components/retailer/commerce-steps';
import { MobileBottomNav } from '@/components/layout/mobile-bottom-nav';
import { LayoutGrid } from 'lucide-react';
const routing = vi.hoisted(() => ({ path: '/retailer/brands' }));
vi.mock('next/navigation', () => ({ usePathname: () => routing.path }));
afterEach(cleanup);
const areas = [
  { id: 'saran', name: 'Market', district: 'Saran', is_active: true },
  { id: 'patna', name: 'Market', district: 'Patna', is_active: true },
  { id: 'legacy', name: 'Old Market', district: 'Khagaria', is_active: false },
];

describe('district registration/edit selector', () => {
  it('never assigns the first area/default district without user selection', () => {
    render(<form><ServiceAreaSelect areas={areas} /></form>);
    expect((screen.getByLabelText('Service area') as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('option', { name: 'Market — Saran' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Market — Patna' })).toBeTruthy();
  });
  it('filters by district and clears stale area selection before save', async () => {
    render(<form data-testid="form"><ServiceAreaSelect areas={areas} currentAreaId="saran" /></form>);
    const user = userEvent.setup();
    expect((screen.getByLabelText('Service district') as HTMLSelectElement).value).toBe('Saran'); // Existing assignment survives the new default.
    await user.selectOptions(screen.getByLabelText('Service district'), 'Patna');
    expect((screen.getByLabelText('Service area') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('option', { name: 'Market — Saran' })).toBeNull();
    await user.selectOptions(screen.getByLabelText('Service area'), 'patna');
    const form = new FormData(screen.getByTestId('form') as HTMLFormElement);
    expect(form.get('areaId')).toBe('patna');
    expect(form.has('district')).toBe(false); // The persisted FK determines geography.
  });
  it('reloads the saved assignment instead of applying the Saran default', () => {
    render(<ServiceAreaSelect areas={areas} currentAreaId="patna" />);
    expect((screen.getByLabelText('Service district') as HTMLSelectElement).value).toBe('Patna');
    expect((screen.getByLabelText('Service area') as HTMLSelectElement).value).toBe('patna');
  });
  it('preserves but disables an inactive legacy assignment until explicitly changed', () => {
    render(<ServiceAreaSelect areas={areas} currentAreaId="legacy" />);
    expect((screen.getByLabelText('Service area') as HTMLSelectElement).value).toBe('legacy');
    expect((screen.getByRole('option', { name: 'Old Market — Khagaria (inactive)' }) as HTMLOptionElement).disabled).toBe(true);
  });
  it('handles an empty directory and exposes validation errors', () => {
    render(<ServiceAreaSelect areas={[]} error="Choose a verified area" />);
    expect(screen.getByRole('option', { name: 'No areas configured yet' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Choose a verified area');
    expect(screen.getByLabelText('Service area').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('shopping navigation', () => {
  it.each(['products', 'categories', 'brands'] as const)('keeps both directories reachable from %s', (active) => {
    render(<CatalogueNav active={active} />);
    expect(screen.getByRole('link', { name: 'Products' }).getAttribute('href')).toBe('/retailer/catalog');
    expect(screen.getByRole('link', { name: 'Categories' }).getAttribute('href')).toBe('/retailer/categories');
    expect(screen.getByRole('link', { name: 'Brands' }).getAttribute('href')).toBe('/retailer/brands');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });
  it.each(['/retailer/brands', '/retailer/categories/123'])('marks Catalogue active on %s', (path) => {
    routing.path = path;
    render(<MobileBottomNav marketplace navItems={[{ label: 'Catalogue', href: '/retailer/catalog', icon: LayoutGrid }]} />);
    expect(screen.getByRole('link', { name: 'Catalogue' }).getAttribute('aria-current')).toBe('page');
  });
  it.each([1, 2, 3] as const)('announces only the current checkout step %s', (current) => {
    render(<CommerceSteps current={current} />);
    expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });
});
