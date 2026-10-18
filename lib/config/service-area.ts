/**
 * Active business / service district — the single source of truth for any
 * UI copy, form default or config that names the district.
 *
 * Gaya District, Bihar is the default for newly configured service areas
 * (migration 0071). Existing `areas` rows, retailer assignments, addresses and
 * orders are NOT rewritten. This does not imply any PIN code/locality is
 * serviceable; serviceability is limited to explicitly configured active areas.
 *
 * Do not add delivery areas, pincodes or coordinates here. Areas are created by
 * an admin in the Admin Panel (/admin/areas) from real, verified information.
 */
export const SERVICE_DISTRICT = 'Gaya' as const;
export const SERVICE_STATE = 'Bihar' as const;
export const SERVICE_COUNTRY = 'India' as const;
export const SERVICE_AREA_LABEL = `${SERVICE_DISTRICT} District, ${SERVICE_STATE}` as const;
