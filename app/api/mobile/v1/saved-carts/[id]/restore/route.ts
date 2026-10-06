import { z } from 'zod';
import {
  enforceRateLimit,
  jsonError,
  jsonOk,
  logServerError,
  newRequestId,
} from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { mergeLinesIntoCart } from '@/lib/retailer/cart-merge';
import { validatePackForCart } from '@/lib/retailer/cart-service';

export const dynamic = 'force-dynamic';

const uuidSchema = z.string().uuid();
type PackForRestore = {
  id: string;
  moq: number;
  is_active: boolean;
  products: { is_active: boolean } | null;
};

/** Restore an owner-owned saved cart by revalidating each line and merging it into the live server cart. */
export async function POST(request: Request, context: { params: { id: string } }): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.create');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('write.cart', request, { requestId, keySuffix: auth.session.userId });
  if (limited) return limited;
  if (!uuidSchema.safeParse(context.params.id).success) {
    return jsonError('invalid_request', 'Saved cart id is invalid.', { status: 400, requestId });
  }

  const supabase = auth.session.supabase;
  try {
    const { data: savedCart, error: cartError } = await supabase.from('retailer_saved_carts')
      .select('id')
      .eq('id', context.params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string }>();
    if (cartError) throw cartError;
    if (!savedCart) return jsonError('not_found', 'Saved cart not found.', { status: 404, requestId });

    const { data: items, error: itemsError } = await supabase.from('retailer_saved_cart_items')
      .select('pack_id, quantity')
      .eq('saved_cart_id', savedCart.id)
      .eq('retailer_id', auth.session.userId);
    if (itemsError) throw itemsError;
    const savedItems = (items ?? []) as unknown as { pack_id: string; quantity: number }[];
    if (savedItems.length === 0) {
      return jsonError('conflict', 'This saved cart is empty.', { status: 409, requestId });
    }

    const packIds = [...new Set(savedItems.map((item) => item.pack_id))];
    const { data: packs, error: packError } = await supabase.from('product_packs')
      .select('id, moq, is_active, products ( is_active )')
      .in('id', packIds);
    if (packError) throw packError;
    const packById = new Map(((packs ?? []) as unknown as PackForRestore[]).map((pack) => [pack.id, pack]));
    const valid: { packId: string; quantity: number }[] = [];
    let skippedCount = 0;
    for (const item of savedItems) {
      const pack = packById.get(item.pack_id);
      if (!pack || !pack.is_active || !pack.products?.is_active || item.quantity < pack.moq) {
        skippedCount += 1;
        continue;
      }
      if (await validatePackForCart(supabase as never, auth.session.userId, item.pack_id, item.quantity)) {
        skippedCount += 1;
        continue;
      }
      valid.push({ packId: item.pack_id, quantity: item.quantity });
    }
    if (valid.length === 0) {
      return jsonError('conflict', 'None of these items are currently orderable — availability and minimums may have changed.', {
        status: 409,
        requestId,
      });
    }

    await mergeLinesIntoCart(supabase as never, auth.session.userId, valid);
    return jsonOk({ restoredCount: valid.length, skippedCount }, { requestId });
  } catch (cause) {
    logServerError('saved-carts.restore', requestId, cause);
    return jsonError('database_unavailable', 'The saved cart could not be restored. Refresh your cart and try again.', { status: 503, requestId });
  }
}
