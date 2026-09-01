import 'server-only';

import { z } from 'zod';
import type { AICard, AIToolContext, AIToolDefinition, AIToolResult } from '@/lib/ai/types';
import { sanitizeSearchTerm } from '@/lib/retailer/catalog-params';
import { getProductPriceOverrides, resolvePackPrice } from '@/lib/retailer/effective-price';
import { clampLimit, clampPage, dbFailure, inr, unavailable, verified } from '@/lib/ai/tools/helpers';

const pageFields = { page: z.number().int().min(1).max(100).optional(), limit: z.number().int().min(1).max(30).optional() };
const productListSchema = z.object({
  query: z.string().trim().max(80).optional(),
  categoryId: z.string().uuid().optional(),
  categoryName: z.string().trim().max(80).optional(),
  brandId: z.string().uuid().optional(),
  brandName: z.string().trim().max(80).optional(),
  barcode: z.string().trim().max(80).regex(/^[A-Za-z0-9-]+$/).optional(),
  minPrice: z.number().nonnegative().max(10_000_000).optional(),
  maxPrice: z.number().nonnegative().max(10_000_000).optional(),
  inStockOnly: z.boolean().optional(),
  ...pageFields,
});

interface ProductRow {
  id: string;
  name: string;
  sku_code: string | null;
  category_id: string | null;
  gst_percent: number;
  is_new_launch: boolean;
  created_at: string;
  brands: { name: string } | null;
  categories: { name: string } | null;
  product_images: { image_url: string; sort_order: number }[];
  product_packs: { id: string; pack_name: string; ptr: number | null; base_price: number; case_price: number; mrp: number | null; moq: number; is_active: boolean; sort_order: number }[];
}

interface ProductResult {
  id: string;
  name: string;
  skuCode: string | null;
  brand: string | null;
  category: string | null;
  gstPercent: number;
  isNewArrival: boolean;
  packId: string | null;
  packName: string | null;
  price: number | null;
  mrp: number | null;
  moq: number | null;
  stockStatus: string | null;
  availableQuantity: number | null;
  imageUrl: string | null;
}

async function areaForActor(context: AIToolContext): Promise<string | null> {
  if (context.actor.role !== 'retailer') return null;
  const { data } = await context.supabase.from('retailers').select('area_id').eq('id', context.actor.id).maybeSingle<{ area_id: string }>();
  return data?.area_id ?? null;
}

async function stockForProducts(context: AIToolContext, ids: string[]) {
  const map = new Map<string, { status: string; available: number }>();
  if (ids.length === 0) return map;
  if (context.actor.role === 'retailer') {
    const { data, error } = await context.supabase.rpc('get_retailer_product_availability' as never, { p_product_ids: ids } as never);
    if (error) return map;
    for (const row of (data ?? []) as unknown as { product_id: string; available_quantity: number; stock_status: string }[]) {
      map.set(row.product_id, { status: row.stock_status, available: Number(row.available_quantity) });
    }
  } else {
    const { data } = await context.supabase.from('inventory_product_totals').select('product_id, available_quantity, stock_status').in('product_id', ids);
    for (const row of (data ?? []) as { product_id: string; available_quantity: number; stock_status: string }[]) {
      map.set(row.product_id, { status: row.stock_status, available: row.available_quantity });
    }
  }
  return map;
}

async function mapProducts(context: AIToolContext, rows: ProductRow[]): Promise<ProductResult[]> {
  const ids = rows.map((row) => row.id);
  const [areaId, stock] = await Promise.all([areaForActor(context), stockForProducts(context, ids)]);
  const overrides = context.actor.role === 'retailer'
    ? await getProductPriceOverrides(context.supabase, ids, context.actor.id, areaId)
    : new Map<string, number | null>();

  return rows.map((row) => {
    const pack = [...row.product_packs].filter((item) => item.is_active).sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
    const price = pack ? resolvePackPrice(pack, overrides.get(row.id) ?? null) : null;
    const stockRow = stock.get(row.id);
    return {
      id: row.id,
      name: row.name,
      skuCode: row.sku_code,
      brand: row.brands?.name ?? null,
      category: row.categories?.name ?? null,
      gstPercent: row.gst_percent,
      isNewArrival: row.is_new_launch,
      packId: pack?.id ?? null,
      packName: pack?.pack_name ?? null,
      price,
      mrp: pack?.mrp ?? null,
      moq: pack?.moq ?? null,
      stockStatus: stockRow?.status ?? null,
      availableQuantity: stockRow?.available ?? null,
      imageUrl: [...row.product_images].sort((a, b) => a.sort_order - b.sort_order)[0]?.image_url ?? null,
    };
  });
}

