'use client';

import { useId, useState } from 'react';
import { areasInDistrict, districtOptions, serviceAreaLabel, type ServiceAreaOption } from '@/lib/areas/district';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/** The district narrows the directory; only the verified area ID is submitted.
 * No default district ever silently chooses/reassigns a retailer's area. */
export function ServiceAreaSelect({ areas, currentAreaId = '', error, unavailable = false }: {
  areas: ServiceAreaOption[]; currentAreaId?: string; error?: string; unavailable?: boolean;
}) {
  const id = useId();
  const [district, setDistrict] = useState(areas.find((a) => a.id === currentAreaId)?.district ?? '');
  const [areaId, setAreaId] = useState(currentAreaId);
  const districts = districtOptions(areas);
  const visible = areasInDistrict(areas, district);
  const missingCurrent = currentAreaId && !areas.some((a) => a.id === currentAreaId);
  return <div className="grid gap-3 sm:grid-cols-2">
    <div>
      <Label htmlFor={`${id}-district`}>Service district</Label>
      <Select id={`${id}-district`} disabled={unavailable} value={district} onChange={(event) => {
        setDistrict(event.target.value); setAreaId('');
      }}>
        <option value="">All configured districts</option>
        {districts.map((name) => <option key={name} value={name}>{name}</option>)}
      </Select>
    </div>
    <div>
      <Label htmlFor={`${id}-area`}>Service area</Label>
      <Select id={`${id}-area`} name="areaId" required disabled={unavailable} value={areaId}
        aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => setAreaId(event.target.value)}>
        <option value="" disabled>{unavailable ? 'Directory unavailable — retry' : areas.length ? 'Select your area' : 'No areas configured yet'}</option>
        {missingCurrent ? <option value={currentAreaId} disabled>Current area unavailable — choose a verified area</option> : null}
        {visible.map((area) => <option key={area.id} value={area.id} disabled={area.is_active === false}>
          {serviceAreaLabel(area)}{area.is_active === false ? ' (inactive)' : ''}
        </option>)}
      </Select>
    </div>
    {error ? <p id={`${id}-error`} role="alert" className="text-xs text-primary-700 sm:col-span-2">{error}</p> : null}
  </div>;
}
