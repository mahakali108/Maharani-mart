import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
  parseJsonBody,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { isSaveForLaterCartName } from '@/lib/retailer/saved-cart-constants';

export const dynamic = 'force-dynamic';

const MAX_SAVED_CARTS = 20;
const MAX_LINES_PER_SAVED_CART = 100;
const createSchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

type SavedCartItemRow = {
  id: string;
  pack_id: string;
  product_id: string;
  quantity: number;
  products: { name: string } | null;
  product_packs: { pack_name: string } | null;
};
type SavedCartRow = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  retailer_saved_cart_items: SavedCartItemRow[];
};

/** GET caller's saved carts, including identity/quantity only (never a price). */
export async function GET(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;

  try {
    const { data, error } = await auth.session.supabase.from('retailer_saved_carts')
      .select('id, name, created_at, updated_at, retailer_saved_cart_items ( id, pack_id, product_id, quantity, products ( name ), product_packs ( pack_name ) )')
      .eq('retailer_id', auth.session.userId)
      .order('updated_at', { ascending: false })
      .returns<SavedCartRow[]>();
    if (error) throw error;
    return jsonOk({ savedCarts: (data ?? []).map((cart) => ({
      id: cart.id,
      name: cart.name,
      createdAt: cart.created_at,
      updatedAt: cart.updated_at,
      itemCount: cart.retailer_saved_cart_items?.length ?? 0,
      items: (cart.retailer_saved_cart_items ?? []).map((item) => ({
        id: item.id,
        productId: item.product_id,
        packId: item.pack_id,
        productName: item.products?.name ?? null,
        packName: item.product_packs?.pack_name ?? null,
        quantity: item.quantity,
      })),
    })) }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.list', requestId, cause);
    return jsonError('database_unavailable', 'Saved carts could not be loaded. Please try again.', { status: 503, requestId });
  }
}

/** Save/merge the current server cart. No price or retailer id is accepted. */
export async function POST(request: Request): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  const body = await parseJsonBody(request, createSchema, requestId);
  if (!body.ok) return body.response;

  const supabase = auth.session.supabase;
  const name = body.data.name.replace(/\s+/g, ' ').slice(0, 60);
  if (isSaveForLaterCartName(name)) {
    return jsonError('invalid_request', 'That list name is reserved for items saved for later.', { status: 400, requestId });
  }
  try {
    const [{ count }, { data: cartItems, error: cartError }] = await Promise.all([
      supabase.from('retailer_saved_carts').select('id', { count: 'exact', head: true })
        .eq('retailer_id', auth.session.userId),
      supabase.from('cart_items').select('pack_id, quantity, product_id')
        .eq('retailer_id', auth.session.userId),
    ]);
    if (cartError) throw cartError;
    const items = (cartItems ?? []) as unknown as { pack_id: string; quantity: number; product_id: string }[];
    if (items.length === 0) {
      return jsonError('conflict', 'Your cart is empty — there is nothing to save yet.', { status: 409, requestId });
    }

    const { data: existing, error: existingError } = await supabase.from('retailer_saved_carts')
      .select('id')
      .eq('retailer_id', auth.session.userId)
      .eq('name', name)
      .maybeSingle<{ id: string }>();
    if (existingError) throw existingError;
    if (!existing && (count ?? 0) >= MAX_SAVED_CARTS) {
      return jsonError('conflict', `You can keep up to ${MAX_SAVED_CARTS} saved carts. Delete an older one first.`, { status: 409, requestId });
    }

    let savedCartId = existing?.id;
    if (savedCartId) {
      const { error } = await supabase.from('retailer_saved_carts')
        .update({ updated_at: new Date().toISOString() } as unknown as never)
        .eq('id', savedCartId)
        .eq('retailer_id', auth.session.userId);
      if (error) throw error;
    } else {
      const { data: created, error } = await supabase.from('retailer_saved_carts').insert({
        retailer_id: auth.session.userId,
        name,
      } as unknown as never).select('id').maybeSingle<{ id: string }>();
      if (error || !created) throw error ?? new Error('Missing saved cart row.');
      savedCartId = created.id;
    }

    const { data: existingItems, error: itemReadError } = await supabase.from('retailer_saved_cart_items')
      .select('id, pack_id, quantity')
      .eq('saved_cart_id', savedCartId)
      .eq('retailer_id', auth.session.userId);
    if (itemReadError) throw itemReadError;
    const typedExisting = (existingItems ?? []) as unknown as { id: string; pack_id: string; quantity: number }[];
    const byPack = new Map(typedExisting.map((item) => [item.pack_id, item]));
    const inserts: { saved_cart_id: string; retailer_id: string; product_id: string; pack_id: string; quantity: number }[] = [];
    for (const item of items) {
      const previous = byPack.get(item.pack_id);
      if (previous) {
        if (item.quantity > previous.quantity) {
          const { error } = await supabase.from('retailer_saved_cart_items').delete()
            .eq('id', previous.id).eq('retailer_id', auth.session.userId);
          if (error) throw error;
          inserts.push({ saved_cart_id: savedCartId, retailer_id: auth.session.userId, product_id: item.product_id, pack_id: item.pack_id, quantity: item.quantity });
        }
      } else if (typedExisting.length + inserts.length < MAX_LINES_PER_SAVED_CART) {
        inserts.push({ saved_cart_id: savedCartId, retailer_id: auth.session.userId, product_id: item.product_id, pack_id: item.pack_id, quantity: item.quantity });
      }
    }
    if (inserts.length > 0) {
      const { error } = await supabase.from('retailer_saved_cart_items').insert(inserts as unknown as never);
      if (error) throw error;
    }
    return jsonOk({ id: savedCartId, savedCount: Math.min(MAX_LINES_PER_SAVED_CART, Math.max(typedExisting.length, 0) + inserts.length) }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.save', requestId, cause);
    return jsonError('database_unavailable', 'Your cart could not be saved. Please try again.', { status: 503, requestId });
  }
}
