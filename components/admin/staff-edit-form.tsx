'use client';

import { useFormState } from 'react-dom';
import { updateStaffAction, type TeamFormState } from '@/lib/admin/team-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: TeamFormState = null;

interface Option {
  id: string;
  name: string;
}

export function StaffEditForm({
  staffId,
  fullName,
  phone,
  role,
  areaId,
  warehouseId,
  areas,
  warehouses,
}: {
  staffId: string;
  fullName: string;
  phone: string;
  role: 'staff' | 'salesman';
  areaId: string | null;
  warehouseId: string | null;
  areas: Option[];
  warehouses: Option[];
}) {
  const boundAction = updateStaffAction.bind(null, staffId);
  const [state, formAction] = useFormState(boundAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-700">
          {state.error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" name="fullName" defaultValue={fullName} required />
        </div>
        <div>
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue={role} required>
            <option value="staff">Staff</option>
            <option value="salesman">Salesman</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" defaultValue={phone} required />
        </div>
        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" defaultValue={areaId ?? ''}>
            <option value="">— None —</option>
            {areas.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="warehouseId">Warehouse</Label>
          <Select id="warehouseId" name="warehouseId" defaultValue={warehouseId ?? ''}>
            <option value="">— None —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
    </form>
  );
}
