'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useFormState } from 'react-dom';
import {
  CheckCircle2,
  FileDown,
  KeyRound,
  Loader2,
  LogOut,
  ShieldAlert,
} from 'lucide-react';
import {
  changePasswordAction,
  logoutAllSessionsAction,
  requestAccountActionAction,
  type ProfileActionResult,
} from '@/lib/retailer/profile-actions';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: ProfileActionResult = {};

const inputClass =
  'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100';
const labelClass = 'mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-500';

function FormMessage({ error, success }: { error?: string; success?: string }) {
  if (!error && !success) return null;
  return (
    <p
      role="status"
      className={
        error
          ? 'rounded-xl bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700'
          : 'flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700'
      }
    >
      {success ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
      {error ?? success}
    </p>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useFormState(changePasswordAction, initialState);
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3.5">
        <KeyRound className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Change password</h2>
      </div>
      <form action={formAction} className="space-y-4 p-4">
        <div>
          <label htmlFor="currentPassword" className={labelClass}>Current password</label>
          <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className={inputClass} />
        </div>
        <div>
          <label htmlFor="newPassword" className={labelClass}>New password</label>
          <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
          <p className="mt-1 text-[10px] text-slate-400">At least 8 characters.</p>
        </div>
        <div>
          <label htmlFor="confirmPassword" className={labelClass}>Confirm new password</label>
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required className={inputClass} />
        </div>
        <FormMessage error={state.error} success={state.successMessage} />
        <SubmitButton pendingLabel="Changing password…">Change password</SubmitButton>
      </form>
    </section>
  );
}

export function LogoutAllSessionsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <LogOut className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Sign out everywhere</h2>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">
        Ends every active session on all phones, tablets and computers, including this one. You will need to sign in again.
      </p>
      {confirming ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => {
                await logoutAllSessionsAction();
                router.replace('/login');
              })
            }
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-xs font-bold text-white transition hover:bg-primary-700 disabled:opacity-60"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
            Yes, sign out everywhere
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex h-10 flex-1 items-center justify-center rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 flex h-10 w-full items-center justify-center rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-700 transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700"
        >
          <LogOut className="mr-2 h-4 w-4" aria-hidden="true" /> Sign out of all devices
        </button>
      )}
    </section>
  );
}

export function AccountRequestsCard({ hasDeletionRequest }: { hasDeletionRequest: boolean }) {
  const [note, setNote] = useState('');
  const [state, setState] = useState<{ error?: string; success?: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [requestType, setRequestType] = useState<'account_deletion' | 'data_export'>(hasDeletionRequest ? 'account_deletion' : 'data_export');

  function submit() {
    setState(null);
    startTransition(async () => {
      const result = await requestAccountActionAction(requestType, note);
      if (result.error) setState({ error: result.error });
      else setState({ success: result.successMessage });
    });
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-primary-600" aria-hidden="true" />
        <h2 className="text-sm font-bold text-slate-900">Account requests</h2>
      </div>
      <p className="mt-2 text-[11px] leading-4 text-slate-500">
        Requests are reviewed by the distributor team — nothing changes automatically. Your orders, ledger and invoices stay
        available until a request is completed.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setRequestType('data_export')}
          aria-pressed={requestType === 'data_export'}
          className={
            requestType === 'data_export'
              ? 'flex items-center gap-2 rounded-xl border-2 border-primary-500 bg-primary-50 px-3 py-2.5 text-left text-[11px] font-bold text-primary-800'
              : 'flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50'
          }
        >
          <FileDown className="h-4 w-4 shrink-0" aria-hidden="true" />
          Export my data
        </button>
        <button
          type="button"
          onClick={() => setRequestType('account_deletion')}
          aria-pressed={requestType === 'account_deletion'}
          className={
            requestType === 'account_deletion'
              ? 'flex items-center gap-2 rounded-xl border-2 border-primary-500 bg-primary-50 px-3 py-2.5 text-left text-[11px] font-bold text-primary-800'
              : 'flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50'
          }
        >
          <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
          Request account deletion
        </button>
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        maxLength={500}
        placeholder="Anything the team should know (optional)"
        aria-label="Request note"
        className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-primary-300 focus:ring-2 focus:ring-primary-100"
      />
      {hasDeletionRequest && requestType === 'account_deletion' ? (
        <p className="mt-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] font-semibold text-blue-800">
          You already have a deletion request under review.
        </p>
      ) : null}
      {state ? <div className="mt-2"><FormMessage error={state.error} success={state.success} /></div> : null}
      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="mt-3 flex h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 text-xs font-bold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
        Submit request
      </button>
    </section>
  );
}
