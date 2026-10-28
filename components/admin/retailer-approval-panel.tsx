'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, ChevronDown, Loader2, ShieldOff, Undo2, XCircle } from 'lucide-react';
import { RETAILER_CATEGORIES, RETAILER_CATEGORY_LABELS, type RetailerCategory } from '@/lib/pricing/category-pricing';
import {
  adminReviewApplicationAction,
  adminSetRetailerAccessAction,
  adminSetRetailerCategoryAction,
} from '@/lib/admin/retailer-approval-actions';

export interface ApprovalPanelProps {
  retailerId: string;
  shopName: string;
  applicationStatus: 'pending' | 'approved' | 'rejected' | 'suspended';
  category: RetailerCategory;
  /** Whether the signed-in admin holds the permission this control needs. */
  canApprove: boolean;
  canSuspend: boolean;
  canPrice: boolean;
}

type Feedback = { error?: string; success?: string } | null;

/**
 * Approve / reject / re-categorise / suspend controls for one retailer.
 *
 * Sensitive changes require an explicit confirmation dialog and a written
 * reason, which is stored with the acting administrator and the previous/new
 * values by the database RPC (never by the browser).
 */
export function RetailerApprovalPanel({
  retailerId,
  shopName,
  applicationStatus,
  category,
  canApprove,
  canSuspend,
  canPrice,
}: ApprovalPanelProps) {
  const [reason, setReason] = useState('');
  const [nextCategory, setNextCategory] = useState<RetailerCategory>(category);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  const reasonMissing = reason.trim().length < 3;

  function run(build: () => FormData, confirmText: string) {
    if (reasonMissing) {
      setFeedback({ error: 'Enter a reason of at least 3 characters — it is stored in the audit trail.' });
      return;
    }
    if (!window.confirm(confirmText)) return;
    const data = build();
    startTransition(async () => {
      const result = await adminReviewApplicationAction(data).catch(() => ({ error: 'The review could not be saved.' }));
      setFeedback(result);
      if (!result?.error) setReason('');
    });
  }

  function runCategory() {
    if (reasonMissing) {
      setFeedback({ error: 'Enter a reason of at least 3 characters before changing the category.' });
      return;
    }
    if (
      !window.confirm(
        nextCategory === 'gold'
          ? `Give ${shopName} the GOLD retailer price? This is the lowest approved wholesale price and is permanently audit-logged.`
          : `Change ${shopName} to the ${RETAILER_CATEGORY_LABELS[nextCategory].en} price?`
      )
    ) {
      return;
    }
    const data = new FormData();
    data.set('retailerId', retailerId);
    data.set('category', nextCategory);
    data.set('reason', reason);
    startTransition(async () => {
      const result = await adminSetRetailerCategoryAction(data).catch(() => ({ error: 'The category change failed.' }));
      setFeedback(result);
      if (!result?.error) setReason('');
    });
  }

  function runAccess(action: 'suspend' | 'restore') {
    if (reasonMissing) {
      setFeedback({ error: 'Enter a reason of at least 3 characters before changing access.' });
      return;
    }
    if (!window.confirm(action === 'suspend' ? `Suspend ${shopName}?` : `Restore access for ${shopName}?`)) return;
    const data = new FormData();
    data.set('retailerId', retailerId);
    data.set('action', action);
    data.set('reason', reason);
    startTransition(async () => {
      const result = await adminSetRetailerAccessAction(data).catch(() => ({ error: 'The access change failed.' }));
      setFeedback(result);
      if (!result?.error) setReason('');
    });
  }

  function decide(decision: 'approved' | 'rejected') {
    const data = new FormData();
    data.set('retailerId', retailerId);
    data.set('decision', decision);
    data.set('reason', reason);
    if (decision === 'approved') data.set('category', nextCategory);
    run(
      () => data,
      decision === 'approved'
        ? `Approve ${shopName} as a ${RETAILER_CATEGORY_LABELS[nextCategory].en}?`
        : `Reject ${shopName}'s application?`
    );
  }

  return (
    <div className="space-y-3">
      <label className="block text-xs font-medium text-ink-600" htmlFor={`reason-${retailerId}`}>
        Reason (required, stored in the audit trail)
      </label>
      <textarea
        id={`reason-${retailerId}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="e.g. Shop details confirmed on call; GSTIN matches the uploaded document."
        className="w-full rounded-xl border border-ink-200 px-3 py-2 text-xs text-ink-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-600"
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`category-${retailerId}`}>
          Pricing category
        </label>
        <div className="relative">
          <select
            id={`category-${retailerId}`}
            value={nextCategory}
            onChange={(event) => setNextCategory(event.target.value as RetailerCategory)}
            className="h-8 appearance-none rounded-lg border border-ink-200 bg-white pl-2.5 pr-7 text-xs text-ink-900 focus:outline-none focus:ring-2 focus:ring-primary-600"
          >
            {RETAILER_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {RETAILER_CATEGORY_LABELS[option].en}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-400" />
        </div>

        {canApprove && applicationStatus !== 'approved' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => decide('approved')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-mint-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-mint-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Approve
          </button>
        ) : null}

        {canApprove && applicationStatus === 'pending' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => decide('rejected')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-warning-200 px-2.5 py-1.5 text-xs font-semibold text-warning-800 hover:bg-warning-50 disabled:opacity-50"
          >
            <XCircle className="h-3.5 w-3.5" /> Reject
          </button>
        ) : null}

        {canPrice ? (
          <button
            type="button"
            disabled={isPending}
            onClick={runCategory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          >
            Set category
          </button>
        ) : null}

        {canSuspend && applicationStatus === 'approved' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAccess('suspend')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          >
            <ShieldOff className="h-3.5 w-3.5" /> Suspend
          </button>
        ) : null}

        {canSuspend && applicationStatus === 'suspended' ? (
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAccess('restore')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-xs font-medium text-ink-700 hover:bg-ink-50 disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" /> Restore
          </button>
        ) : null}
      </div>

      {feedback?.error ? (
        <p role="alert" className="text-xs font-medium text-warning-800">
          {feedback.error}
        </p>
      ) : null}
      {feedback?.success ? (
        <p role="status" className="text-xs font-medium text-mint-700">
          {feedback.success}
        </p>
      ) : null}
    </div>
  );
}
