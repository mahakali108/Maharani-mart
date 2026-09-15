export interface HomeService {
  id: 'dispatch' | 'delivery' | 'invoice' | 'moq' | 'pricing' | 'support';
  title: string;
  detail: string;
  href?: string;
}

/** Display-only configuration. In particular, inventory replenishment
 * lead_time_days is NOT a promised delivery time for the retailer. */
export function homeServices(config: {
  dispatch?: string;
  deliveryEstimate?: string;
  gstin?: string;
  supportPhone?: string;
  hasWholesalePrices: boolean;
}): HomeService[] {
  const services: HomeService[] = [];
  if (config.dispatch?.trim()) services.push({ id: 'dispatch', title: 'Warehouse dispatch', detail: config.dispatch.trim() });
  if (config.deliveryEstimate?.trim()) services.push({ id: 'delivery', title: 'Estimated delivery', detail: config.deliveryEstimate.trim() });
  if (config.gstin?.trim()) services.push({ id: 'invoice', title: 'GST invoice', detail: `GSTIN ${config.gstin.trim()}`, href: '/retailer/orders' });
  services.push({ id: 'moq', title: 'MOQ-protected ordering', detail: 'Pack minimums checked before ordering.' });
  if (config.hasWholesalePrices) services.push({ id: 'pricing', title: 'Wholesale pricing', detail: 'Current retailer prices, inclusive of GST.' });
  // The existing help centre is available even without a configured helpline.
  services.push({ id: 'support', title: 'Retailer support', detail: config.supportPhone?.trim() || 'Help with products, orders and payments.', href: '/retailer/help' });
  return services;
}
