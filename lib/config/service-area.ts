/**
 * Active business / service district — the single source of truth for any
 * UI copy, form default or config that names the district.
 *
 * Gaya District, Bihar is the NEW form and database default (0071). Migration
 * 0058 set the previous Saran default; its history is preserved. Existing `areas`
 * rows, retailer assignments, addresses and orders are NOT rewritten by code or
 * by that migration — their district is whatever was recorded for them.
 *
 * This is a label/form default, NOT a delivery coverage claim. Admins must
 * activate verified district/state/PIN rows separately in /admin/areas.
 */
export const SERVICE_DISTRICT = 'Gaya' as const;
export const SERVICE_STATE = 'Bihar' as const;
export const SERVICE_COUNTRY = 'India' as const;
export const SERVICE_AREA_LABEL = `${SERVICE_DISTRICT} District, ${SERVICE_STATE}` as const;
