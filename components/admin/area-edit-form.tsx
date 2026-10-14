'use client';

import { useFormState } from 'react-dom';
import { updateAreaAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

export function AreaEditForm({ areaId, name, district, districts = [] }: { areaId: string; name: string; district: string; districts?: string[] }) {
  const boundAction = updateAreaAction.bind(null, areaId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="name">Area name</Label>
        <Input id="name" name="name" maxLength={120} defaultValue={name} required />
      </div>
      <div>
        <Label htmlFor="district">District</Label>
        <p className="mb-2 text-xs text-ink-500">Use the official district name. Other districts remain supported; this does not change retailer addresses.</p>
        <Input id="district" name="district" list="configured-districts" maxLength={120} defaultValue={district} required />
        <datalist id="configured-districts">{districts.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
