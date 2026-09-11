import { requirePermission } from '@/lib/admin/guard';
import { createClient } from '@/lib/supabase/server';
import { toCsv, csvStamp } from '@/lib/admin/csv';

const MAX_ROWS = 5000;

/**
 * CSV export of the Delivered Orders module (Phase 4). RLS-scoped to the
 * caller; supports the same filters as the list page.
 */

interface ExportRow {
  order_id: string;
  delivery_status: string;
  delivered_at: string | null;
  receiver_name: string | null;
  otp_verified_at: string | null;
  signature_url: string | null;
  photo_url: string | null;
  return_deadline: string | null;
  assigned_name: { full_name: string } | null;
  orders: {
    order_number: string;
    grand_total: number;
    placed_at: string;
    retailers: { shop_name: string } | null;
  } | null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const outcome = url.searchParams.get('outcome')?.trim() ?? '';
  const staff = url.searchParams.get('staff')?.trim() ?? '';
  const from = url.searchParams.get('from')?.trim() ?? '';
  const to = url.searchParams.get('to')?.trim() ?? '';

  await requirePermission('orders.view.all');
  const supabase = createClient();

  let query = supabase
    .from('order_deliveries')
    .select(
      `order_id, delivery_status, delivered_at, receiver_name, otp_verified_at, signature_url, photo_url,
       return_deadline,
       assigned_name:profiles!order_deliveries_assigned_staff_id_fkey ( full_name ),
       orders!inner ( order_number, grand_total, placed_at, retailers ( shop_name ) )`
    )
    .in('delivery_status', ['delivered', 'partially_delivered', 'returned_to_warehouse'])
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ROWS);

  if (outcome) query = query.eq('delivery_status', outcome);
  if (staff) query = query.eq('assigned_staff_id', staff);
  if (from) query = query.gte('delivered_at', `${from}T00:00:00`);
  if (to) query = query.lte('delivered_at', `${to}T23:59:59`);
  if (q) query = query.ilike('orders.order_number', `%${q}%`);

  const { data } = await query;
  const rows = (data ?? []) as unknown as ExportRow[];

  const header = [
    'order_number',
    'retailer',
    'order_total_rupees',
    'delivery_status',
    'delivered_at',
    'receiver_name',
    'delivery_person',
    'otp_verified',
    'signature_attached',
    'photo_attached',
    'return_deadline',
  ];

  const csv = toCsv(
    header,
    rows.map((row) => [
      row.orders?.order_number ?? '',
      row.orders?.retailers?.shop_name ?? '',
      (row.orders?.grand_total ?? 0).toFixed(2),
      row.delivery_status,
      row.delivered_at ?? '',
      row.receiver_name ?? '',
      row.assigned_name?.full_name ?? '',
      row.otp_verified_at ? 'yes' : 'no',
      row.signature_url ? 'yes' : 'no',
      row.photo_url ? 'yes' : 'no',
      row.return_deadline ?? '',
    ])
  );

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="delivered-orders-${csvStamp(new Date().toISOString())}.csv"`,
      'Cache-Control': 'no-store',
      // X-Content-Type-Options stops browsers from sniffing CSV as HTML.
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
