'use client';

import { useFormState } from 'react-dom';
import { reassignRetailerAreaAction, type RetailerFormState } from '@/lib/admin/retailers-actions';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface AreaOption {
  id: string;
  name: string;
}

const initialState: RetailerFormState = null;

export function RetailerAreaReassignForm({
  retailerId,
  currentAreaId,
  areas,
}: {
  retailerId: string;
  currentAreaId: string;
  areas: AreaOption[];
}) {
  const boundAction = reassignRetailerAreaAction.bind(null, retailerId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex-1">
        <Select id="areaId" name="areaId" defaultValue={currentAreaId}>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </Select>
        {state?.error ? <p className="mt-1.5 text-xs text-primary-600">{state.error}</p> : null}
      </div>
      <SubmitButton pendingLabel="Saving…" className="w-full sm:w-auto">
        Reassign area
      </SubmitButton>
    </form>
  );
}
