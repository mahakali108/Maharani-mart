'use client';

import { useFormState } from 'react-dom';
import { createRouteAction, type RouteFormState } from '@/lib/admin/routes-actions';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SubmitButton } from '@/components/ui/submit-button';

interface Option {
  id: string;
  full_name: string;
}

interface AreaOption {
  id: string;
  name: string;
}

const initialState: RouteFormState = null;

export function RouteCreateForm({ salesmen, areas }: { salesmen: Option[]; areas: AreaOption[] }) {
  const [state, formAction] = useFormState(createRouteAction, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
      {state?.error ? (
        <div className="sm:col-span-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
          {state.error}
        </div>
      ) : null}
      <div>
        <Label htmlFor="name">Route name</Label>
        <Input id="name" name="name" placeholder="Gogri Morning Beat" required />
      </div>
      <div>
        <Label htmlFor="salesmanId">Salesman</Label>
        <Select id="salesmanId" name="salesmanId" required defaultValue="">
          <option value="" disabled>
            Select…
          </option>
          {salesmen.map((s) => (
            <option key={s.id} value={s.id}>
              {s.full_name}
            </option>
          ))}
        </Select>
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
      <SubmitButton pendingLabel="Creating…">Create route</SubmitButton>
    </form>
  );
}
