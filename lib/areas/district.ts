import { z } from 'zod';

/** Districts are recorded geography, not an allowlist of delivery coverage.
 * Never infer a district from a city/alias or rewrite a legacy assignment. */
export const districtSchema = z.string().trim().max(120, 'Keep the district under 120 characters.')
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Enter a district without control characters.');
export const areaSchema = z.object({
  name: z.string().trim().min(2, 'Enter an area name.').max(120),
  district: districtSchema.pipe(z.string().min(2, 'Enter a district.')),
});

export interface ServiceAreaOption {
  id: string;
  name: string;
  district?: string | null;
  is_active?: boolean;
}

/** Exact stored values remain selectable, including legacy spellings. */
export function districtOptions(areas: Pick<ServiceAreaOption, 'district'>[]): string[] {
  return [...new Set(areas.map((area) => area.district).filter((value): value is string => !!value))]
    .sort((a, b) => a.localeCompare(b, 'en-IN'));
}
export function areasInDistrict<T extends Pick<ServiceAreaOption, 'district'>>(areas: T[], district: string): T[] {
  return district ? areas.filter((area) => area.district === district) : areas;
}
export function serviceAreaLabel(area: Pick<ServiceAreaOption, 'name' | 'district'>): string {
  return [area.name, area.district].filter(Boolean).join(' — ');
}
