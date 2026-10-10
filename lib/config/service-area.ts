/**
 * Active business / service district — the single source of truth for any
 * UI copy, form default or config that names the district.
 *
 * Saran District, Bihar is the active default (migration 0058 changes the
 * database default for NEW `areas` rows to match; see docs/SERVICE_AREA_SARAN.md). Existing `areas`
 * rows, retailer assignments, addresses and orders are NOT rewritten by code or
 * by that migration — their district is whatever was recorded for them.
 *
 * Do not add delivery areas, pincodes or coordinates here. Areas are created by
 * an admin in the Admin Panel (/admin/areas) from real, verified information.
 */
export const SERVICE_DISTRICT = 'Saran' as const;
export const SERVICE_STATE = 'Bihar' as const;
export const SERVICE_COUNTRY = 'India' as const;
export const SERVICE_AREA_LABEL = `${SERVICE_DISTRICT} District, ${SERVICE_STATE}` as const;
