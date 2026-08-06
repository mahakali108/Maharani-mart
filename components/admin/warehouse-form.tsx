'use client';

import { useFormState } from 'react-dom';
import { createWarehouseAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

interface AreaOption {
  id: string;
  name: string;
}

export function WarehouseForm({ areas }: { areas: AreaOption[] }) {
  const [state, formAction] = useFormState(createWarehouseAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
      <div>
        <Label htmlFor="name">Warehouse name</Label>
        <Input id="name" name="name" placeholder="e.g. Khagaria Main Godown" required />
      </div>
      <div>
        <Label htmlFor="areaId">Area</Label>
        <Select id="areaId" name="areaId" defaultValue="">
          <option value="">— None —</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.name}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label htmlFor="address">Address</Label>
        <Input id="address" name="address" placeholder="Optional" />
      </div>
      <SubmitButton pendingLabel="Adding…">Add warehouse</SubmitButton>
      {state?.error ? <p className="text-sm text-primary-600 sm:col-span-4">{state.error}</p> : null}
    </form>
  );
}
