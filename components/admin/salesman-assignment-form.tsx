'use client';

import { useFormState } from 'react-dom';
import {
  assignSalesmanToRetailerAction,
  type RetailerFormState,
} from '@/lib/admin/retailers-actions';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface SalesmanOption {
  id: string;
  full_name: string;
}

const initialState: RetailerFormState = null;

export function SalesmanAssignmentForm({
  retailerId,
  currentSalesmanId,
  salesmen,
}: {
  retailerId: string;
  currentSalesmanId: string | null;
  salesmen: SalesmanOption[];
}) {
  const boundAction = assignSalesmanToRetailerAction.bind(null, retailerId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Select id="salesmanId" name="salesmanId" defaultValue={currentSalesmanId ?? ''}>
          <option value="">— Unassigned —</option>
          {salesmen.map((salesman) => (
            <option key={salesman.id} value={salesman.id}>
              {salesman.full_name}
            </option>
          ))}
        </Select>
        {state?.error ? <p className="mt-1.5 text-xs text-primary-600">{state.error}</p> : null}
      </div>
      <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
        {currentSalesmanId ? 'Update assignment' : 'Assign salesman'}
      </SubmitButton>
    </form>
  );
}
