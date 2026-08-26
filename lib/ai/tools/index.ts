import 'server-only';

import type { AIToolContext, AIToolDefinition, AIToolResult, ProviderTool } from '@/lib/ai/types';
import { productTools } from '@/lib/ai/tools/products';
import { discoveryTools } from '@/lib/ai/tools/discovery';
import { schemeTools } from '@/lib/ai/tools/schemes';
import { schemeDiscoveryTools } from '@/lib/ai/tools/scheme-discovery';
import { cartTools } from '@/lib/ai/tools/cart';
import { orderTools } from '@/lib/ai/tools/orders';
import { inventoryTools } from '@/lib/ai/tools/inventory';
import { analyticsTools } from '@/lib/ai/tools/analytics';
import { forecastTools } from '@/lib/ai/tools/forecast';
import { memoryTools } from '@/lib/ai/tools/memory';
import { superAdminTools } from '@/lib/ai/tools/super-admin';
import { createConfirmationToken } from '@/lib/ai/safety/confirmation';
import { logAIEvent } from '@/lib/ai/observability';
import { verificationFailure } from '@/lib/ai/safety/constants';
import { canAny } from '@/lib/permissions/permissions';

const baseTools: AIToolDefinition[] = [
  ...productTools,
  ...discoveryTools,
  ...schemeTools,
  ...schemeDiscoveryTools,
  ...cartTools,
  ...orderTools,
  ...inventoryTools,
  ...analyticsTools,
  ...forecastTools,
  ...memoryTools,
  ...superAdminTools,
];

function alias(name: string, targetName: string, description: string): AIToolDefinition {
  const target = baseTools.find((tool) => tool.name === targetName);
  if (!target) throw new Error(`Missing AI tool alias target: ${targetName}`);
  return { ...target, name, description };
}

const aliases: AIToolDefinition[] = [
  alias('prepare_cart', 'calculate_order_preview', 'Prepare a read-only authoritative cart preview. Does not persist or place an order.'),
  alias('remove_cart_item', 'remove_from_cart', 'Remove one owned retailer cart line after explicit confirmation.'),
  alias('update_cart_quantity_tool', 'update_cart_quantity', 'Update one owned retailer cart line after explicit confirmation.'),
];

export const allBusinessTools = [...baseTools, ...aliases];

function inheritsExistingPermission(tool: AIToolDefinition, context: Pick<AIToolContext, 'actor'>): boolean {
  const role = context.actor.role;
  const inventory = ['get_stock_status', 'get_product_stock_admin', 'get_batch_stock', 'get_low_stock_products', 'get_expiring_batches', 'get_expiry_report', 'get_inventory_summary', 'get_reorder_recommendations', 'get_grns', 'get_stock_transfers'];
  if (inventory.includes(tool.name)) return canAny(role, ['inventory.view']);
  if (tool.name.includes('cart') || tool.name === 'calculate_order_preview') return canAny(role, ['orders.create']);
  if (tool.name.includes('order') || tool.name.includes('invoice')) return canAny(role, ['orders.view.own', 'orders.view.all', 'orders.create']);
  if (['get_sales_summary', 'get_top_products', 'get_best_sellers', 'get_slow_products', 'get_purchase_trends', 'get_customer_purchase_pattern', 'get_order_trends', 'get_retailer_trends', 'get_scheme_performance', 'get_predicted_stockouts', 'get_demand_forecast', 'get_reorder_recommendation', 'get_inventory_risk'].includes(tool.name)) {
    return canAny(role, ['reports.view.own', 'reports.view.area', 'reports.view.all']);
  }
  // Super Admin executive tools — mapped to the existing report/retailer
  // permissions the super_admin role already holds (defense-in-depth on top
  // of the per-tool role allowlist).
  if (['get_command_overview', 'get_business_risks', 'get_executive_action_plan', 'get_audit_activity', 'get_system_health', 'get_supplier_status'].includes(tool.name)) {
    return canAny(role, ['reports.view.all']);
  }
  if (['get_credit_risk_report', 'get_retailer_health_report'].includes(tool.name)) {
    return canAny(role, ['retailers.view']);
  }
  if (tool.name.includes('product') || tool.name === 'search_categories' || tool.name === 'search_brands') return canAny(role, ['products.view']);
  return true;
}

