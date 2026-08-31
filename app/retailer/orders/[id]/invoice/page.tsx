import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requireUser } from '@/lib/auth/session';
import { PrintButton } from '@/components/retailer/print-button';

interface OrderInvoiceRow {
  id: string;
  order_number: string;
  status: string;
  subtotal: number;
  gst_total: number;
  discount_total: number;
  grand_total: number;
  placed_at: string;
}

interface RetailerRow {
  shop_name: string;
  gstin: string | null;
  address: string | null;
  areas: { name: string } | null;
}

interface OrderItemRow {
  id: string;
  quantity: number;
  unit_price: number;
  gst_percent: number;
  line_total: number;
  products: { name: string; sku_code: string } | null;
  product_packs: { pack_name: string } | null;
}

function companyDetail(value: string | undefined, label: string): string {
  return value && value.trim() ? value : `Configure ${label} in environment variables`;
}

export default async function InvoicePage({ params }: { params: { id: string } }) {
  const user = await requireUser();
  const supabase = createClient();

  const [{ data: order }, { data: retailer }, { data: itemData }] = await Promise.all([
    supabase
      .from('orders')
      .select('id, order_number, status, subtotal, gst_total, discount_total, grand_total, placed_at')
      .eq('id', params.id)
      .eq('retailer_id', user.id)
      .maybeSingle<OrderInvoiceRow>(),
    supabase
      .from('retailers')
      .select('shop_name, gstin, address, areas ( name )')
      .eq('id', user.id)
      .maybeSingle<RetailerRow>(),
    supabase
      .from('order_items')
      .select('id, quantity, unit_price, gst_percent, line_total, products ( name, sku_code ), product_packs ( pack_name )')
      .eq('order_id', params.id),
  ]);

  if (!order) notFound();

  const items = (itemData ?? []) as unknown as OrderItemRow[];

  const company = {
    name: companyDetail(process.env.COMPANY_NAME, 'COMPANY_NAME'),
    gstin: companyDetail(process.env.COMPANY_GSTIN, 'COMPANY_GSTIN'),
    address: companyDetail(process.env.COMPANY_ADDRESS, 'COMPANY_ADDRESS'),
    phone: companyDetail(process.env.COMPANY_PHONE, 'COMPANY_PHONE'),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 print:max-w-none">
      <div className="flex justify-end print:hidden">
        <PrintButton />
      </div>

      <div className="rounded-2xl border border-ink-100 bg-white p-6 print:rounded-none print:border-0 print:p-0 sm:p-8">
        <div className="flex items-start justify-between border-b border-ink-100 pb-4">
          <div>
            <p className="text-lg font-semibold text-ink-950">{company.name}</p>
            <p className="text-xs text-ink-500">{company.address}</p>
            <p className="text-xs text-ink-500">GSTIN: {company.gstin}</p>
            <p className="text-xs text-ink-500">{company.phone}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary-600">Tax Invoice</p>
            <p className="font-mono text-sm text-ink-900">{order.order_number}</p>
            <p className="text-xs text-ink-500">
              {new Date(order.placed_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>

        <div className="mt-4 border-b border-ink-100 pb-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Billed to</p>
          <p className="mt-1 text-sm font-semibold text-ink-900">{retailer?.shop_name}</p>
          <p className="text-xs text-ink-500">{retailer?.address ?? '—'}</p>
          {retailer?.areas?.name ? <p className="text-xs text-ink-500">{retailer.areas.name}</p> : null}
          {retailer?.gstin ? <p className="text-xs text-ink-500">GSTIN: {retailer.gstin}</p> : null}
        </div>

        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs uppercase tracking-wide text-ink-400">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Unit Price</th>
              <th className="py-2 text-right font-medium">GST %</th>
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-50">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="py-2">
                  <p className="font-medium text-ink-900">{item.products?.name ?? '—'}</p>
                  <p className="font-mono text-xs text-ink-400">
                    {item.products?.sku_code} · {item.product_packs?.pack_name}
                  </p>
                </td>
                <td className="py-2 text-ink-600">{item.quantity}</td>
                <td className="py-2 text-right text-ink-600">₹{item.unit_price.toFixed(2)}</td>
                <td className="py-2 text-right text-ink-600">{item.gst_percent}%</td>
                <td className="py-2 text-right font-medium text-ink-900">₹{item.line_total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 border-t border-ink-100 pt-4">
          <div className="flex justify-between text-sm text-ink-600">
            <span>Subtotal</span>
            <span>₹{order.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-sm text-ink-600">
            <span>GST</span>
            <span>₹{order.gst_total.toFixed(2)}</span>
          </div>
          {order.discount_total > 0 ? (
            <div className="flex justify-between text-sm text-ink-600">
              <span>Discount</span>
              <span>-₹{order.discount_total.toFixed(2)}</span>
            </div>
          ) : null}
          <div className="flex justify-between border-t border-ink-100 pt-1.5 text-base font-semibold text-ink-950">
            <span>Grand Total</span>
            <span>₹{order.grand_total.toFixed(2)}</span>
          </div>
          <p className="pt-1 text-right text-[10px] text-ink-400">
            All prices are GST-inclusive — the GST component above is already contained in the Grand Total.
          </p>
        </div>

        <p className="mt-8 text-center text-xs text-ink-300">
          This is a computer-generated invoice for {company.name}.
        </p>
      </div>
    </div>
  );
      }
