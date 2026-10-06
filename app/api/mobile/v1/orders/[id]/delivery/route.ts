import { z } from 'zod';
import { enforceRateLimit, jsonError, jsonOk, logServerError, newRequestId } from '@/lib/mobile';
import { requireRetailerCommerceSession } from '@/lib/mobile/commerce-route';
import { fetchDeliveryDetail } from '@/lib/delivery/queries';
import { resolveProofUrl } from '@/lib/delivery/proof-url';
import { isReturnWindowOpen } from '@/lib/delivery/return-window';
import { toPaise } from '@/lib/retailer/case-pricing';
import type { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/mobile/v1/orders/{id}/delivery — the delivery record for one order
 * the caller owns: status timeline, who delivered, what was handed over, the
 * return window and the captured proof.
 *
 * The dossier comes from `fetchDeliveryDetail`, the SAME query the retailer
 * delivery page reads, run under the caller's own bearer-token client so RLS
 * decides visibility exactly as it does on the web. The ownership check below
 * is defence in depth, not the boundary: `order_deliveries` RLS already scopes
 * rows to the caller's orders, and a mismatch (or a missing record for the
 * caller) answers `404 not_found` without revealing whether the order exists.
 *
 * Proof columns are object paths in a private bucket; they are resolved to
 * short-lived signed URLs with the same helper the web page uses, and are
 * `null` when nothing was captured.
 */

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
): Promise<Response> {
  const requestId = newRequestId();
  const auth = await requireRetailerCommerceSession(request, requestId, 'orders.view.own');
  if ('response' in auth) return auth.response;
  const limited = enforceRateLimit('read.orders', request, {
    requestId,
    keySuffix: auth.session.userId,
  });
  if (limited) return limited;
  if (!z.string().uuid().safeParse(params.id).success) {
    return jsonError('not_found', 'This delivery record could not be found.', {
      status: 404,
      requestId,
    });
  }

  try {
    const client = auth.session.supabase as unknown as ReturnType<typeof createClient>;
    // Ownership FIRST: the delivery dossier reads the order's child rows, so an
    // order that is not the caller's must be refused before any of them is
    // touched (RLS would return nothing anyway; this keeps that explicit).
    const orderResult = await client
      .from('orders')
      .select('id, retailer_id')
      .eq('id', params.id)
      .eq('retailer_id', auth.session.userId)
      .maybeSingle<{ id: string; retailer_id: string }>();
    if (orderResult.error) throw orderResult.error;
    if (!orderResult.data) {
      return jsonError('not_found', 'This delivery record could not be found.', {
        status: 404,
        requestId,
      });
    }

    const detail = await fetchDeliveryDetail(params.id, client);
    if (!detail || detail.order.retailer_id !== auth.session.userId) {
      return jsonError('not_found', 'This delivery record could not be found.', {
        status: 404,
        requestId,
      });
    }

    const [signatureUrl, photoUrl] = await Promise.all([
      resolveProofUrl(detail.delivery.signature_url, client),
      resolveProofUrl(detail.delivery.photo_url, client),
    ]);

    const { delivery, order, items } = detail;
    const { data: returnRequest, error: returnRequestError } = await client.from('return_requests')
      .select('status')
      .eq('order_id', order.id)
      .eq('retailer_id', auth.session.userId)
      .order('requested_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ status: string }>();
    if (returnRequestError) throw returnRequestError;

    return jsonOk(
      {
        orderId: order.id,
        orderNumber: order.order_number,
        orderStatus: order.status,
        grandTotalPaise: toPaise(order.grand_total),
        placedAt: order.placed_at,
        shippingAddressLine: order.shipping_address?.line ?? null,
        status: delivery.delivery_status,
        assignedName: delivery.assigned_name,
        assignedAt: delivery.assigned_at,
        dispatchedAt: delivery.dispatched_at,
        inProgressAt: delivery.in_progress_at,
        deliveredAt: delivery.delivered_at,
        receiverName: delivery.receiver_name,
        otpVerifiedAt: delivery.otp_verified_at,
        otpVerified: delivery.otp_verified_at != null,
        deliveryNotes: delivery.delivery_notes,
        failureReason: delivery.failure_reason,
        returnWindowDays: delivery.return_window_days,
        returnDeadline: delivery.return_deadline,
        // Inclusive deadline, computed by the shared helper — never inferred
        // from a device clock.
        returnWindowOpen: delivery.return_deadline
          ? isReturnWindowOpen(delivery.return_deadline)
          : null,
        returnRequestStatus: returnRequest?.status ?? null,
        proof: {
          signatureCaptured: delivery.signature_url != null,
          photoCaptured: delivery.photo_url != null,
          signatureUrl,
          photoUrl,
        },
        items: items.map((item) => ({
          id: item.delivery_item_id,
          productName: item.product_name,
          packName: item.pack_name,
          quantityOrdered: item.quantity_ordered,
          quantityDelivered: item.quantity_delivered,
          quantityMissing: item.quantity_missing,
          quantityDamaged: item.quantity_damaged,
          lineTotalPaise: toPaise(item.line_total),
        })),
      },
      { requestId }
    );
  } catch (cause) {
    logServerError('orders.delivery', requestId, cause);
    return jsonError(
      'database_unavailable',
      'This delivery record could not be loaded. Please try again.',
      { status: 503, requestId }
    );
  }
}
