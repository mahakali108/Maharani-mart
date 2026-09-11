import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { can } from '@/lib/permissions/permissions';
import { toCsv, csvStamp, type CsvCell } from '@/lib/admin/csv';
import { formatIndiaDateTime } from '@/lib/datetime/india';

/**
 * Admin inventory CSV exports: ?kind=stock|movements|expiry|batches.
 * Every query runs through the caller's RLS-scoped session, and the route
 * re-checks the session + inventory permission (defense-in-depth — the
 * middleware already restricts /admin to admin/super_admin).
 */
export async function GET(request: Request) {
  const user = await requireUser();
  if (!can(user.role, 'inventory.view')) {
    return NextResponse.json({ error: 'You do not have permission to export inventory data.' }, { status: 403 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind') ?? 'stock';
  if (!['stock', 'movements', 'expiry', 'batches'].includes(kind)) {
    return NextResponse.json({ error: 'Unknown export kind.' }, { status: 400 });
  }

  const supabase = createClient();
  const stamp = csvStamp(new Date().toISOString());
  let csv: string;

  if (kind === 'stock') {
    const { data } = await supabase
      .from('inventory_stock')
      .select('quantity, reserved_quantity, updated_at, products ( name, sku_code ), warehouses ( name )')
      .order('updated_at', { ascending: false })
      .returns<
        {
          quantity: number;
          reserved_quantity: number;
          updated_at: string;
          products: { name: string; sku_code: string | null } | null;
          warehouses: { name: string } | null;
        }[]
      >();
    csv = toCsv(
      ['Product', 'SKU', 'Warehouse', 'On hand', 'Reserved', 'Available', 'Updated (IST)'],
      (data ?? []).map((r): CsvCell[] => [
        r.products?.name ?? '',
        r.products?.sku_code ?? '',
        r.warehouses?.name ?? '',
        r.quantity,
        r.reserved_quantity,
        r.quantity - r.reserved_quantity,
        formatIndiaDateTime(r.updated_at),
      ])
    );
  } else if (kind === 'movements') {
    const { data } = await supabase
      .from('stock_movements')
      .select('movement_type, quantity, reason, created_at, products ( name ), warehouses ( name )')
      .order('created_at', { ascending: false })
      .limit(5000)
      .returns<
        {
          movement_type: string;
          quantity: number;
          reason: string | null;
          created_at: string;
          products: { name: string } | null;
          warehouses: { name: string } | null;
        }[]
      >();
    csv = toCsv(
      ['Date (IST)', 'Product', 'Warehouse', 'Type', 'Quantity', 'Reason'],
      (data ?? []).map((r): CsvCell[] => [
        formatIndiaDateTime(r.created_at),
        r.products?.name ?? '',
        r.warehouses?.name ?? '',
        r.movement_type,
        r.quantity,
        r.reason ?? '',
      ])
    );
  } else if (kind === 'expiry') {
    const { data } = await supabase
      .from('inventory_expiry_report')
      .select(
        'product_name, sku_code, warehouse_name, batch_number, expiry_date, current_quantity, reserved_quantity, available_quantity, days_remaining, expiry_status'
      )
      .order('days_remaining', { ascending: true })
      .returns<
        {
          product_name: string;
          sku_code: string | null;
          warehouse_name: string;
          batch_number: string;
          expiry_date: string | null;
          current_quantity: number;
          reserved_quantity: number;
          available_quantity: number;
          days_remaining: number | null;
          expiry_status: string;
        }[]
      >();
    csv = toCsv(
      ['Product', 'SKU', 'Warehouse', 'Batch', 'Expiry date', 'Quantity', 'Reserved', 'Available', 'Days remaining', 'Status'],
      (data ?? []).map((r): CsvCell[] => [
        r.product_name,
        r.sku_code ?? '',
        r.warehouse_name,
        r.batch_number,
        r.expiry_date ?? '',
        r.current_quantity,
        r.reserved_quantity,
        r.available_quantity,
        r.days_remaining ?? '',
        r.expiry_status,
      ])
    );
  } else {
    const { data } = await supabase
      .from('inventory_batches')
      .select('batch_number, manufacturing_date, expiry_date, quantity, status, products ( name ), warehouses ( name )')
      .order('created_at', { ascending: false })
      .returns<
        {
          batch_number: string;
          manufacturing_date: string | null;
          expiry_date: string | null;
          quantity: number;
          status: string;
          products: { name: string } | null;
          warehouses: { name: string } | null;
        }[]
      >();
    csv = toCsv(
      ['Product', 'Warehouse', 'Batch', 'Mfg date', 'Expiry date', 'Quantity', 'Status'],
      (data ?? []).map((r): CsvCell[] => [
        r.products?.name ?? '',
        r.warehouses?.name ?? '',
        r.batch_number,
        r.manufacturing_date ?? '',
        r.expiry_date ?? '',
        r.quantity,
        r.status,
      ])
    );
  }

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="maharani-inventory-${kind}-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
