'use client';

import { useActionState, useState } from 'react';

import { SubmitButton } from '@/components/ui/submit-button';
import {
  publishSellerAgreementVersionAction,
  recordMarketplaceDecisionAction,
  type MarketplaceActionState,
} from '@/lib/admin/marketplace/actions';
import { ENABLE_CONFIRMATION_PHRASE } from '@/lib/admin/marketplace/validation';

const field = 'mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';

function Result({ state }: { state: MarketplaceActionState }) {
  if (!state) return null;
  if (state.error) {
    return <p role="alert" className="rounded-xl border border-error-200 bg-error-50 px-3 py-2 text-xs font-semibold text-error-700">{state.error}</p>;
  }
  return <p role="status" className="rounded-xl border border-mint-200 bg-mint-50 px-3 py-2 text-xs font-semibold text-mint-800">{state.success}</p>;
}

/** Enable (needs both approvals + typed confirmation) or disable (reason only). */
export function MarketplaceDecisionForm({ currentlyOpen, disabled }: { currentlyOpen: boolean; disabled: boolean }) {
  const [state, action] = useActionState(recordMarketplaceDecisionAction, null);
  const [decision, setDecision] = useState<'enable' | 'disable'>(currentlyOpen ? 'disable' : 'enable');
  const enabling = decision === 'enable';

  return (
    <form action={action} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-xs font-bold text-slate-900">Decision</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
          <input type="radio" name="decision" value="disable" checked={!enabling} onChange={() => setDecision('disable')} className="h-4 w-4" />
          Disable third-party seller offers
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
          <input type="radio" name="decision" value="enable" checked={enabling} onChange={() => setDecision('enable')} className="h-4 w-4" />
          Enable third-party seller offers
        </label>
      </fieldset>

      {enabling ? (
        <>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            Enabling needs two real approvals that you hold in writing: one from the owner and one from the
            Chartered Accountant (covering GST, TCS and TDS on seller sales). Enter where each can be found —
            for example “Owner letter dated …” and “CA letter dated …, membership no. …”. Do not enter anything
            you cannot produce later. This software does not decide any tax position.
          </div>
          <div>
            <label htmlFor="owner_reference" className="text-xs font-bold text-slate-900">Owner approval reference</label>
            <input id="owner_reference" name="owner_reference" type="text" required minLength={3} maxLength={200} autoComplete="off" className={field} />
          </div>
          <div>
            <label htmlFor="ca_reference" className="text-xs font-bold text-slate-900">Chartered Accountant approval reference</label>
            <input id="ca_reference" name="ca_reference" type="text" required minLength={3} maxLength={200} autoComplete="off" className={field} />
          </div>
        </>
      ) : null}

      <div>
        <label htmlFor="reason" className="text-xs font-bold text-slate-900">Reason (kept in the history)</label>
        <textarea id="reason" name="reason" required minLength={10} maxLength={500} rows={3} className={field} />
      </div>

      {enabling ? (
        <div>
          <label htmlFor="confirmation" className="text-xs font-bold text-slate-900">
            Type <span className="font-mono">{ENABLE_CONFIRMATION_PHRASE}</span> to confirm
          </label>
          <input id="confirmation" name="confirmation" type="text" required autoComplete="off" className={field} />
        </div>
      ) : null}

      <Result state={state} />
      <SubmitButton disabled={disabled} pendingLabel="Recording…" className="h-11">
        {enabling ? 'Record approvals and enable' : 'Record and disable'}
      </SubmitButton>
    </form>
  );
}

export function PublishAgreementVersionForm({ version, disabled }: { version: string; disabled: boolean }) {
  const [state, action] = useActionState(publishSellerAgreementVersionAction, null);
  return (
    <form action={action} className="space-y-3">
      <label className="flex items-start gap-2 text-xs leading-5 text-slate-700">
        <input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4 rounded border-slate-300" />
        <span>
          I have read Seller Agreement version {version} as shown on the public page, and I understand every seller
          must accept it again before their offers can go live.
        </span>
      </label>
      <Result state={state} />
      <SubmitButton disabled={disabled} pendingLabel="Publishing…" className="h-11">
        Enforce version {version}
      </SubmitButton>
    </form>
  );
}
