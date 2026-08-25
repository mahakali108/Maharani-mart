import { MaharaniAIChat } from '@/components/ai/maharani-ai-chat';
import { requirePermission } from '@/lib/admin/guard';

export default async function StaffAIPage() {
  await requirePermission('inventory.view');
  return <MaharaniAIChat surface="staff" title="✨ Maharani Warehouse Copilot" subtitle="Read-only help for authorized products, warehouse stock, FEFO batches, expiry, GRNs, transfers and orders." quickActions={[
    { label: 'Low Stock', prompt: 'Authorized low-stock products dikhao.' },
    { label: 'Expiring Stock', prompt: 'Agle 30 din ke expiring batches dikhao.' },
    { label: 'Inventory Health', prompt: 'Inventory health aur stock valuation summary do.' },
    { label: 'Batch Stock', prompt: 'Current batch stock dikhao.' },
    { label: 'GRNs', prompt: 'Recent GRNs dikhao.' },
    { label: 'Transfers', prompt: 'Recent stock transfers dikhao.' },
    { label: 'Pending Orders', prompt: 'Pending orders dikhao.' },
  ]} />;
}
