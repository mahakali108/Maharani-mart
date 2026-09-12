import 'server-only';

/**
 * Shared delivery queries for the Phase 4 pages (admin delivered module,
 * staff/salesman delivery workspace, retailer delivery record). All queries
 * run under the CALLER's session — RLS decides what is visible; these
 * helpers only shape the data.
 */

import { createClient } from '@/lib/supabase/server';

export interface DeliveryListRow {
  order_id: string;
  order_number: string;
  delivery_status: string;
  assigned_staff_id: string | null;
  assigned_name: string | null;
  shop_name: string | null;
  grand_total: number;
  placed_at: string;
  dispatched_at: string | null;
  delivered_at: string | null;
  receiver_name: string | null;
  signature_url: string | null;
  photo_url: string | null;
  otp_verified_at: string | null;
  return_deadline: string | null;
  shipping_line: string | null;
}

const LIST_SELECT = `
  order_id,
  delivery_status,
  assigned_staff_id,
  assigned_name:profiles!order_deliveries_assigned_staff_id_fkey ( full_name ),
  receiver_name,
  signature_url,
  photo_url,
  otp_verified_at,
  dispatched_at,
  delivered_at,
  return_deadline,
  orders!inner ( id, order_number, grand_total, placed_at, shipping_address, retailers ( shop_name ) )
` as const;

interface RawListRow {
  order_id: string;
  delivery_status: string;
  assigned_staff_id: string | null;
  assigned_name: { full_name: string } | null;
  receiver_name: string | null;
  signature_url: string | null;
  photo_url: string | null;
  otp_verified_at: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  return_deadline: string | null;
  orders: {
    id: string;
    order_number: string;
    grand_total: number;
    placed_at: string;
    shipping_address: { line: string } | null;
    retailers: { shop_name: string } | null;
  } | null;
}

function toListRow(raw: RawListRow): DeliveryListRow {
  return {
    order_id: raw.order_id,
    order_number: raw.orders?.order_number ?? '—',
    delivery_status: raw.delivery_status,
    assigned_staff_id: raw.assigned_staff_id,
    assigned_name: raw.assigned_name?.full_name ?? null,
    shop_name: raw.orders?.retailers?.shop_name ?? null,
    grand_total: raw.orders?.grand_total ?? 0,
    placed_at: raw.orders?.placed_at ?? '',
    dispatched_at: raw.dispatched_at,
    delivered_at: raw.delivered_at,
    receiver_name: raw.receiver_name,
    signature_url: raw.signature_url,
    photo_url: raw.photo_url,
    otp_verified_at: raw.otp_verified_at,
    return_deadline: raw.return_deadline,
    shipping_line: raw.orders?.shipping_address?.line ?? null,
  };
}

/** Open tasks assigned to a staff/salesman member (assigned + in progress). */
export async function listOpenDeliveriesForUser(userId: string): Promise<DeliveryListRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('order_deliveries')
    .select(LIST_SELECT)
    .eq('assigned_staff_id', userId)
    .in('delivery_status', ['assigned', 'in_progress'])
    .order('dispatched_at', { ascending: true, nullsFirst: false });
  return ((data ?? []) as unknown as RawListRow[]).map(toListRow);
}

/** Recently completed/failed tasks assigned to a user (last 20). */
export async function listRecentDeliveriesForUser(userId: string): Promise<DeliveryListRow[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from('order_deliveries')
    .select(LIST_SELECT)
    .eq('assigned_staff_id', userId)
    .in('delivery_status', ['delivered', 'partially_delivered', 'failed', 'returned_to_warehouse'])
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(20);
  return ((data ?? []) as unknown as RawListRow[]).map(toListRow);
}

export interface DeliveryDetail {
  delivery: {
    id: string;
    order_id: string;
    delivery_status: string;
    assigned_staff_id: string | null;
    assigned_name: string | null;
    assigned_at: string | null;
    dispatched_at: string | null;
    in_progress_at: string | null;
    delivered_at: string | null;
    receiver_name: string | null;
    otp_verified_at: string | null;
    otp_attempts: number;
    signature_url: string | null;
    photo_url: string | null;
    delivery_notes: string | null;
    failure_reason: string | null;
    return_window_days: number | null;
    return_deadline: string | null;
    completed_by: string | null;
    completed_by_name: string | null;
  };
  order: {
    id: string;
    order_number: string;
    status: string;
    grand_total: number;
    placed_at: string;
    retailer_id: string;
    shop_name: string | null;
    shipping_address: { line: string; label?: string; receiverName?: string; phone?: string } | null;
  };
  items: {
    delivery_item_id: string;
    order_item_id: string;
    product_name: string | null;
    pack_name: string | null;
    quantity_ordered: number;
    quantity_delivered: number;
    quantity_missing: number;
    quantity_damaged: number;
    line_total: number;
  }[];
}