function productCards(products: ProductResult[], context: AIToolContext): AICard[] {
  return products.slice(0, 12).map((product) => ({
    type: 'product',
    id: product.id,
    title: product.name,
    subtitle: [product.brand, product.packName, product.skuCode].filter(Boolean).join(' · '),
    badge: product.stockStatus ? product.stockStatus.replaceAll('_', ' ') : undefined,
    imageUrl: product.imageUrl ?? undefined,
    quality: 'verified',
    source: 'Current catalog, effective pricing and authorized stock availability',
    metrics: [
      { label: 'Price', value: inr(product.price), quality: product.price === null ? 'unavailable' : 'verified' },
      { label: 'MOQ', value: product.moq === null ? 'Not available' : String(product.moq), quality: product.moq === null ? 'unavailable' : 'verified' },
      { label: 'GST', value: `${product.gstPercent}%`, quality: 'verified' },
    ],
    actions: context.actor.surface === 'retailer'
      ? [{ type: 'link', label: 'View product', href: `/retailer/catalog/${product.id}`, tone: 'primary' }]
      : context.actor.surface === 'admin'
        ? [{ type: 'link', label: 'View product', href: `/admin/products/${product.id}`, tone: 'primary' }]
        : context.actor.surface === 'staff'
          ? [{ type: 'link', label: 'Open inventory', href: '/staff/inventory', tone: 'secondary' }]
          : undefined,
  }));
}

async function searchProducts(input: z.infer<typeof productListSchema>, context: AIToolContext): Promise<AIToolResult> {
  const page = clampPage(input.page);
  const limit = clampLimit(input.limit);
  const q = input.query ? sanitizeSearchTerm(input.query) : '';
  let categoryId = input.categoryId;
  if (!categoryId && input.categoryName) {
    const { data } = await context.supabase.from('categories').select('id').ilike('name', `%${sanitizeSearchTerm(input.categoryName)}%`).eq('is_active', true).limit(1).maybeSingle<{ id: string }>();
    categoryId = data?.id;
    if (!categoryId) return verified({ products: [], page, hasMore: false }, [], 'No matching active category');
  }

  let brandId = input.brandId;
  if (!brandId && input.brandName) {
    const { data } = await context.supabase.from('brands').select('id').ilike('name', `%${sanitizeSearchTerm(input.brandName)}%`).eq('is_active', true).limit(1).maybeSingle<{ id: string }>();
    brandId = data?.id;
    if (!brandId) return verified({ products: [], page, hasMore: false }, [], 'No matching active brand');
  }

  let query = context.supabase
    .from('products')
    .select('id, name, sku_code, category_id, gst_percent, is_new_launch, created_at, brands ( name ), categories ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, case_price, mrp, moq, is_active, sort_order )')
    .eq('is_active', true);
  if (q) query = query.or(`name.ilike.%${q}%,sku_code.ilike.%${q}%,barcode.ilike.%${q}%`);
  if (input.barcode) query = query.eq('barcode', input.barcode);
  if (categoryId) query = query.eq('category_id', categoryId);
  if (brandId) query = query.eq('brand_id', brandId);
  const { data, error } = await query.order('created_at', { ascending: false }).range((page - 1) * limit, page * limit + 29).returns<ProductRow[]>();
  if (error) return dbFailure();
  let products = await mapProducts(context, data ?? []);
  if (input.minPrice !== undefined) products = products.filter((p) => p.price !== null && p.price >= input.minPrice!);
  if (input.maxPrice !== undefined) products = products.filter((p) => p.price !== null && p.price <= input.maxPrice!);
  if (input.inStockOnly) products = products.filter((p) => p.stockStatus === 'in_stock' || p.stockStatus === 'low_stock');
  products = products.slice(0, limit);
  return verified({ products, page, hasMore: (data?.length ?? 0) > products.length }, productCards(products, context));
}

