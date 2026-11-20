'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, ShieldAlert } from 'lucide-react';
import { adminActivateRetailerAction } from '@/lib/admin/retailer-activation-actions';
import { Button } from '@/components/ui/button';

/**
 * Shown on the Super Admin retailer screen.
 *
 * The reason this panel exists: approving an application grants the retailer ROLE
 * and the access gate, but NOT the `profiles.is_active` switch. An account that
 * migration 0110 deactivated therefore stays unable to sign in after approval.
 * Reporting "approved" alone was a silent dead end, so the state is shown
 * explicitly here and activation is a separate, deliberate act.
 */
export interface ActivationState {
  is_active: boolean;
  role: string | null;
  retailer_status: string | null;
  can_sign_in: boolean;
  deactivated_by_migration: boolean;
  suspended_after_migration: boolean;
  can_activate: boolean;
  reason: string;
}

const REASON_COPY: Record<string, string> = {
  already_active: 'Active. Nothing to do.',
  no_action_required: 'Approved and active. Nothing to do.',
  deactivated_by_0110:
    'Deactivated by the marketplace retirement (migration 0110) because the application was not approved. The application is now approved and the role is retailer, but the account still cannot sign in until it is activated.',
  inactive_by_owner:
    'Inactive for a reason outside migration 0110. Activating it restores a login someone revoked; confirm that is intended.',
  suspended_by_admin_after_migration:
    'Suspended by an administrator AFTER the migration. Activation is refused: restore retailer access through the suspension workflow instead, so a deliberate suspension is not silently undone.',
  retailer_not_approved: 'The retailer application is not approved yet. Approve it first.',
  seller_only_never_converted:
    'This is a seller-only account with no retailer record. It is never converted into a Retailer.',
  auth_user_banned: 'The linked auth user is banned, so a login cannot work. Lift the ban first.',
  profile_not_found: 'Profile not found.',
};

export function RetailerActivationPanel({
  retailerId,
  isSuperAdmin,
  state,
}: {
  retailerId: string;
  isSuperAdmin: boolean;
  state: ActivationState | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: string } | null>(null);
  const [showForm, setShowForm] = useState(false);

  if (!isSuperAdmin) {
    return (
      <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4 text-sm text-ink-600">
        <p className="flex items-center gap-2 font-medium text-ink-800">
          <ShieldAlert className="h-4 w-4" /> Activation is controlled by a Super Admin
        </p>
        <p className="mt-1">
          Approving an application does not by itself restore sign-in. A Super Admin must run the
          activation step for an account that is still inactive.
        </p>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="rounded-2xl border border-ink-100 bg-ink-50/60 p-4 text-sm text-ink-600">
        Activation state could not be read. Reload the page before approving anything.
      </div>
    );
  }

  const explanation = REASON_COPY[state.reason] ?? state.reason;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-ink-400">Can sign in</dt>
          <dd className={`mt-0.5 font-medium ${state.can_sign_in ? 'text-mint-700' : 'text-amber-700'}`}>
            {state.can_sign_in ? 'Yes' : 'No'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-400">Account active</dt>
          <dd className="mt-0.5 font-medium text-ink-900">{state.is_active ? 'Yes' : 'No'}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Role</dt>
          <dd className="mt-0.5 font-medium text-ink-900">{state.role ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-ink-400">Retailer access</dt>
          <dd className="mt-0.5 font-medium text-ink-900">{state.retailer_status ?? '—'}</dd>
        </div>
      </dl>

      <div
        className={`rounded-2xl border p-4 text-sm ${
          state.can_sign_in
            ? 'border-mint-100 bg-mint-50/60 text-mint-800'
            : 'border-amber-100 bg-amber-50/60 text-amber-800'
        }`}
      >
        <p className="flex items-center gap-2 font-medium">
          {state.can_sign_in ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          {state.can_sign_in ? 'This account can sign in.' : 'This account cannot sign in yet.'}
        </p>
        <p className="mt-1">{explanation}</p>
      </div>

      {state.can_activate && (
        <div>
          {!showForm ? (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <KeyRound className="h-3.5 w-3.5" /> Activate account
            </Button>
          ) : (
            <form
              className="space-y-3 rounded-2xl border border-ink-100 p-4"
              action={(formData) =>
                startTransition(async () => {
                  const outcome = await adminActivateRetailerAction(formData);
                  setResult(outcome);
                  if (outcome.success) setShowForm(false);
                })
              }
            >
              <input type="hidden" name="retailerId" value={retailerId} />
              <div>
                <label className="text-sm font-medium text-ink-800" htmlFor="activation-reason">
                  Reason for activation
                </label>
                <textarea
                  id="activation-reason"
                  name="reason"
                  required
                  minLength={8}
                  maxLength={500}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-ink-200 p-2 text-sm"
                  placeholder="e.g. Application approved on 18 Nov; the account was deactivated by the migration."
                />
              </div>
              <div>
                <label className="text-sm font-medium text-ink-800" htmlFor="activation-confirmation">
                  Type ACTIVATE to confirm
                </label>
                <input
                  id="activation-confirmation"
                  name="confirmation"
                  required
                  pattern="ACTIVATE"
                  autoComplete="off"
                  className="mt-1 w-full rounded-xl border border-ink-200 p-2 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" type="submit" disabled={isPending}>
                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                  Confirm activation
                </Button>
                <Button size="sm" type="button" variant="outline" onClick={() => setShowForm(false)}>
                  Cancel
                </Button>
              </div>
              <p className="text-xs text-ink-500">
                This sets the account active. It does not change the role, the retailer access status or
                the pricing category, and the activation is written to the audit log.
              </p>
            </form>
          )}
        </div>
      )}

      {result?.error && (
        <p className="rounded-xl bg-error-50 p-3 text-sm text-error-700" role="alert">
          {result.error}
        </p>
      )}
      {result?.success && (
        <p className="rounded-xl bg-mint-50 p-3 text-sm text-mint-800" role="status">
          {result.success}
        </p>
      )}
    </div>
  );
}
