/**
 * Active business / service district — the single source of truth for any
 * UI copy, form default or config that names the district.
 *
 * Gaya District, Bihar is the form and new-row database default (main's 0071).
 * Migration 0058 set the former Saran default; neither migration rewrites
 * existing areas, retailer assignments, addresses or orders. This label does
 * NOT imply delivery coverage: the separate directory added by 0073 starts
 * empty and admins must activate verified district/state/PIN rows in /admin/areas.
 */
export const SERVICE_DISTRICT = 'Gaya' as const;
export const SERVICE_STATE = 'Bihar' as const;
export const SERVICE_COUNTRY = 'India' as const;
export const SERVICE_AREA_LABEL = `${SERVICE_DISTRICT} District, ${SERVICE_STATE}` as const;