/** Full delivery dossier for one order (RLS decides visibility). */
export async function fetchDeliveryDetail(orderId: string): Promise<DeliveryDetail | null> {
  const supabase = createClient();

  const deliveryResult = await supabase
    .from('order_deliveries')
    .select(
      `
      id, order_id, delivery_status, assigned_staff_id, assigned_at, dispatched_at,
      in_progress_at, delivered_at, receiver_name, otp_verified_at, otp_attempts,
      signature_url, photo_url, delivery_notes, failure_reason,
      return_window_days, return_deadline, completed_by,
      assigned_name:profiles!order_deliveries_assigned_staff_id_fkey ( full_name ),
      completed_by_name:profiles!order_deliveries_completed_by_fkey ( full_name ),
      orders ( id, order_number, status, grand_total, placed_at, retailer_id, shipping_address, retailers ( shop_name ) )
      `
    )
    .eq('order_id', orderId)
    .maybeSingle();

  if (!deliveryResult.data) return null;

  const raw = deliveryResult.data as unknown as {
    id: string;
    order_id: string;
    delivery_status: string;
    assigned_staff_id: string | null;
    assigned_at: string | null;
    dispatched_at: string | null;
    in_progress_at: string | null;
    delivered_at: string | null;
    receiver_name: string | null;
    otp_verified_at: string | null;
    otp_attempts: number;
    signature_url: string | null;
    photo_url: string | null;
    delivery_notes: string | null;
    failure_reason: string | null;
    return_window_days: number | null;
    return_deadline: string | null;
    completed_by: string | null;
    assigned_name: { full_name: string } | null;
    completed_by_name: { full_name: string } | null;
    orders: {
      id: string;
      order_number: string;
      status: string;
      grand_total: number;
      placed_at: string;
      retailer_id: string;
      shipping_address: { line: string; label?: string; receiverName?: string; phone?: string } | null;
      retailers: { shop_name: string } | null;
    } | null;
  };

  const itemsResult = await supabase
    .from('order_delivery_items')
    .select(
      `
      id, order_item_id, quantity_ordered, quantity_delivered, quantity_missing, quantity_damaged,
      order_items ( id, line_total, products ( name ), product_packs ( pack_name ) )
      `
    )
    .eq('delivery_id', raw.id)
    .order('id');

  const items = ((itemsResult.data ?? []) as unknown as {
    id: string;
    order_item_id: string;
    quantity_ordered: number;
    quantity_delivered: number;
    quantity_missing: number;
    quantity_damaged: number;
    order_items: { id: string; line_total: number; products: { name: string } | null; product_packs: { pack_name: string } | null } | null;
  }[]).map((row) => ({
    delivery_item_id: row.id,
    order_item_id: row.order_item_id,
    product_name: row.order_items?.products?.name ?? null,
    pack_name: row.order_items?.product_packs?.pack_name ?? null,
    quantity_ordered: row.quantity_ordered,
    quantity_delivered: row.quantity_delivered,
    quantity_missing: row.quantity_missing,
    quantity_damaged: row.quantity_damaged,
    line_total: row.order_items?.line_total ?? 0,
  }));

  return {
    delivery: {
      id: raw.id,
      order_id: raw.order_id,
      delivery_status: raw.delivery_status,
      assigned_staff_id: raw.assigned_staff_id,
      assigned_name: raw.assigned_name?.full_name ?? null,
      assigned_at: raw.assigned_at,
      dispatched_at: raw.dispatched_at,
      in_progress_at: raw.in_progress_at,
      delivered_at: raw.delivered_at,
      receiver_name: raw.receiver_name,
      otp_verified_at: raw.otp_verified_at,
      otp_attempts: raw.otp_attempts,
      signature_url: raw.signature_url,
      photo_url: raw.photo_url,
      delivery_notes: raw.delivery_notes,
      failure_reason: raw.failure_reason,
      return_window_days: raw.return_window_days,
      return_deadline: raw.return_deadline,
      completed_by: raw.completed_by,
      completed_by_name: raw.completed_by_name?.full_name ?? null,
    },
    order: {
      id: raw.orders?.id ?? orderId,
      order_number: raw.orders?.order_number ?? '—',
      status: raw.orders?.status ?? 'unknown',
      grand_total: raw.orders?.grand_total ?? 0,
      placed_at: raw.orders?.placed_at ?? '',
      retailer_id: raw.orders?.retailer_id ?? '',
      shop_name: raw.orders?.retailers?.shop_name ?? null,
      shipping_address: raw.orders?.shipping_address ?? null,
    },
    items,
  };
}
