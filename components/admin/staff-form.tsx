'use client';

import { useFormState } from 'react-dom';
import { createStaffAction, type TeamFormState } from '@/lib/admin/team-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

const initialState: TeamFormState = null;

interface Option {
  id: string;
  name: string;
}

export function StaffForm({ areas, warehouses }: { areas: Option[]; warehouses: Option[] }) {
  const [state, formAction] = useFormState(createStaffAction, initialState);

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
          <Input id="fullName" name="fullName" placeholder="e.g. Ramesh Kumar" required />
        </div>
        <div>
          <Label htmlFor="role">Role</Label>
          <Select id="role" name="role" defaultValue="staff" required>
            <option value="staff">Staff</option>
            <option value="salesman">Salesman</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" placeholder="10-digit mobile number" required />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="you@business.com" required />
        </div>
        <div>
          <Label htmlFor="password">Temporary password</Label>
          <Input id="password" name="password" type="password" placeholder="Min. 8 characters" required minLength={8} />
        </div>
        <div>
          <Label htmlFor="areaId">Area</Label>
          <Select id="areaId" name="areaId" defaultValue="">
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
          <Select id="warehouseId" name="warehouseId" defaultValue="">
            <option value="">— None —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <SubmitButton pendingLabel="Creating…">Create account</SubmitButton>
    </form>
  );
}
