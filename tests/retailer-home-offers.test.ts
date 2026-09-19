import { describe, expect, it } from 'vitest';
import { loadRetailerHome } from '@/lib/retailer/home-data';
import { supabaseFixture } from './helpers/supabase-fixture';
import { AREA, PRODUCT, RETAILER } from './fixtures/retailer-home';

const ACTIVE = '10000000-0000-4000-8000-000000000001';
const UPCOMING = '10000000-0000-4000-8000-000000000002';
const EXPIRED = '10000000-0000-4000-8000-000000000003';
const INACTIVE = '10000000-0000-4000-8000-000000000004';

function schemesTables() {
  return {
    products: [],
    categories: [],
    brands: [],
    banners: [],
    orders: [],
    cart_items: [],
    retailer_favorites: [],
    schemes: [
      { id: ACTIVE, name: 'Diwali scheme', description: 'Festival pricing', is_festival: true, is_active: true, starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' },
      { id: UPCOMING, name: 'Coming up', description: null, is_festival: false, is_active: true, starts_at: '2027-06-01T00:00:00Z', ends_at: '2027-12-01T00:00:00Z' },
      { id: EXPIRED, name: 'Old offer', description: null, is_festival: false, is_active: true, starts_at: '2020-01-01T00:00:00Z', ends_at: '2021-01-01T00:00:00Z' },
      { id: INACTIVE, name: 'Switched off', description: null, is_festival: false, is_active: false, starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' },
    ],
  };
}

describe('retailer home offers section data', () => {
  it('loads only active schemes inside their validity window', async () => {
    const home = await loadRetailerHome(supabaseFixture(schemesTables()) as never, RETAILER, AREA);

    expect(home.schemes).toEqual([
      { id: ACTIVE, name: 'Diwali scheme', description: 'Festival pricing', is_festival: true, starts_at: '2026-01-01T00:00:00Z', ends_at: '2027-01-01T00:00:00Z' },
    ]);
    expect(home.errors.schemes).toBe(false);
  });

  it('exposes an empty offers list when no scheme is live', async () => {
    const tables = schemesTables();
    tables.schemes = [];
    const home = await loadRetailerHome(supabaseFixture(tables) as never, RETAILER, AREA);

    expect(home.schemes).toEqual([]);
    expect(home.errors.schemes).toBe(false);
  });

  it('flags a failed scheme read without breaking the rest of the home', async () => {
    const home = await loadRetailerHome(
      supabaseFixture(schemesTables(), { schemes: 'offline' }) as never,
      RETAILER,
      AREA
    );

    expect(home.schemes).toEqual([]);
    expect(home.errors.schemes).toBe(true);
    // Everything else still loads.
    expect(home.errors.catalog).toBe(false);
  });

  it('keeps working when the catalog is empty (fresh store)', async () => {
    const home = await loadRetailerHome(supabaseFixture() as never, RETAILER, AREA);
    expect(home.schemes).toEqual([]);
    expect(home.products).toEqual([]);
    expect(home.errors).toEqual({
      catalog: false, categories: false, brands: false, banners: false,
      history: false, pricing: false, schemes: false,
    });
  });
});
