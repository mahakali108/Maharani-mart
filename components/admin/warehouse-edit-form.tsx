'use client';

import { useFormState } from 'react-dom';
import { updateWarehouseAction, type MasterDataFormState } from '@/lib/admin/master-data-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: MasterDataFormState = null;

interface AreaOption {
  id: string;
  name: string;
}

export function WarehouseEditForm({
  warehouseId,
  name,
  areaId,
  address,
  areas,
}: {
  warehouseId: string;
  name: string;
  areaId: string | null;
  address: string | null;
  areas: AreaOption[];
}) {
  const boundAction = updateWarehouseAction.bind(null, warehouseId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="name">Warehouse name</Label>
        <Input id="name" name="name" defaultValue={name} required />
      </div>
      <div>
        <Label htmlFor="areaId">Area</Label>
        <Select id="areaId" name="areaId" defaultValue={areaId ?? ''}>
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
        <Input id="address" name="address" defaultValue={address ?? ''} />
      </div>
      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
