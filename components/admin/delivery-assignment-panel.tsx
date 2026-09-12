'use client';

/**
 * Admin controls for a delivery task (Phase 4): assign/reassign the delivery
 * person, resend the OTP to the retailer (e.g. the notification was lost),
 * and — after completion — record a return to warehouse.
 */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Loader2, RotateCcw, UserCog } from 'lucide-react';

import {
  assignDeliveryStaffAction,
  regenerateDeliveryOtpAction,
  recordReturnToWarehouseAction,
} from '@/lib/delivery/delivery-actions';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

export interface StaffOption {
  id: string;
  fullName: string;
  role: string;
}

export function DeliveryAssignmentPanel({
  orderId,
  deliveryStatus,
  currentAssigneeId,
  staffOptions,
  canAssign,
  canReturnToWarehouse,
}: {
  orderId: string;
  deliveryStatus: string;
  currentAssigneeId: string | null;
  staffOptions: StaffOption[];
  canAssign: boolean;
  canReturnToWarehouse: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(currentAssigneeId ?? '');
  const [returnNotes, setReturnNotes] = useState('');
  const [showReturn, setShowReturn] = useState(false);

  const isOpen = deliveryStatus === 'assigned' || deliveryStatus === 'in_progress';
  const canReturn = canReturnToWarehouse && (deliveryStatus === 'delivered' || deliveryStatus === 'partially_delivered');

  function run(action: () => Promise<{ error: string } | { success: true; message?: string }>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      if ('error' in result) setError(result.error);
      else {
        setNotice(result.message ?? 'Done.');
        router.refresh();
      }
    });
  }

  if (!canAssign && !canReturn) return null;

  return (
    <Card className="space-y-4 p-5">
      <h2 className="flex items-center gap-2 text-base font-semibold text-ink-950">
        <UserCog className="h-4 w-4" />
        Delivery control
      </h2>

      {error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">{notice}</div>
      ) : null}

      {canAssign && isOpen ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="assignee" className="text-xs font-medium text-ink-600">
              Delivery person (staff or sales executive)
            </label>
            <Select id="assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">— Unassigned —</option>
              {staffOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.fullName} ({option.role === 'salesman' ? 'sales executive' : option.role})
                </option>
              ))}
            </Select>
            <p className="text-[11px] text-ink-400">
              Reassigning notifies the new delivery person immediately. The current one keeps access until reassigned.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => run(() => assignDeliveryStaffAction(orderId, assignee || null))}
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCog className="h-4 w-4" />}
              Save assignment
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => run(() => regenerateDeliveryOtpAction(orderId))}
            >
              <KeyRound className="h-4 w-4" />
              Resend OTP to retailer
            </Button>
          </div>
        </div>
      ) : null}

      {canReturn ? (
        <div className="space-y-2 border-t border-ink-100 pt-3">
          {showReturn ? (
            <>
              <label htmlFor="return-notes" className="text-xs font-medium text-ink-600">
                Return-to-warehouse notes (optional)
              </label>
              <Input
                id="return-notes"
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                maxLength={500}
                placeholder="Why is this going back to the warehouse?"
              />
              <p className="text-[11px] text-primary-700">
                Terminal action: stock is booked back into the warehouse and the order amount is credited back to the
                retailer&apos;s wallet.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isPending}
                  onClick={() => run(() => recordReturnToWarehouseAction(orderId, returnNotes))}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                  Confirm return to warehouse
                </Button>
                <Button size="sm" variant="ghost" disabled={isPending} onClick={() => setShowReturn(false)}>
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={isPending} onClick={() => setShowReturn(true)}>
              <RotateCcw className="h-4 w-4" />
              Return to warehouse
            </Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}
