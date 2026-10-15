'use client';

import { useFormState } from 'react-dom';
import { reassignRetailerAreaAction, type RetailerFormState } from '@/lib/admin/retailers-actions';
import { ServiceAreaSelect } from '@/components/areas/service-area-select';
import type { ServiceAreaOption } from '@/lib/areas/district';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: RetailerFormState = null;

export function RetailerAreaReassignForm({
  retailerId,
  currentAreaId,
  areas,
}: {
  retailerId: string;
  currentAreaId: string;
  areas: ServiceAreaOption[];
}) {
  const boundAction = reassignRetailerAreaAction.bind(null, retailerId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <ServiceAreaSelect areas={areas} currentAreaId={currentAreaId} error={state?.error} />
        {state?.success ? <p role="status" className="mt-2 text-sm text-mint-700">{state.success}</p> : null}
      </div>
      <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
        Reassign area
      </SubmitButton>
    </form>
  );
}
