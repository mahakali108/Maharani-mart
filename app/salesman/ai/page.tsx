import { MaharaniAIChat } from '@/components/ai/maharani-ai-chat';
import { requirePermission } from '@/lib/admin/guard';

export default async function SalesmanAIPage() {
  await requirePermission('reports.view.own');
  return <MaharaniAIChat surface="salesman" title="✨ Maharani Sales Copilot" subtitle="Product discovery, schemes, assigned retailer orders and your authorized sales activity." quickActions={[
    { label: 'Search Products', prompt: 'Products search karne mein help karo.' },
    { label: 'Active Schemes', prompt: 'Current active schemes dikhao.' },
    { label: 'My Sales', prompt: 'Last 30 days ki meri collected sales summary do.' },
    { label: 'My Orders', prompt: 'Mere recent authorized orders dikhao.' },
    { label: 'Top Products', prompt: 'Meri collected orders ke top products dikhao.' },
  ]} />;
}