export function toolsForContext(context: Pick<AIToolContext, 'actor'>): AIToolDefinition[] {
  return allBusinessTools.filter((tool) => tool.roles.includes(context.actor.role) && tool.surfaces.includes(context.actor.surface) && inheritsExistingPermission(tool, context));
}

export function providerToolsForContext(context: Pick<AIToolContext, 'actor'>): ProviderTool[] {
  return toolsForContext(context).map((tool) => ({ name: tool.name, description: `[${tool.actionClass}] ${tool.description}`, inputSchema: tool.inputJsonSchema }));
}

export interface ToolExecution {
  result: AIToolResult;
  definition?: AIToolDefinition;
}

export async function executeBusinessTool(
  name: string,
  rawArguments: unknown,
  context: AIToolContext
): Promise<ToolExecution> {
  const started = Date.now();
  const definition = toolsForContext(context).find((tool) => tool.name === name);
  if (!definition) {
    return { result: { ok: false, message: 'This tool is not available for the authenticated role.' } };
  }

  const parsed = definition.inputSchema.safeParse(rawArguments);
  if (!parsed.success) {
    await logAIEvent(context.supabase, { requestId: context.requestId, userId: context.actor.id, surface: context.actor.surface, requestType: 'tool', toolName: name, durationMs: Date.now() - started, success: false, errorCode: 'invalid_arguments' });
    return { definition, result: { ok: false, message: 'Invalid tool arguments.', data: { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) } } };
  }

  if (definition.actionClass === 'SENSITIVE') {
    return { definition, result: { ok: false, message: 'This sensitive action is not available through Maharani AI.' } };
  }

  if (definition.actionClass === 'WRITE' && !context.confirmed) {
    try {
      const token = createConfirmationToken(context.actor, definition.name, parsed.data as Record<string, unknown>);
      const isMemory = definition.name === 'remember_business_preference';
      const result: AIToolResult = {
        ok: true,
        confirmationRequired: true,
        confirmationToken: token,
        message: `Explicit user confirmation is required before this ${isMemory ? 'preference is saved' : 'cart change'}.`,
        cards: [{
          type: 'confirmation', title: isMemory ? 'Confirm saved preference' : 'Confirm cart change', subtitle: isMemory ? 'Only this non-sensitive business preference will be saved. You can reset it later.' : 'This will change your cart only. It will not place an order.', quality: 'verified',
          source: `Validated ${definition.name} request`,
          actions: [{ type: 'confirm_tool', label: 'Confirm', confirmationToken: token, tone: definition.name.includes('remove') || definition.name === 'clear_cart' ? 'danger' : 'primary' }],
        }],
      };
      return { definition, result };
    } catch {
      return { definition, result: { ok: false, message: 'Cart writes are disabled until secure action confirmation is configured.' } };
    }
  }

  try {
    const result = await definition.execute(parsed.data, context);
    await logAIEvent(context.supabase, { requestId: context.requestId, userId: context.actor.id, surface: context.actor.surface, requestType: 'tool', toolName: name, durationMs: Date.now() - started, success: result.ok, errorCode: result.ok ? undefined : 'tool_unverified' });
    return { definition, result };
  } catch {
    await logAIEvent(context.supabase, { requestId: context.requestId, userId: context.actor.id, surface: context.actor.surface, requestType: 'tool', toolName: name, durationMs: Date.now() - started, success: false, errorCode: 'tool_failure' });
    return { definition, result: { ok: false, message: verificationFailure('The secure business tool failed; use the normal application screen and try again.') } };
  }
}