const productIdSchema = z.object({ productId: z.string().uuid() });

export const productTools: AIToolDefinition[] = [
  {
    name: 'search_products', description: 'Search active products by natural-language keywords and secure filters. Prices are retailer-specific when applicable.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: productListSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, categoryId: { type: 'string', format: 'uuid' }, categoryName: { type: 'string' }, brandId: { type: 'string', format: 'uuid' }, brandName: { type: 'string' }, barcode: { type: 'string' }, minPrice: { type: 'number', minimum: 0 }, maxPrice: { type: 'number', minimum: 0 }, inStockOnly: { type: 'boolean' }, page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 30 } } },
    execute: searchProducts,
  },
  {
    name: 'get_product_details', description: 'Get verified catalog, pack, price, GST and authorized availability details for one product.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: productIdSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string', format: 'uuid' } } },
    execute: async ({ productId }, context) => {
      const { data, error } = await context.supabase.from('products').select('id, name, sku_code, category_id, gst_percent, is_new_launch, created_at, brands ( name ), categories ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, case_price, mrp, moq, is_active, sort_order )').eq('id', productId).eq('is_active', true).maybeSingle<ProductRow>();
      if (error) return dbFailure();
      if (!data) return unavailable('That product is not available in the current authorized catalog.');
      const products = await mapProducts(context, [data]);
      return verified({ product: products[0] }, productCards(products, context));
    },
  },
  {
    name: 'get_product_price', description: 'Get the current effective price and MOQ for a product; never accepts a client-supplied price.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: productIdSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string', format: 'uuid' } } },
    execute: async ({ productId }, context) => {
      const { data, error } = await context.supabase.from('products').select('id, name, sku_code, category_id, gst_percent, is_new_launch, created_at, brands ( name ), categories ( name ), product_images ( image_url, sort_order ), product_packs ( id, pack_name, ptr, base_price, case_price, mrp, moq, is_active, sort_order )').eq('id', productId).eq('is_active', true).maybeSingle<ProductRow>();
      if (error) return dbFailure();
      if (!data) return unavailable('The product price is unavailable.');
      const products = await mapProducts(context, [data]);
      return verified({ productId, packs: products }, productCards(products, context));
    },
  },
  {
    name: 'get_product_stock', description: 'Get authorized aggregate stock availability for an active product. Retailers receive no warehouse/batch internals.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: productIdSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, required: ['productId'], properties: { productId: { type: 'string', format: 'uuid' } } },
    execute: async ({ productId }, context) => {
      const stock = await stockForProducts(context, [productId]);
      const row = stock.get(productId);
      if (!row) return unavailable('No authorized current stock record was found for this product.');
      return verified({ productId, stockStatus: row.status, availableQuantity: row.available }, [{ type: 'inventory', id: productId, title: 'Product stock', badge: row.status.replaceAll('_', ' '), metrics: [{ label: 'Available', value: String(row.available), quality: 'verified' }], source: 'Live aggregate inventory; no warehouse or batch details exposed', quality: 'verified' }]);
    },
  },
  {
    name: 'get_products_by_category', description: 'List active products in a category with current authorized pricing.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: productListSchema,
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { categoryId: { type: 'string', format: 'uuid' }, categoryName: { type: 'string' }, page: { type: 'integer' }, limit: { type: 'integer', maximum: 30 } } }, execute: searchProducts,
  },
  {
    name: 'get_new_arrivals', description: 'List real active new-launch products, newest first.', actionClass: 'READ',
    roles: ['retailer', 'salesman', 'staff', 'admin', 'super_admin'], surfaces: ['retailer', 'salesman', 'staff', 'admin'], inputSchema: z.object(pageFields),
    inputJsonSchema: { type: 'object', additionalProperties: false, properties: { page: { type: 'integer' }, limit: { type: 'integer', maximum: 30 } } },
    execute: async (input, context) => {
      const result = await searchProducts({ ...input }, context);
      if (!result.ok || !result.data) return result;
      const payload = result.data as { products: ProductResult[] };
      const products = payload.products.filter((p) => p.isNewArrival);
      return verified({ products }, productCards(products, context));
    },
  },
];

export { stockForProducts, mapProducts, productCards, productListSchema, type ProductResult, type ProductRow };
