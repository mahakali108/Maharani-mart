'use client';

import { useFormState } from 'react-dom';
import { createAreaAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SubmitButton } from '@/components/ui/submit-button';
import { SERVICE_DISTRICT } from '@/lib/config/service-area';

const initialState: MasterDataFormState = null;

export function AreaForm({ districts = [] }: { districts?: string[] }) {
  const [state, formAction] = useFormState(createAreaAction, initialState);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2 sm:items-end">
      <div className="flex-1">
        <Label htmlFor="name">Area name</Label>
        <Input id="name" name="name" maxLength={120} placeholder="e.g. town or market name" required />
      </div>
      <div className="flex-1">
        <Label htmlFor="district">District</Label>
        <p className="mb-2 text-xs text-ink-500">Use the official district name. Other districts remain supported; this does not change retailer addresses.</p>
        <Input id="district" name="district" list="configured-districts" maxLength={120} defaultValue={SERVICE_DISTRICT} required />
        <datalist id="configured-districts">{districts.map((value) => <option key={value} value={value} />)}</datalist>
      </div>
      <SubmitButton pendingLabel="Adding…" className="w-full sm:w-auto">
        Add area
      </SubmitButton>
      {state?.success ? <p role="status" className="text-sm text-mint-700">{state.success}</p> : null}
      {state?.error ? <p className="text-sm text-primary-600 sm:ml-3">{state.error}</p> : null}
    </form>
  );
}
