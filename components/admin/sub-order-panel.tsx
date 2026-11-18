'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  adminTransitionSubOrderAction,
  type AdminSubOrderStatus,
} from '@/lib/admin/sub-order-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/admin/status-badge';

export interface SubOrderSummaryRow {
  sub_order_id: string;
  seller_id: string | null;
  /** Historical counterparty name from the order snapshot (may be Maharani). */
  seller_business_name: string;
  seller_gstin: string | null;
  fulfilment_type: 'seller' | 'maharani';
  status: string;
  gross_paise: number;
  gst_paise: number;
  coupon_share_paise: number;
  coins_share_paise: number;
  payable_paise: number;
  shipment_status: string | null;
  courier: string | null;
  awb: string | null;
}

const inr = (paise: number) =>
  `₹${(Number(paise) / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function AdminSubOrderPanel({
  orderId,
  subOrders,
  canManage,
}: {
  orderId: string;
  subOrders: SubOrderSummaryRow[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (subOrders.length === 0) return null;

  function transition(subOrderId: string, nextStatus: AdminSubOrderStatus) {
    setError(null);
    startTransition(async () => {
      const result = await adminTransitionSubOrderAction(orderId, subOrderId, nextStatus, reason);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">
            Split Fulfilment Sub-Orders ({subOrders.length})
          </h2>
          <p className="text-xs text-slate-500">
            Child sub-orders per merchant. Cancelling or returning a sub-order restores its stock and refunds its coin share once.
          </p>
        </div>
        {canManage ? (
          <Input
            placeholder="Reason (required when closing failed sub-orders)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="max-w-xs text-xs"
            disabled={pending}
          />
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          {error}
        </p>
      ) : null}

      <div className="divide-y divide-slate-100">
        {subOrders.map((sub) => (
          <div key={sub.sub_order_id} className="py-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-bold text-slate-900">{sub.seller_business_name}</span>
                {sub.seller_gstin ? (
                  <span className="font-mono text-[11px] text-slate-500">GSTIN {sub.seller_gstin}</span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  {sub.fulfilment_type === 'seller' ? 'Historical third-party line' : 'Maharani-fulfilled'}
                </span>
                <StatusBadge status={sub.status} />
              </div>
              <div className="text-right">
                <span className="font-semibold text-slate-900">Payable {inr(sub.payable_paise)}</span>
                <span className="ml-2 text-slate-500">
                  (Gross {inr(sub.gross_paise)} · Coins {inr(sub.coins_share_paise)} · Coupon {inr(sub.coupon_share_paise)})
                </span>
              </div>
            </div>

            {sub.courier || sub.awb || sub.shipment_status ? (
              <p className="text-[11px] text-slate-500">
                Shipment: <strong>{sub.shipment_status ?? 'pending'}</strong>
                {sub.courier ? ` · Courier: ${sub.courier}` : ''}
                {sub.awb ? ` · AWB: ${sub.awb}` : ''}
              </p>
            ) : null}

            {canManage ? (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {sub.status === 'pending' ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'confirmed')}>
                    Confirm
                  </Button>
                ) : null}
                {sub.status === 'confirmed' ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'processing')}>
                    Processing
                  </Button>
                ) : null}
                {(sub.status === 'confirmed' || sub.status === 'processing' || sub.status === 'failed') ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'shipped')}>
                    Mark shipped
                  </Button>
                ) : null}
                {sub.status === 'shipped' ? (
                  <>
                    <Button size="sm" disabled={pending} onClick={() => transition(sub.sub_order_id, 'delivered')}>
                      Mark delivered
                    </Button>
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'failed')}>
                      Mark failed
                    </Button>
                  </>
                ) : null}
                {(sub.status === 'pending' || sub.status === 'confirmed' || sub.status === 'processing' || sub.status === 'failed') ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'cancelled')}>
                    Cancel sub-order
                  </Button>
                ) : null}
                {(sub.status === 'shipped' || sub.status === 'delivered' || sub.status === 'failed') ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => transition(sub.sub_order_id, 'returned')}>
                    Mark returned
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
