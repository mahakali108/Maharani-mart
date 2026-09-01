/**
 * Shared row/result shapes for the Inventory Management system added by
 * migration 0017_inventory_batches_fefo_grn.sql.
 *
 * The main Database interface in database.types.ts is extended in-place for
 * tables it already defines (products, stock_movements); the tables below
 * are new and their shapes live here.
 */

import type { StockMovementTypeEnum } from '@/types/database.types';

export type GrnStatusEnum = 'draft' | 'confirmed' | 'cancelled';
export type TransferStatusEnum = 'pending' | 'completed' | 'cancelled';
export type AllocationStatus = 'reserved' | 'released' | 'dispatched' | 'returned';
export type StockStatus = 'healthy' | 'low_stock' | 'out_of_stock';
export type ExpiryStatus = 'expired' | 'critical' | 'warning' | 'healthy';

export interface InventoryBatchRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_quantity: number;
  current_quantity: number;
  reserved_quantity: number;
  damaged_quantity: number;
  expired_quantity: number;
  unit_cost: number | null;
  supplier_reference: string | null;
  grn_id: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrnRow {
  id: string;
  grn_number: string;
  warehouse_id: string;
  status: GrnStatusEnum;
  supplier_reference: string | null;
  invoice_reference: string | null;
  notes: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrnItemRow {
  id: string;
  grn_id: string;
  product_id: string;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  received_quantity: number;
  unit_cost: number | null;
  batch_id: string | null;
  created_at: string;
}

export interface OrderStockAllocationRow {
  id: string;
  order_id: string;
  order_item_id: string;
  product_id: string;
  warehouse_id: string;
  batch_id: string;
  quantity_reserved: number;
  quantity_dispatched: number;
  quantity_returned: number;
  status: AllocationStatus;
  created_at: string;
}

export interface StockTransferRow {
  id: string;
  transfer_number: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  status: TransferStatusEnum;
  notes: string | null;
  created_by: string | null;
  completed_by: string | null;
  completed_at: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface StockTransferItemRow {
  id: string;
  transfer_id: string;
  product_id: string;
  batch_id: string;
  quantity: number;
}

export interface InventorySettingsRow {
  id: boolean;
  expiry_critical_days: number;
  expiry_warning_days: number;
  low_stock_alert_cooldown_hours: number;
  updated_by: string | null;
  updated_at: string;
}

export interface StockMovementRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  movement_type: StockMovementTypeEnum;
  quantity: number;
  reference_order_id: string | null;
  reason: string | null;
  performed_by: string;
  created_at: string;
  batch_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  previous_quantity: number | null;
  new_quantity: number | null;
  direction: 'in' | 'out' | null;
  releases_reserved: number;
  seq: number;
}

/** Row shape of the inventory_product_totals reporting view. */
export interface ProductTotalsViewRow {
  product_id: string;
  product_name: string;
  sku_code: string | null;
  quantity_on_hand: number;
  reserved_quantity: number;
  available_quantity: number;
  batch_quantity: number;
  estimated_value: number;
  min_stock: number;
  reorder_level: number;
  max_stock: number;
  stock_status: StockStatus;
  warehouse_count: number | null;
}

/** Row shape of the inventory_expiry_report reporting view. */
export interface ExpiryReportViewRow {
  batch_id: string;
  product_id: string;
  product_name: string;
  sku_code: string | null;
  warehouse_id: string;
  warehouse_name: string;
  batch_number: string;
  manufacturing_date: string | null;
  expiry_date: string | null;
  current_quantity: number;
  reserved_quantity: number;
  available_quantity: number;
  estimated_value: number;
  days_remaining: number | null;
  expiry_status: ExpiryStatus;
}

/** Standard result of the inventory RPCs (jsonb). */
export interface RpcResult {
  status: string;
  [key: string]: unknown;
}
